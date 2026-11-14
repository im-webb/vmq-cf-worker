import type { OrderRow, PassageRow } from '../lib/db';

interface PayPageOptions {
  resourceUrl: string;
  closeMinutes: number;
  passage: PassageRow | null;
  settings: Record<string, string>;
  userAgent: string;
  origin: string;
  serverNow: number;
}

/**
 * 支付方式 → 顶部品牌图（图标 + 文字，PNG 透明底的两倍图，按 2x 尺寸引用）。
 * w/h 是页面上的显示尺寸，图片本身是它的 2 倍，高清屏下不发虚。
 */
const PAYMENT: Record<number, { label: string; logo: string; w: number; h: number }> = {
  1: { label: '微信支付', logo: 'wxpay-text.png', w: 136, h: 40 },
  2: { label: '支付宝', logo: 'alipay-text.png', w: 104, h: 40 },
  3: { label: 'QQ 钱包', logo: 'qqpay.png', w: 138, h: 40 },
  4: { label: '数字人民币', logo: 'rmbpay.png', w: 137, h: 40 },
};

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char] ?? char);
}

function js(value: unknown): string {
  return (JSON.stringify(value) ?? 'null')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function renderPayPage(order: OrderRow, opt: PayPageOptions): string {
  const payment = PAYMENT[order.type] ?? PAYMENT[1]!;
  const res = opt.resourceUrl.replace(/\/+$/, '');
  const isMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(opt.userAgent);
  const isAlipay = /alipay/i.test(opt.userAgent);
  const expireAt = order.create_time + opt.closeMinutes * 60;

  let qrPayload = order.pay_url;
  if (order.type === 4 && !qrPayload && !isMobile) {
    qrPayload = opt.settings['url'] || opt.origin;
  }

  // 固定金额码可能是图片，必须用订单保存时的类型判断；
  // 旧订单没有 pay_url_type 时继续回退所属通道的 ewm_type。
  const payUrlType = Number(order.pay_url_type ?? opt.passage?.ewm_type ?? 0);
  const directImage = Boolean(order.pay_url && qrPayload === order.pay_url && payUrlType !== 0);
  const qrSrc = qrPayload
    ? directImage
      ? qrPayload
      : `/enQrcode?url=${encodeURIComponent(qrPayload)}`
    : '';
  const walletCode = order.type === 4 && !order.pay_url ? opt.passage?.zf_pid ?? '' : '';
  const alipayTarget = order.pay_url || qrPayload;
  const alipayLaunch = `alipays://platformapi/startapp?appId=20000067&url=${encodeURIComponent(alipayTarget)}`;
  const canSaveQr = isMobile && qrSrc && (order.type === 1 || order.type === 3 || (order.type === 4 && order.pay_url));
  const showWallet = isMobile && walletCode;
  const adjustedNotice = order.money !== order.truemoney
    ? `温馨提示：${order.money}元已被其他用户占用，请您务必付款${order.truemoney}元，多付一分或者少付一分都不能到账！`
    : '';
  const logo = `${res}/static/pay/3/img/${payment.logo}`;
  const paidImage = `${res}/static/pay/3/img/pay_ok.png`;
  const expiredImage = `${res}/static/pay/3/img/qrcode_timeout.png`;

  const qrBlock = showWallet
    ? `<div class="wallet" id="wallet"><span>钱包编码</span><strong>${esc(walletCode)}</strong></div>`
    : qrSrc
      ? `<img id="qr-image" class="qr-image" src="${esc(qrSrc)}" width="220" height="220" alt="${esc(payment.label)}付款二维码" decoding="async">`
      : '<p class="empty">当前订单未配置付款二维码</p>';

  const mobileActions = isMobile
    ? `<div class="actions" id="payment-actions">
      ${canSaveQr ? '<button type="button" class="action secondary" id="save-qr">保存二维码</button>' : ''}
      ${order.type === 1 ? '<a class="action primary" href="weixin://">启动微信</a>' : ''}
      ${order.type === 2 && alipayTarget ? `<a class="action primary" id="open-alipay" href="${esc(alipayLaunch)}">启动支付宝</a>` : ''}
      ${showWallet ? '<button type="button" class="action primary" id="copy-wallet">复制钱包编码</button><button type="button" class="action secondary" id="copy-amount-wallet">复制金额</button>' : ''}
    </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#f5f7fb">
<title>安全支付</title>
<style>
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;min-width:320px;background:#f5f7fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}button,a{-webkit-tap-highlight-color:transparent}button{font:inherit}.page{width:100%;max-width:460px;margin:0 auto;padding:28px 18px calc(28px + env(safe-area-inset-bottom))}.brand{display:flex;align-items:center;justify-content:center;gap:11px;margin-bottom:22px;font-size:16px;font-weight:650}.brand img{height:40px;max-width:170px;object-fit:contain;object-position:left center}.card{padding:22px;background:#fff;border:1px solid #e8edf4;border-radius:20px;box-shadow:0 10px 35px rgba(30,64,175,.06);text-align:center}.meta{padding:0 2px 18px;border-bottom:1px solid #edf0f5;text-align:left}.order-id{display:flex;align-items:baseline;gap:8px;min-width:0;margin:8px 0 0;color:#64748b;font-size:12px;line-height:1.6;white-space:nowrap}.order-id-label{flex:none}.order-id-no{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#334155;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.goods{margin:0;color:#64748b;font-size:14px;line-height:1.6;word-break:break-all}.amount{margin:22px 0 18px;color:#2563eb;font-size:38px;font-weight:750;letter-spacing:-1px;line-height:1}.amount small{margin-left:5px;font-size:15px;letter-spacing:0}.qr-box{display:grid;place-items:center;width:244px;max-width:100%;min-height:244px;margin:0 auto;padding:11px;border:1px solid #e7ecf3;border-radius:16px;background:#fff}.qr-image{display:block;width:220px;height:220px;max-width:100%;object-fit:contain}.wallet{display:grid;gap:10px;max-width:100%;padding:30px 8px;color:#64748b;font-size:13px}.wallet strong{color:#172033;font-size:20px;word-break:break-all}.empty{margin:40px 12px;color:#94a3b8;font-size:14px}.notice{margin:18px 0 0;color:#dc2626;font-size:13px;line-height:1.7}.notice strong{font-weight:700}.countdown{margin:12px 0 0;color:#b91c1c;font-size:14px;line-height:1.7}.countdown strong{font-size:23px;font-weight:750;font-variant-numeric:tabular-nums;letter-spacing:.5px}.countdown.warn{color:#b45309;font-weight:600}.countdown.warn strong{color:#d97706}.countdown.urgent strong{animation:cd-blink 1s steps(2,end) infinite}.countdown.gone{font-size:17px;font-weight:700;padding:10px 12px;border-radius:10px;background:#fef2f2}@keyframes cd-blink{50%{opacity:.35}}.hint{margin:20px 0 0;color:#7b8798;font-size:14px;line-height:1.7}.actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:18px}.action{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 12px;border:0;border-radius:11px;text-decoration:none;font-size:13px;font-weight:650;cursor:pointer}.action:only-child{grid-column:1/-1}.action.primary{background:#2563eb;color:#fff}.action.secondary{background:#eef4ff;color:#2554c7}.action:active{transform:translateY(1px)}.action:focus-visible{outline:3px solid rgba(37,99,235,.25);outline-offset:2px}.status{display:none;margin:22px 0 0;padding:13px;border-radius:11px;background:#f0fdf4;color:#15803d;font-size:14px;font-weight:650}.status.expired{background:#fef2f2;color:#b91c1c}.toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));z-index:5;max-width:calc(100% - 36px);padding:11px 17px;border-radius:10px;background:rgba(15,23,42,.92);color:#fff;font-size:13px;opacity:0;pointer-events:none;transform:translate(-50%,8px);transition:.18s}.toast.show{opacity:1;transform:translate(-50%,0)}@media(max-width:380px){.page{padding:18px 12px calc(20px + env(safe-area-inset-bottom))}.card{padding:18px 14px;border-radius:16px}.amount{font-size:34px}.qr-box{width:224px;min-height:224px}.qr-image{width:200px;height:200px}.actions{grid-template-columns:1fr}}@media(min-width:700px){.page{padding-top:42px}}
</style>
</head>
<body>
<main class="page">
  <header class="brand"><img src="${esc(logo)}" width="${payment.w}" height="${payment.h}" alt="${esc(payment.label)}"></header>
  <section class="card" aria-label="订单支付">
    <div class="meta">
      <p class="goods">商品信息：${esc(order.name)}</p>
      <p class="order-id"><span class="order-id-label">平台订单号</span><span class="order-id-no">${esc(order.order_id)}</span></p>
    </div>
    <div class="amount">${esc(order.truemoney)}<small>元</small></div>
    <div class="qr-box" id="qr-box">${qrBlock}</div>
    <div class="status" id="status" role="status" aria-live="polite"></div>
    <p class="notice" id="amount-notice">请付款 <strong>${esc(order.truemoney)}</strong> 元，不能多付或少付${order.type === 2 && opt.passage?.money_change === 1 ? `，备注：<strong>${esc(order.order_id)}</strong>` : ''}</p>
    <p class="countdown" id="countdown">二维码有效时间 <strong>--:--</strong>，失效勿付</p>
    ${mobileActions}
    <p class="hint" id="payment-hint">请使用${esc(payment.label)}扫一扫</p>
  </section>
</main>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>
(function(){
  var orderId=${js(order.order_id)};
  var amount=${js(order.truemoney)};
  var walletCode=${js(walletCode)};
  var qrSrc=${js(qrSrc)};
  var expireAt=${expireAt};
  var serverNow=${opt.serverNow};
  var timeoutUrl=${js(opt.settings['timeout_url'] ?? '')};
  var notice=${js(adjustedNotice)};
  var paidImage=${js(paidImage)};
  var expiredImage=${js(expiredImage)};
  var alipay=${js(isAlipay)};
  var done=false;
  var expired=false;
  var pending=false;
  var pollTimer=0;
  var tickTimer=0;
  var WARN_SECONDS=60;
  var URGENT_SECONDS=10;
  var endAt=Date.now()+Math.max(0,expireAt-serverNow)*1000;
  var qrBox=document.getElementById('qr-box');
  var statusBox=document.getElementById('status');
  var countdown=document.getElementById('countdown');
  var toastTimer=0;

  function toast(text){
    var el=document.getElementById('toast');
    el.textContent=text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer=setTimeout(function(){el.classList.remove('show')},1600);
  }

  function fallbackCopy(text){
    var input=document.createElement('textarea');
    input.value=text;
    input.style.position='fixed';
    input.style.opacity='0';
    document.body.appendChild(input);
    input.select();
    var ok=false;
    try{ok=document.execCommand('copy')}catch(e){}
    document.body.removeChild(input);
    return ok;
  }

  function copyText(text){
    if(navigator.clipboard&&window.isSecureContext){
      navigator.clipboard.writeText(text).then(function(){toast('复制成功')},function(){toast(fallbackCopy(text)?'复制成功':'复制失败，请手动复制')});
    }else{
      toast(fallbackCopy(text)?'复制成功':'复制失败，请手动复制');
    }
  }

  function showState(kind,text){
    // text 为空表示不占用状态条（失效态由倒计时区块单独承载，避免两条重复提示）
    if(text){
      statusBox.textContent=text;
      statusBox.className='status'+(kind==='expired'?' expired':'');
      statusBox.style.display='block';
    }
    var image=qrBox.querySelector('img');
    if(image){
      image.src=kind==='paid'?paidImage:expiredImage;
      image.alt=text||'二维码已失效';
    }
    var actions=document.getElementById('payment-actions');
    if(actions)actions.style.display='none';
    // 失效后还挂着「请付款 X 元」「请使用××扫一扫」会诱导用户去扫一张废码，一起收起来
    if(kind==='expired'){
      var amountNotice=document.getElementById('amount-notice');
      if(amountNotice)amountNotice.style.display='none';
      var payHint=document.getElementById('payment-hint');
      if(payHint)payHint.style.display='none';
    }
  }

  function showExpired(){
    if(expired)return;
    expired=true;
    clearInterval(tickTimer);
    countdown.className='countdown gone';
    countdown.textContent='二维码已失效，请重新下单';
    showState('expired','');
  }

  /**
   * 每秒刷新剩余时间：
   *   正常 → 「二维码有效时间 mm:ss」
   *   最后 60 秒 → 橙色「即将失效，请尽快付款」
   *   最后 10 秒 → 数字闪烁
   * 归零直接走 showExpired()。
   */
  function tick(){
    if(done||expired)return;
    var left=Math.max(0,Math.ceil((endAt-Date.now())/1000));
    if(left<=0){showExpired();return}
    var mm=String(Math.floor(left/60)).padStart(2,'0');
    var ss=String(left%60).padStart(2,'0');
    if(left<=URGENT_SECONDS){
      countdown.className='countdown urgent';
      countdown.innerHTML='二维码即将失效 <strong>'+mm+':'+ss+'</strong>，请立即付款';
    }else if(left<=WARN_SECONDS){
      countdown.className='countdown warn';
      countdown.innerHTML='二维码即将失效 <strong>'+mm+':'+ss+'</strong>，请尽快付款';
    }else{
      countdown.className='countdown';
      countdown.innerHTML='二维码有效时间 <strong>'+mm+':'+ss+'</strong>，失效勿付';
    }
  }

  function finishSuccess(url){
    if(done)return;
    done=true;
    clearTimeout(pollTimer);
    clearInterval(tickTimer);
    showState('paid','支付成功，正在跳转…');
    countdown.className='countdown';
    countdown.textContent='支付成功';
    setTimeout(function(){
      if(alipay){
        if(window.AlipayJSBridge){
          window.AlipayJSBridge.call('closeWebview');
        }else{
          window.open('','_self').close();
        }
        setTimeout(function(){location.href=url},500);
      }else{
        location.href=url;
      }
    },900);
  }

  function schedulePoll(delay){
    if(done)return;
    clearTimeout(pollTimer);
    pollTimer=setTimeout(poll,delay);
  }

  function poll(){
    if(done||pending)return;
    if(document.hidden){schedulePoll(2000);return}
    pending=true;
    fetch('/checkOrder',{
      method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded'},
      body:'orderId='+encodeURIComponent(orderId),
      cache:'no-store'
    }).then(function(response){
      if(!response.ok)throw new Error('network');
      return response.json();
    }).then(function(res){
      pending=false;
      if(res&&res.code===1){
        finishSuccess(res.data&&res.data.url?res.data.url:'/');
      }else if(res&&res.msg==='已过期'){
        done=true;
        showExpired();
        if(timeoutUrl)location.replace(timeoutUrl);
      }else{
        schedulePoll(expired?10000:1500);
      }
    }).catch(function(){
      pending=false;
      schedulePoll(expired?5000:2000);
    });
  }

  var saveButton=document.getElementById('save-qr');
  if(saveButton)saveButton.addEventListener('click',function(){
    copyText(amount);
    var link=document.createElement('a');
    link.href=qrSrc;
    link.download='payment-'+orderId;
    document.body.appendChild(link);
    link.click();
    link.remove();
  });
  var alipayButton=document.getElementById('open-alipay');
  if(alipayButton)alipayButton.addEventListener('click',function(){copyText(amount)});
  var walletButton=document.getElementById('copy-wallet');
  if(walletButton)walletButton.addEventListener('click',function(){copyText(walletCode)});
  var walletAmountButton=document.getElementById('copy-amount-wallet');
  if(walletAmountButton)walletAmountButton.addEventListener('click',function(){copyText(amount)});
  document.addEventListener('visibilitychange',function(){
    if(!document.hidden){tick();poll()}
  });

  tick();
  tickTimer=setInterval(tick,1000);
  if(${order.status === 3 ? 'true' : 'false'})showExpired();
  poll();
  if(notice)window.alert(notice);
})();
</script>
</body>
</html>`;
}
