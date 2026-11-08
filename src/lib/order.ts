import type { Env, OrderRow, PassageRow } from './db';
import { appSecret, getConfig, STATUS } from './db';
import { verifyEpay } from './sign';
import { allocatePrice, fenToYuan, releasePrice, yuanToFen } from './amount';
import { findMatch as findFixedQrcode } from '../modules/qrcodes/qrcode.repository';
import { nameToPayType } from './notify';
import { fmtYmdHms, now, randomInt } from './util';

export interface CreateOrderResult {
  ok: boolean;
  msg: string;
  order?: OrderRow;
  payUrl?: string;
  payUrlType?: number;
  isAuto?: number;
  passage?: PassageRow;
}

export async function getOrder(env: Env, orderId: string): Promise<OrderRow | null> {
  return env.DB.prepare('SELECT * FROM orders WHERE order_id = ?')
    .bind(orderId)
    .first<OrderRow>();
}

/**
 * 下单。行为对齐 PHP 版 createOrder：
 *   验签 → 检查监控端在线 → 抢金额 → 选收款码 → 落库
 */
export async function createOrder(
  env: Env,
  params: Record<string, string>,
  ip: string
): Promise<CreateOrderResult> {
  const merchantKey = await appSecret(env);
  if (!merchantKey) return { ok: false, msg: '商户密钥未配置' };

  const outTradeNo = (params['out_trade_no'] ?? '').trim();
  if (!outTradeNo) return { ok: false, msg: '缺少商户订单号' };

  if (!verifyEpay(params, merchantKey)) return { ok: false, msg: '签名错误' };

  const type = nameToPayType(params['type'] ?? '');
  if (type === null) return { ok: false, msg: '支付方式错误' };

  const fen = yuanToFen((params['money'] ?? '').trim());
  if (fen === null || fen <= 0) return { ok: false, msg: '订单金额必须大于 0' };

  const requireOnline = (await getConfig(env, 'require_online', '1')) === '1';
  if (requireOnline) {
    const st = await env.DB.prepare('SELECT last_heart FROM monitor_state WHERE id = 1')
      .first<{ last_heart: number }>();
    if (!st || now() - st.last_heart > 60) {
      return { ok: false, msg: '监控端状态异常，请检查' };
    }
  }

  const dup = await env.DB.prepare('SELECT 1 AS x FROM orders WHERE out_trade_no = ?')
    .bind(outTradeNo)
    .first<{ x: number }>();
  if (dup) return { ok: false, msg: '商户订单号已存在' };

  return insertOrder(env, {
    outTradeNo,
    type,
    fen,
    name: params['name'] ?? '',
    pid: Number.parseInt(params['pid'] ?? '1', 10) || 1,
    ip,
    notifyUrl: params['notify_url'] ?? '',
    returnUrl: params['return_url'] ?? '',
    sitename: params['sitename'] ?? '',
    param: params['param'] ?? '',
  });
}

/* ---------------- 落库（商户下单与示例页下单共用） ---------------- */

export interface NewOrder {
  outTradeNo: string;
  type: number;
  /** 订单金额（分） */
  fen: number;
  name: string;
  pid: number;
  ip: string;
  notifyUrl?: string;
  returnUrl?: string;
  sitename?: string;
  param?: string;
}

/** 抢金额 → 固定码优先 → 默认码兜底 → 写订单。前面的校验各入口自己负责 */
async function insertOrder(env: Env, o: NewOrder): Promise<CreateOrderResult> {
  const defaultPassage = await env.DB.prepare(
    'SELECT * FROM passages WHERE type = ? AND status = 1 ORDER BY id LIMIT 1'
  )
    .bind(o.type)
    .first<PassageRow>();
  if (!defaultPassage) return { ok: false, msg: '暂无可用支付通道' };

  const ts = now();
  const orderId = `${fmtYmdHms(ts)}${randomInt(10)}${randomInt(10)}${randomInt(10)}${randomInt(10)}`;

  const realFen = await allocatePrice(env, o.fen, o.type, orderId);
  if (realFen === null) return { ok: false, msg: '订单超出负荷，请稍后重试' };

  const truemoney = fenToYuan(realFen);

  try {
    let passage = defaultPassage;
    let payUrl = defaultPassage.ewm;
    let payUrlType = Number(defaultPassage.ewm_type ?? 0);
    let isAuto = 1;

    // 原版 vmqphp 的核心行为：按“分配后的实际金额 + 支付类型”精确查固定码。
    // 命中后立即改用固定码真正所属的通道；未命中继续使用默认无金额码。
    const fixed = await findFixedQrcode(env.DB, realFen, o.type);
    if (fixed) {
      const fixedPassage = await env.DB.prepare(
        'SELECT * FROM passages WHERE id = ? AND type = ? AND status = 1'
      )
        .bind(fixed.passage_id, o.type)
        .first<PassageRow>();

      if (fixedPassage) {
        passage = fixedPassage;
        payUrl = fixed.pay_url;
        payUrlType = Number(fixed.ewm_type ?? 0);
        isAuto = 0;
      }
    }

    await env.DB.prepare(
      `INSERT INTO orders
        (order_id, out_trade_no, name, type, pid, passage_id, money, truemoney,
         pay_url, pay_url_type, is_auto, notify_url, return_url, sitename, param, status, create_time, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        orderId,
        o.outTradeNo,
        o.name,
        o.type,
        o.pid,
        passage.id,
        fenToYuan(o.fen),
        truemoney,
        payUrl,
        payUrlType,
        isAuto,
        o.notifyUrl ?? '',
        o.returnUrl ?? '',
        o.sitename ?? '',
        o.param ?? '',
        STATUS.PENDING,
        ts,
        o.ip
      )
      .run();

    const order = await getOrder(env, orderId);
    return {
      ok: true,
      msg: '成功',
      order: order ?? undefined,
      payUrl,
      payUrlType,
      isAuto,
      passage,
    };
  } catch (e) {
    await releasePrice(env, orderId);
    console.error('insert order failed', e);
    return { ok: false, msg: '订单创建失败' };
  }
}
/* ---------------- 示例页下单 ---------------- */

/** 示例页固定商品名（旧版就是这个） */
export const DEMO_GOODS_NAME = '测试商品';

/**
 * 示例页（/demo）下单 —— 对应旧版 `/index/index/demo?type=&money=&out_trade_no=`
 * 的真实行为：**先落一笔订单，再跳到支付页出二维码**。
 *
 * 与商户下单（createOrder）的区别：
 *   - 不验签（公开页面，谁都能点）
 *   - 不带 notify_url / return_url，支付成功后不会触发任何回调，
 *     也不会占用商户的订单号空间
 *   - 商品名固定为「测试商品」，便于后台区分体验单
 *
 * 仍然走 require_online 检查：监控端离线时下单了也没人能确认收款，
 * 给用户一句明确的提示比出一张收不到回调的二维码更诚实。
 */
export async function createDemoOrder(
  env: Env,
  typeRaw: string,
  moneyRaw: string,
  outTradeNoRaw: string,
  ip: string
): Promise<CreateOrderResult> {
  const type = nameToPayType(typeRaw);
  if (type === null) return { ok: false, msg: '支付方式错误' };

  const fen = yuanToFen((moneyRaw ?? '').trim());
  if (fen === null || fen <= 0) return { ok: false, msg: '订单金额必须大于 0' };

  const requireOnline = (await getConfig(env, 'require_online', '1')) === '1';
  if (requireOnline) {
    const st = await env.DB.prepare('SELECT last_heart FROM monitor_state WHERE id = 1')
      .first<{ last_heart: number }>();
    if (!st || now() - st.last_heart > 60) {
      return { ok: false, msg: '监控端当前离线，无法体验（请先启动监控端 App）' };
    }
  }

  // 订单号：优先用页面生成的，缺了再自己造一个（长度与旧版一致）
  const ts = now();
  const outTradeNo =
    (outTradeNoRaw ?? '').trim() ||
    `${fmtYmdHms(ts)}${randomInt(10)}${randomInt(10)}${randomInt(10)}${randomInt(10)}${randomInt(10)}`;

  const dup = await env.DB.prepare('SELECT 1 AS x FROM orders WHERE out_trade_no = ?')
    .bind(outTradeNo)
    .first<{ x: number }>();
  if (dup) return { ok: false, msg: '体验订单号重复，请刷新页面重试' };

  return insertOrder(env, {
    outTradeNo,
    type,
    fen,
    name: DEMO_GOODS_NAME,
    pid: 1,
    ip,
  });
}
