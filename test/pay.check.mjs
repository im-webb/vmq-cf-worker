import { Script } from 'node:vm';
import { renderPayPage } from '../src/templates/pay.ts';

let failures = 0;
function check(name, condition) {
  console.log(`${condition ? '✓' : '✗'} ${name}`);
  if (!condition) failures++;
}

const order = {
  id: 1,
  order_id: '20261029120000123456',
  out_trade_no: 'DEMO001',
  name: '<b>测试商品</b>',
  type: 2,
  pid: 1000,
  passage_id: 1,
  money: '1.00',
  truemoney: '1.01',
  pay_url: 'https://qr.alipay.com/EXAMPLE',
  pay_url_type: 0,
  is_auto: 1,
  notify_url: 'https://example.com/notify',
  return_url: 'https://example.com/return',
  sitename: '示例商城',
  param: '',
  status: 0,
  create_time: 1760000000,
  pay_time: 0,
  close_time: 0,
  notify_attempts: 0,
  ip: '127.0.0.1',
};

const passage = {
  id: 1,
  type: 2,
  code: 0,
  zf_pid: '',
  ewm_type: 0,
  ewm: '',
  balance: '0',
  succcount: 0,
  succprice: '0',
  is_status: 1,
  status: 1,
  money_change: 0,
  pay_qf: 0,
  hang_free: 0,
  cookie: '',
  remarks: '',
  create_time: 0,
  update_time: 0,
};

function options(overrides = {}) {
  return {
    resourceUrl: 'https://cdn.example.com',
    closeMinutes: 5,
    passage: { ...passage },
    settings: { confirm: '0', popup: '0', voice: '0', timeout_url: '' },
    userAgent: 'Mozilla/5.0 Chrome/120',
    origin: 'https://pay.example.com',
    serverNow: 1760000100,
    ...overrides,
  };
}

function render(orderOverrides = {}, optionOverrides = {}) {
  return renderPayPage({ ...order, ...orderOverrides }, options(optionOverrides));
}

const desktop = render();
check('单文件页面不包含 jQuery/Bootstrap/layer', !/jquery|bootstrap|layer\.js/i.test(desktop));
check('没有外部 CSS 或 JS 请求', !/<(?:script|link)\b[^>]*(?:src|href)=/i.test(desktop));
check('HTML 小于 25 KB', Buffer.byteLength(desktop) < 25_000);
check('金额与二维码完整', desktop.includes('1.01') && desktop.includes('/enQrcode?url='));
check('商户商品名已转义', desktop.includes('&lt;b&gt;测试商品&lt;/b&gt;') && !desktop.includes('<b>测试商品</b>'));
check('支付状态串行轮询且失败重试', desktop.includes("expired?10000:1500") && desktop.includes("expired?5000:2000"));
check('过期后降为低频探测', desktop.includes("schedulePoll(expired?10000:1500)"));
// 倒计时：必须有定时器驱动（之前只渲染一次，页面上的时间是不动的）
check('倒计时每秒刷新', desktop.includes('setInterval(tick,1000)') && desktop.includes('clearInterval(tickTimer)'));
check(
  '三档状态样式齐全（正常/临期/已失效）',
  desktop.includes("countdown.className='countdown warn'") &&
    desktop.includes("countdown.className='countdown urgent'") &&
    desktop.includes("countdown.className='countdown gone'")
);
check('失效文案明确要求重新下单', desktop.includes('二维码已失效，请重新下单'));
check('倒计时数字字号放大', /\.countdown strong\{[^}]*font-size:2[0-9]px/.test(desktop));
check('顶部只保留品牌图（无 ¥ 方块）', !desktop.includes('brand-mark') && !desktop.includes('¥'));
check('商品信息在平台订单号上方', desktop.indexOf('class="goods"') < desktop.indexOf('class="order-id"'));
check('商品信息 14px', /\.goods\{[^}]*font-size:14px/.test(desktop));
check(
  '订单号单行、超长省略',
  /\.order-id\{[^}]*white-space:nowrap/.test(desktop) &&
    /\.order-id-no\{[^}]*text-overflow:ellipsis/.test(desktop)
);
check('失效后隐藏「请付款」与扫码提示', desktop.includes("amountNotice.style.display='none'") && desktop.includes("payHint.style.display='none'"));
check('后台标签页暂停网络轮询', desktop.includes("if(document.hidden){schedulePoll(2000);return}"));
check('支付成功保留支付宝关闭与签名回跳', desktop.includes("closeWebview") && desktop.includes("location.href=url"));

const inlineScript = desktop.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
try {
  new Script(inlineScript);
  check('内联支付脚本语法正确', true);
} catch {
  check('内联支付脚本语法正确', false);
}

const mobileAlipay = render({}, { userAgent: 'Mozilla/5.0 (iPhone) AlipayClient/10.5' });
check('支付宝移动端保留唤醒链接', mobileAlipay.includes('alipays://platformapi/startapp') && mobileAlipay.includes('启动支付宝'));
check('支付宝移动端保留复制金额', mobileAlipay.includes("copyText(amount)"));

const mobileWx = render(
  { type: 1, pay_url: 'wxp://EXAMPLE_PAY_CODE' },
  { userAgent: 'Mozilla/5.0 (iPhone) MicroMessenger/8.0' }
);
check('微信移动端保留唤醒与保存二维码', mobileWx.includes('weixin://') && mobileWx.includes('保存二维码'));
check('微信付款码经过本地二维码接口', mobileWx.includes(encodeURIComponent('wxp://EXAMPLE_PAY_CODE')));
const fixedImage = render(
  { type: 1, pay_url: '/upload/fixed-10-01.png', pay_url_type: 1, passage_id: 2 },
  { passage: null }
);
check(
  '订单级图片固定码直接展示',
  fixedImage.includes('/upload/fixed-10-01.png') &&
    !fixedImage.includes(encodeURIComponent('/upload/fixed-10-01.png'))
);

const fixedText = render(
  { type: 1, pay_url: 'wxp://FIXED_10_01', pay_url_type: 0, passage_id: 2 },
  { passage: null }
);
check('订单级文本固定码现场生成二维码', fixedText.includes(encodeURIComponent('wxp://FIXED_10_01')));

const direct = render({ pay_url: 'https://cdn.example.com/personal-qr.png', pay_url_type: 1 }, { passage: { ...passage, ewm_type: 2 } });
check('直接图片收款码不再二次编码', direct.includes('src="https://cdn.example.com/personal-qr.png"'));

const rmbMobile = render(
  { type: 4, pay_url: '' },
  { userAgent: 'Mozilla/5.0 (Android) Mobile', passage: { ...passage, zf_pid: 'WALLET-DEMO' } }
);
check('数字人民币移动端保留钱包编码与复制', rmbMobile.includes('WALLET-DEMO') && rmbMobile.includes('复制钱包编码'));

const rmbDesktop = render({ type: 4, pay_url: '' }, { settings: { url: 'https://example.com/wallet' } });
check('数字人民币桌面端保留浏览器二维码', rmbDesktop.includes(encodeURIComponent('https://example.com/wallet')));

const expired = render({ status: 3 });
check('过期订单立即显示过期状态', expired.includes("if(true)showExpired()"));

console.log(failures === 0 ? '\n全部通过' : `\n失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
