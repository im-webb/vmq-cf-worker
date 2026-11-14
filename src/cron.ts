import type { Env } from './lib/db';
import { getOrderTimeoutMinutes, STATUS } from './lib/db';
import { deliverTask } from './lib/notify';
import { pruneAuthAttempts } from './lib/auth-throttle';
import { now } from './lib/util';

/**
 * 每分钟执行一次（wrangler.jsonc 的 triggers.crons）。
 *
 * 旧版 PHP 是把清理逻辑挂在 createOrder / appHeart / appPush 开头，
 * 靠流量驱动 —— 没有请求进来就不会关单。这里改成真正的定时任务。
 *
 * ⚠️ Cron 是 at-least-once，可能重复触发，所以每条语句都必须幂等
 *    （都带了 status 条件限定）。
 */
export async function runCron(env: Env): Promise<void> {
  const ts = now();

  // 1) 心跳超时 → 标记监控端离线
  const st = await env.DB.prepare('SELECT last_heart FROM monitor_state WHERE id = 1')
    .first<{ last_heart: number }>();
  if (!st || ts - st.last_heart > 60) {
    // upsert：seed 不保证这行存在，纯 UPDATE 会静默无效
    await env.DB.prepare(
      "INSERT INTO config (k, v) VALUES ('jkstate', '0') " +
        "ON CONFLICT(k) DO UPDATE SET v = '0'"
    ).run();
  }

  // 2) 关闭超时订单并释放金额占位
  // ⚠️ 口径必须和支付页倒计时 / `/api/order/status` 的 expireAt 一致，
  //    统一走 getOrderTimeoutMinutes()，否则「页面还在倒计时、订单已被关单」。
  const closeMin = await getOrderTimeoutMinutes(env);
  const cutoff = ts - closeMin * 60;
  const expired = await env.DB.prepare(
    'SELECT order_id FROM orders WHERE status = ? AND create_time <= ? LIMIT 100'
  )
    .bind(STATUS.PENDING, cutoff)
    .all<{ order_id: string }>();

  if (expired.results.length > 0) {
    const stmts = expired.results.flatMap((r) => [
      env.DB.prepare(
        'UPDATE orders SET status = ?, close_time = ? WHERE order_id = ? AND status = ?'
      ).bind(STATUS.EXPIRED, ts, r.order_id, STATUS.PENDING),
      env.DB.prepare('DELETE FROM tmp_price WHERE oid = ?').bind(r.order_id),
    ]);
    await env.DB.batch(stmts);
  }

  // 3) 回调重试
  const due = await env.DB.prepare(
    'SELECT id FROM notify_task WHERE done = 0 AND next_at <= ? ORDER BY id LIMIT 20'
  )
    .bind(ts)
    .all<{ id: number }>();

  for (const t of due.results) {
    try {
      await deliverTask(env, t.id);
    } catch (e) {
      console.error('notify retry failed', t.id, e);
    }
  }

  // 4) 清理孤儿金额占位（oid 已不对应任何待支付订单）
  await env.DB.prepare(
    'DELETE FROM tmp_price WHERE oid NOT IN (SELECT order_id FROM orders WHERE status = ?)'
  )
    .bind(STATUS.PENDING)
    .run();

  // 5) 清理过期登录失败记录
  await pruneAuthAttempts(env);
}
