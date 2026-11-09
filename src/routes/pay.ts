import type { Env, PassageRow } from '../lib/db';
import { getOrderTimeoutMinutes, STATUS } from '../lib/db';
import { getOrder } from '../lib/order';
import { loadSettings, staticBase } from '../lib/page';
import { renderPayPage } from '../templates/pay';
import { buildNotifyPayload } from '../lib/notify';
import { html, json, now, publicUrl } from '../lib/util';

export async function handlePayPage(env: Env, req: Request, orderId: string): Promise<Response> {
  const order = await getOrder(env, orderId);
  if (!order) return html('<h1>订单不存在</h1>', 404);

  const [settings, passage] = await Promise.all([
    loadSettings(env),
    order.passage_id > 0
      ? env.DB.prepare('SELECT * FROM passages WHERE id = ?')
          .bind(order.passage_id)
          .first<PassageRow>()
      : Promise.resolve(null),
  ]);
  // 倒计时用的超时口径必须与 cron 关单一致，否则用户会照着一张已被关单的码付款
  const closeMinutes = await getOrderTimeoutMinutes(env);

  const body = renderPayPage(order, {
    resourceUrl: staticBase(settings, env),
    closeMinutes,
    passage,
    settings,
    userAgent: req.headers.get('user-agent') ?? '',
    origin: publicUrl(req, '/').replace(/\/+$/, ''),
    serverNow: now(),
  });
  return html(body);
}

/** 支付页轮询：/checkOrder?orderId=xxx（旧版 foot.html 用的就是这个） */
export async function handleCheckOrder(env: Env, orderId: string): Promise<Response> {
  if (!orderId) return json({ code: 0, msg: '缺少订单号' });
  const order = await getOrder(env, orderId);
  if (!order) return json({ code: 0, msg: '订单不存在' });

  if (order.status === STATUS.PAID || order.status === STATUS.NOTIFY_FAILED) {
    // 商户结果页可凭这组签名参数兜底入账，不能只回跳光秃秃的 return_url。
    let url = order.return_url || '/';
    if (order.return_url) {
      const payload = await buildNotifyPayload(env, order);
      url += (url.includes('?') ? '&' : '?') + payload;
    }
    return json({
      code: 1,
      msg: '支付成功',
      data: { url, status: order.status },
    });
  }
  if (order.status === STATUS.EXPIRED) return json({ code: 0, msg: '已过期' });
  return json({ code: 0, msg: '未支付' });
}

/** 保留 JSON 版状态接口（外部调用与订单查询文档） */
export async function handleOrderStatus(env: Env, orderId: string): Promise<Response> {
  if (!orderId) return json({ code: 0, msg: '缺少订单号' });
  const order = await getOrder(env, orderId);
  if (!order) return json({ code: 0, msg: '订单不存在' });
  return json({
    code: 1,
    data: {
      status: order.status,
      truemoney: order.truemoney,
      payTime: order.pay_time,
      expireAt: order.create_time + (await getOrderTimeoutMinutes(env)) * 60,
      now: now(),
    },
  });
}
