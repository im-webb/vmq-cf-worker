import type { Env, OrderRow } from '../lib/db';
import { appSecret, getConfigInt, STATUS } from '../lib/db';
import { enqueueNotify, tryNotifyNow } from '../lib/notify';
import { normalizeYuan } from '../lib/amount';
import { verifyMonitor } from '../lib/sign';
import { clientIp, json, now, readParams } from '../lib/util';

/** /appHeart —— 监控端心跳 */
export async function handleHeart(req: Request, env: Env): Promise<Response> {
  const p = await readParams(req);
  const key = await appSecret(env);
  if (!key) return json({ code: -1, msg: '通讯密钥未配置' });

  const t = p['t'] ?? '';
  const pid = p['pid'] ?? '';
  const sign = p['sign'] ?? '';

  // 新版含 pid，老版只有 md5(t+key)，两种都接受
  const ok = verifyMonitor([t, pid], sign, key) || verifyMonitor([t], sign, key);
  if (!ok) return json({ code: -1, msg: '签名校验不通过' });

  const ts = now();
  // upsert：schema 不预置 id=1 行，纯 UPDATE 会静默写 0 行，
  // 导致 require_online 永远认为监控端离线、全部拒单
  await env.DB.prepare(
    'INSERT INTO monitor_state (id, last_heart) VALUES (1, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET last_heart = excluded.last_heart'
  ).bind(ts).run();
  await env.DB.prepare(
    "INSERT INTO config (k, v) VALUES ('jkstate', '1') " +
      "ON CONFLICT(k) DO UPDATE SET v = '1'"
  ).run();

  return json({ code: 0, msg: '成功' });
}

/**
 * /appPush —— 监控端推送付款通知
 * 参数：type, price, t, pid, sign = md5(type + price + t + pid + key)
 */
export async function handlePush(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const started = Date.now();
  const p = await readParams(req);
  const key = await appSecret(env);
  if (!key) return json({ code: -1, msg: '通讯密钥未配置' });

  const type = p['type'] ?? '';
  const price = p['price'] ?? '';
  const t = p['t'] ?? '';
  const pid = p['pid'] ?? '';
  const sign = p['sign'] ?? '';

  const ok = verifyMonitor([type, price, t, pid], sign, key) || verifyMonitor([type, price, t], sign, key);
  if (!ok) return json({ code: -1, msg: '签名校验不通过' });

  // 防重放：旧版 PHP 把这段注释掉了，这里补上（窗口可配，默认 300 秒）
  const window = await getConfigInt(env, 'replay_window_seconds', 300);
  if (window > 0) {
    const tsNum = Number(t);
    if (Number.isFinite(tsNum) && tsNum > 0 && Math.abs(now() - tsNum) > window) {
      return json({ code: -1, msg: '时间戳过期' });
    }
  }

  const ts = now();
  await env.DB.prepare(
    'INSERT INTO monitor_state (id, last_pay) VALUES (1, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET last_pay = excluded.last_pay'
  ).bind(ts).run();

  const typeNum = Number(type);
  // 金额唯一性由 tmp_price 保证：同一 (金额, 类型) 只可能有一笔待支付订单。
  // orders.truemoney 由 fenToYuan() 写成规范的两位小数；先把 App 的原始金额
  // 归一成同样格式，再直接查 truemoney，既能兼容 "0.1" / "0.120"，也能使用
  // idx_orders_match(truemoney, status, type, pid)，避免表达式查询扫全表。
  const normalizedPrice = normalizeYuan(price);
  const order =
    normalizedPrice === null
      ? null
      : await env.DB.prepare(
          'SELECT * FROM orders ' +
            'WHERE truemoney = ? AND status = ? AND type = ? ' +
            'ORDER BY id LIMIT 1'
        )
          .bind(normalizedPrice, STATUS.PENDING, typeNum)
          .first<OrderRow>();

  if (!order) {
    // 不污染订单表，单独记录。
    // 存归一化后的金额，方便后台/巡检按「分」去核对，也免得同一个金额
    // 因为 "0.1" / "0.10" 两种写法在表里出现两条。
    await env.DB.prepare(
      'INSERT INTO unmatched_push (type, price, pid, t, sign, src_ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(type, normalizedPrice ?? price, pid, t, sign, clientIp(req), ts)
      .run();
    return json({ code: 0, msg: '无匹配订单，已记录' });
  }

  // 标记已支付 + 释放金额占位
  await env.DB.batch([
    env.DB.prepare('UPDATE orders SET status = ?, pay_time = ?, close_time = ? WHERE id = ? AND status = ?')
      .bind(STATUS.PAID, ts, ts, order.id, STATUS.PENDING),
    env.DB.prepare('DELETE FROM tmp_price WHERE oid = ?').bind(order.order_id),
  ]);

  // 时间线日志：`lag` = App 签名时间 → 我们处理完成（含网络+App 侧排队），
  // `matchMs` = 请求进来到匹配完成。排查"为什么慢"就看这两个数（wrangler tail 可见）。
  console.log(
    '[appPush] ' +
      JSON.stringify({
        t,
        price,
        type: typeNum,
        order: order?.order_id ?? null,
        lag: ts - Number(t || 0),
        matchMs: Date.now() - started,
      })
  );

  if (!order.notify_url) {
    return json({ code: 0, msg: '成功（未配置回调地址）' });
  }

  // 入队并立刻尝试一次。
  // ⚠️ 用 waitUntil 在后台跑，**绝不能 await**：商户回调最坏要 10 秒（超时），
  // 一旦同步等待，监控端 App 的推送请求会被拖住，用户侧体感就是"到账慢"。
  // 订单在上面已经置为已支付，页面轮询不受影响；回调失败还有 cron 重试兜底。
  //
  // ⚠️ 但「入队」这一步本身可能失败（D1 抖动、写配额超限）。以前它裸奔在
  //    订单已置 PAID 之后：一旦抛错，订单永久停在「已支付」、notify_task 里
  //    一条记录都没有，cron 也就永远重试不到 —— 钱收了，商户永远收不到回调。
  //    所以这里必须兜住：失败时把订单降级成「回调失败」(2)，
  //    后台能看见、能点「补单」，而不是无声无息地躺在成功状态里。
  let taskId = 0;
  try {
    taskId = await enqueueNotify(env, order);
  } catch (e) {
    console.error('[appPush] enqueueNotify failed', order.order_id, e);
    try {
      await env.DB.prepare('UPDATE orders SET status = ? WHERE order_id = ? AND status = ?')
        .bind(STATUS.NOTIFY_FAILED, order.order_id, STATUS.PAID)
        .run();
    } catch (e2) {
      console.error('[appPush] mark NOTIFY_FAILED failed', order.order_id, e2);
    }
    // 仍然回 code 0（对 App 而言这笔推送已被接收）：让 App 重推只会因订单
    // 已不是待支付而落进 unmatched_push，反而掩盖真问题。
    return json({ code: 0, msg: '成功（回调入队失败，已标记回调失败）' });
  }

  if (ctx) ctx.waitUntil(tryNotifyNow(env, taskId));
  else await tryNotifyNow(env, taskId); // 本地/测试环境没有 ctx 时退回同步

  return json({ code: 0, msg: '成功' });
}
