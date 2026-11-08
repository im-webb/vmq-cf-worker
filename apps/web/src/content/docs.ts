import type { DocParameter } from '@/components/docs/doc-ui';
import type { DocDefinition } from '@/pages/api-doc-page';

const baseRequest: DocParameter[] = [
  { label: '商户 ID', name: 'pid', type: 'Int', example: '1000', description: '后台「系统配置 → 密钥管理」里的商户 ID，安装时自动生成 10 位数字，可直接复制。' },
  { label: '支付方式', name: 'type', type: 'String', example: 'alipay', description: '支持 wxpay、alipay、qqpay、rmbpay。' },
  { label: '商户订单号', name: 'out_trade_no', type: 'String', example: '202610290001', description: '商户系统内唯一的订单号，不允许重复。' },
  { label: '商品名称', name: 'name', type: 'String', example: 'VIP 会员', description: '展示在订单和支付页面中的商品名称。' },
  { label: '订单金额', name: 'money', type: 'String', example: '1.00', description: '单位为元，必须大于 0，最多两位小数。' },
  { label: '异步通知地址', name: 'notify_url', type: 'String', example: 'https://example.com/notify', description: '支付成功后接收平台异步通知。' },
  { label: '页面返回地址', name: 'return_url', type: 'String', example: 'https://example.com/return', description: '支付完成后用户浏览器跳转的地址。' },
  { label: '网站名称', name: 'sitename', type: 'String', required: false, example: '示例商城', description: '商户网站名称，可留空。' },
  { label: '业务参数', name: 'param', type: 'String', required: false, example: 'user_1001', description: '随订单保存的商户自定义参数。' },
  { label: '签名字符串', name: 'sign', type: 'String', example: '202cb962ac59075b964b07152d234b70', description: '参数排序拼接后，追加商户 KEY 计算 MD5。' },
  { label: '签名类型', name: 'sign_type', type: 'String', example: 'MD5', description: '固定为 MD5。' },
];

const pageExample = String.raw`import { createHash } from 'node:crypto';

const merchantId = process.env.PAY_PID;
const merchantKey = process.env.PAY_KEY;
if (!merchantId || !merchantKey) throw new Error('缺少支付配置');

export function createPaymentRedirect() {
  const params = {
    pid: merchantId,
    type: 'alipay',
    out_trade_no: '202610290001',
    name: 'VIP会员',
    money: '1.00',
    notify_url: 'https://example.com/notify',
    return_url: 'https://example.com/return',
    sitename: '示例商城',
  };

  const signString = Object.keys(params)
    .filter((key) => params[key] !== '')
    .sort()
    .map((key) => key + '=' + params[key])
    .join('&');
  const sign = createHash('md5').update(signString + merchantKey).digest('hex');
  const query = new URLSearchParams({ ...params, sign, sign_type: 'MD5' });

  return Response.redirect('https://你的域名/api/order/create?' + query, 302);
}`;

const apiExample = String.raw`import { createHash } from 'node:crypto';

const merchantId = process.env.PAY_PID;
const merchantKey = process.env.PAY_KEY;
if (!merchantId || !merchantKey) throw new Error('缺少支付配置');

const params = {
  pid: merchantId,
  type: 'wxpay',
  out_trade_no: '202610290002',
  name: 'VIP会员',
  money: '1.00',
  notify_url: 'https://example.com/notify',
  return_url: 'https://example.com/return',
  sitename: '示例商城',
  format: 'json',
};

const signString = Object.keys(params)
  .filter((key) => params[key] !== '')
  .sort()
  .map((key) => key + '=' + params[key])
  .join('&');
const sign = createHash('md5').update(signString + merchantKey).digest('hex');
const body = new URLSearchParams({ ...params, sign, sign_type: 'MD5' });

const response = await fetch('https://你的域名/api/order/create', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body,
});
const result = await response.json();
if (!response.ok || result.code !== 1) {
  throw new Error(result.msg || '创建订单失败');
}

const payPage = new URL(result.data.payPage, 'https://你的域名');
console.log({ orderId: result.data.orderId, payPage: payPage.toString() });`;

const notifyExample = String.raw`import { createHash, timingSafeEqual } from 'node:crypto';

const merchantKey = process.env.PAY_KEY;
if (!merchantKey) throw new Error('缺少支付配置');

export async function handleNotify(request) {
  const data = Object.fromEntries(new URL(request.url).searchParams);
  const receivedSign = (data.sign || '').toLowerCase();
  delete data.sign;
  delete data.sign_type;

  const signString = Object.keys(data)
    .filter((key) => data[key] !== '')
    .sort()
    .map((key) => key + '=' + data[key])
    .join('&');
  const calculatedSign = createHash('md5').update(signString + merchantKey).digest('hex');
  const validSign = receivedSign.length === calculatedSign.length &&
    timingSafeEqual(Buffer.from(receivedSign), Buffer.from(calculatedSign));

  if (!validSign || data.trade_status !== 'TRADE_SUCCESS') {
    return new Response(JSON.stringify({ code: 0, msg: 'fail' }), { status: 200 });
  }

  // 按 out_trade_no 查询商户订单，核对金额并进行幂等入账。
  // 平台以 JSON 的 code 字段判定：code=1 视为成功，其余（含网络失败）进入重试。
  // 已处理的重复通知也应返回 code=1。
  return new Response(JSON.stringify({ code: 1, msg: 'success' }));
}`;

const queryExample = String.raw`const orderId = '20261029120000123456';
const url = new URL('/api/order/status', 'https://你的域名');
url.searchParams.set('orderId', orderId);

const response = await fetch(url);
const result = await response.json();
if (!response.ok || result.code !== 1) {
  throw new Error(result.msg || '查询失败');
}

const { status, truemoney } = result.data;
console.log({ paid: status === 1 || status === 2, truemoney });`;

export const pageDoc: DocDefinition = {
  slug: 'doc',
  eyebrow: '创建订单',
  title: '页面跳转支付',
  description: '商户服务端创建订单后，将用户浏览器跳转到平台收银台，适合网页应用快速接入。',
  method: 'POST',
  endpoint: 'https://你的域名/api/order/create',
  request: baseRequest,
  notes: [
    '浏览器表单提交或 URL 跳转均会创建订单，成功后平台返回 302 并跳转到对应收银台。',
    '签名前剔除 sign、sign_type 和所有空值参数，按参数名升序拼接为 key=value&key=value，再在末尾追加商户 KEY 计算 MD5。',
    'out_trade_no 必须唯一；重复订单号、错误签名或不可用支付通道都会返回下单失败。',
    '生产环境请使用 HTTPS，并始终在商户服务端完成签名，不要把商户 KEY 放到浏览器中。',
  ],
  code: pageExample,
};

export const apiDoc: DocDefinition = {
  slug: 'api',
  eyebrow: '创建订单',
  title: 'API 接口支付',
  description: '通过同一个下单接口获取 JSON 响应，自行决定跳转收银台或处理支付数据。',
  method: 'POST',
  endpoint: 'https://你的域名/api/order/create?format=json',
  request: [
    ...baseRequest,
    { label: '响应格式', name: 'format', type: 'String', example: 'json', description: '传入 json 返回结构化数据；也可通过 Accept: application/json 请求头启用。' },
  ],
  response: [
    { label: '返回状态码', name: 'code', type: 'Int', example: '1', description: '1 为成功，0 为失败。' },
    { label: '返回信息', name: 'msg', type: 'String', example: '成功', description: '成功或失败的说明。' },
    { label: '平台订单号', name: 'data.orderId', type: 'String', example: '20261029120000123456', description: '平台生成的唯一订单号。' },
    { label: '商户订单号', name: 'data.outTradeNo', type: 'String', example: '202610290002', description: '下单时提交的商户订单号。' },
    { label: '支付类型', name: 'data.payType', type: 'Int', example: '1', description: '1 微信、2 支付宝、3 QQ 钱包、4 数字人民币。' },
    { label: '订单金额', name: 'data.price', type: 'String', example: '1.00', description: '下单时提交的金额。' },
    { label: '实际支付金额', name: 'data.reallyPrice', type: 'String', example: '1.01', description: '为区分并发订单，实际收款金额可能与订单金额不同。' },
    { label: '收款码内容', name: 'data.payUrl', type: 'String', example: 'https://qr.alipay.com/...', description: '当前通道的收款码载荷，可根据业务需要生成二维码。' },
    { label: '是否回退默认码', name: 'data.isAuto', type: 'Int', example: '0', description: '0 表示命中固定金额码；1 表示未命中并回退通道默认无金额码。' },
    { label: '二维码类型', name: 'data.payUrlType', type: 'Int', example: '0', description: '0 表示 payUrl 是二维码文本，需要生成二维码；1 表示 payUrl 是图片地址，应直接展示。' },
    { label: '支付页面', name: 'data.payPage', type: 'String', example: '/pay/20261029120000123456', description: '平台收银台相对地址，拼接站点域名后可跳转。' },
  ],
  responseExample: String.raw`{
  "code": 1,
  "msg": "成功",
  "data": {
    "orderId": "20261029120000123456",
    "outTradeNo": "202610290002",
    "payType": 1,
    "price": "1.00",
    "reallyPrice": "1.00",
    "payUrl": "收款码内容",
    "payUrlType": 0,
    "isAuto": 1,
    "payPage": "/pay/20261029120000123456"
  }
}`,
  notes: [
    'format=json 也参与签名；示例先将它放入参数数组，再统一排序和计算签名。',
    'payPage 是相对路径，跳转前需要拼接当前站点域名。',
    'reallyPrice 是实际应收金额，对账和支付结果处理应以通知中的 really_money 为准。',
    '固定金额码按实际应付金额和支付类型精确匹配；未配置对应金额时自动回退默认无金额码。',
  ],
  code: apiExample,
};

export const resultDoc: DocDefinition = {
  slug: 'result',
  eyebrow: '支付结果',
  title: '支付结果通知',
  description: '支付成功后，平台向 notify_url 发送签名通知；页面 return_url 也会携带同一组结果参数。',
  method: 'GET',
  endpoint: 'https://example.com/notify',
  request: [
    { label: '商户 ID', name: 'pid', type: 'Int', example: '1000', description: '订单对应的商户 ID（与下单时一致）。' },
    { label: '支付方式', name: 'type', type: 'String', example: 'alipay', description: 'wxpay、alipay、qqpay 或 rmb。' },
    { label: '商户订单号', name: 'out_trade_no', type: 'String', example: '202610290001', description: '商户系统内部的订单号。' },
    { label: '平台订单号', name: 'trade_no', type: 'String', example: '20261029120000123456', description: '平台生成的订单号。' },
    { label: '支付状态', name: 'trade_status', type: 'String', example: 'TRADE_SUCCESS', description: '支付成功时固定为 TRADE_SUCCESS。' },
    { label: '订单金额', name: 'money', type: 'String', example: '1.00', description: '下单时提交的订单金额。' },
    { label: '实际支付金额', name: 'really_money', type: 'String', example: '1.01', description: '订单实际收款金额。' },
    { label: '商品名称', name: 'name', type: 'String', example: 'VIP 会员', description: '下单时提交的商品名称。' },
    { label: '网站名称', name: 'sitename', type: 'String', example: '示例商城', description: '下单时提交的网站名称。' },
    { label: '签名字符串', name: 'sign', type: 'String', example: '202cb962ac59075b964b07152d234b70', description: '使用商户 KEY 对通知参数计算的 MD5。' },
    { label: '签名类型', name: 'sign_type', type: 'String', example: 'MD5', description: '固定为 MD5。' },
  ],
  notes: [
    '验签规则与下单一致：剔除 sign、sign_type 和空值，按参数名排序拼接，追加商户 KEY 后计算 MD5。',
    '只有验签成功且 trade_status 为 TRADE_SUCCESS 时才能处理商户订单，并根据 out_trade_no 做好幂等控制。',
    '处理成功后返回 JSON 且 code 字段为 1（如 {"code":1}）。其他响应或网络失败会进入重试流程，因此重复通知必须能够安全处理。',
    'return_url 是用户浏览器回跳，不能作为唯一入账依据；商户订单状态应以验签后的异步通知或主动查询为准。',
  ],
  code: notifyExample,
};

export const queryDoc: DocDefinition = {
  slug: 'chaorder',
  eyebrow: '订单查询',
  title: '单笔订单查询',
  description: '使用平台订单号查询当前支付状态、实际支付金额和订单时间信息。',
  method: 'GET',
  endpoint: 'https://你的域名/api/order/status?orderId=20261029120000123456',
  request: [
    { label: '平台订单号', name: 'orderId', type: 'String', example: '20261029120000123456', description: 'API 下单返回的 data.orderId，或支付页面 /pay/ 后的订单号。' },
  ],
  response: [
    { label: '返回状态码', name: 'code', type: 'Int', example: '1', description: '1 为查询成功，0 为失败。' },
    { label: '订单状态', name: 'data.status', type: 'Int', example: '1', description: '0 待支付、1 已支付、2 已支付但通知失败、3 已过期。' },
    { label: '实际支付金额', name: 'data.truemoney', type: 'String', example: '1.01', description: '订单实际应收金额。' },
    { label: '支付时间', name: 'data.payTime', type: 'Int', example: '1760000100', description: '支付时间戳，未支付时为 0。' },
    { label: '过期时间', name: 'data.expireAt', type: 'Int', example: '1760000400', description: '订单过期时间戳。' },
    { label: '服务器时间', name: 'data.now', type: 'Int', example: '1760000200', description: '查询时的平台服务器时间戳。' },
  ],
  responseExample: String.raw`{
  "code": 1,
  "data": {
    "status": 1,
    "truemoney": "1.00",
    "payTime": 1760000100,
    "expireAt": 1760000400,
    "now": 1760000200
  }
}`,
  notes: [
    'status 为 1 或 2 都代表已经支付；2 表示商户异步通知尚未成功确认，不代表未付款。',
    '订单不存在或 orderId 为空时返回 code=0 和对应错误信息。',
    '查询结果可用于支付页轮询和订单状态核对，商户入账仍应结合自身订单记录进行幂等处理。',
  ],
  code: queryExample,
};
