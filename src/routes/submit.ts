import type { Env } from '../lib/db';
import { createOrder } from '../lib/order';
import { clientIp, html, json, publicUrl, readParams } from '../lib/util';

function errorPage(msg: string): string {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>下单失败</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;background:#f5f5f5;margin:0;padding:40px 20px}
.box{max-width:420px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.06)}
h1{font-size:17px;color:#333;margin:0 0 12px}p{color:#888;font-size:14px;line-height:1.7;margin:0}</style></head>
<body><div class="box"><h1>下单失败</h1><p>${msg}</p></div></body></html>`;
}

/**
 * 商户下单入口。
 * 对外地址是 /api/order/create（和 /api/order/status 成对）；
 * 旧版 PHP 站的 /submit.php、/submit 也路由到这里，见 src/index.ts。
 * 参数：pid, type, out_trade_no, name, money, notify_url, return_url, sitename, sign, sign_type
 */
export async function handleSubmit(req: Request, env: Env): Promise<Response> {
  const p = await readParams(req);
  const r = await createOrder(env, p, clientIp(req));

  const wantsJson =
    (req.headers.get('accept') ?? '').includes('application/json') ||
    (p['format'] ?? '').toLowerCase() === 'json';

  if (!r.ok) {
    if (wantsJson) return json({ code: 0, msg: r.msg });
    return html(errorPage(r.msg));
  }

  const order = r.order!;

  if (wantsJson) {
    return json({
      code: 1,
      msg: '成功',
      data: {
        orderId: order.order_id,
        outTradeNo: order.out_trade_no,
        payType: order.type,
        price: order.money,
        reallyPrice: order.truemoney,
        payUrl: r.payUrl ?? '',
        payUrlType: r.payUrlType ?? r.passage?.ewm_type ?? 0,
        isAuto: r.isAuto ?? 1,
        payPage: `/pay/${order.order_id}`,
      },
    });
  }

  // 浏览器访问：跳到支付页（可刷新、可回退，比一次性渲染更稳）
  return Response.redirect(publicUrl(req, `/pay/${order.order_id}`), 302);
}
