/**
 * HTTP 冒烟：只验证「对外可访问的入口」是否正常。
 *
 * 检查重点：
 *   1. 站点前台（apps/web 产物）能正常返回
 *   2. 后台任何路径都落到 SPA 外壳，且**不再返回第三方模板**
 *   3. 支付页要用的本地静态资源可直接取到
 *   4. 监控端接口与健康检查仍在线
 *
 * 领域逻辑（金额匹配、二维码、签名）由 test/*.check.mjs 覆盖，这里不重复。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { findLocalD1 } from './local-db.mjs';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const DB = findLocalD1();

/**
 * 后台别名。依次尝试：环境变量 → config 表 → wrangler.local.jsonc 的 vars。
 *
 * **不设硬编码默认值**：真实别名不应出现在源码里。三者都取不到时返回空串，
 * 相关断言整组跳过。
 */
function resolveAlias() {
  if (process.env.ALIAS) return process.env.ALIAS;
  try {
    const v = execFileSync('sqlite3', [DB, "SELECT v FROM config WHERE k='admin_alias'"], {
      encoding: 'utf8',
    }).trim();
    if (v) return v;
  } catch {
    /* 库还没建，继续往下试 */
  }
  try {
    const m = /"ADMIN_ALIAS"\s*:\s*"([^"]+)"/.exec(readFileSync('wrangler.local.jsonc', 'utf8'));
    if (m?.[1]) return m[1];
  } catch {
    /* 没有本地配置文件（CI / 新 clone），跳过 */
  }
  return '';
}

const ALIAS = resolveAlias();

let pass = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`✓ ${name}${detail ? '  ' + detail : ''}`);
    pass++;
  } else {
    console.log(`✗ ${name}${detail ? '  ' + detail : ''}`);
    failures.push(name);
  }
}

async function get(path, init = {}) {
  const r = await fetch(`${BASE}${path}`, { redirect: 'manual', ...init });
  return { status: r.status, type: r.headers.get('content-type') ?? '', text: await r.text(), loc: r.headers.get('location') ?? '' };
}

console.log(`\n=== 站点前台（apps/web）===`);
for (const p of ['/', '/doc.html', '/api.html', '/demo.html', '/result.html', '/chaorder.html']) {
  const r = await get(p);
  const ok = r.status === 200 && r.text.includes('<div id="root">') && !/<\?php|\{\$/.test(r.text);
  check(`${p}`, ok, `${r.status} ${r.text.length}B`);
}

console.log(`\n=== 后台入口：任何路径都应是 SPA 外壳 ===`);
if (!ALIAS) {
  console.log('（未取到后台别名，跳过该组断言；设置 ALIAS 环境变量或配置 ADMIN_ALIAS 后重跑）');
} else {
  const entry = await get(`/${ALIAS}`);
  check(
    `/${ALIAS}`,
    entry.status === 200 && entry.text.includes('<div id="root">'),
    `${entry.status} ${entry.text.length}B`
  );

  for (const legacy of ['/login/index', '/system.passage/index', '/system.config/index']) {
    const r = await get(`/${ALIAS}${legacy}`);
    const isSpa = r.status === 200 && r.text.includes('<div id="root">');
    // 旧后台是 layui 页面，SPA 外壳里不该出现相关 class/资源引用
    const noTpl = !/layui|layuimini/i.test(r.text);
    check(`旧路径 ${legacy} → SPA`, isSpa && noTpl, `${r.status} ${r.text.length}B`);
  }

  const consoleRedirect = await get('/console/index.html');
  check(
    '/console/index.html 跳回别名',
    consoleRedirect.status === 302 && consoleRedirect.loc.includes(`/${ALIAS}`),
    String(consoleRedirect.status)
  );
}

console.log(`\n=== 本地静态资源（不再依赖外部站）===`);
for (const [p, mustType] of [
  ['/favicon.ico', 'image'],
  ['/static/pay/3/img/alipay-text.png', 'image/png'],
  ['/static/pay/3/img/wxpay-text.png', 'image/png'],
  ['/static/pay/3/img/pay_ok.png', 'image/png'],
  ['/static/web/picture/alipay.png', 'image/png'],
  ['/static/web/picture/wxpay.png', 'image/png'],
]) {
  const r = await get(p);
  check(p, r.status === 200 && r.type.includes(mustType), `${r.status} ${r.type}`);
}

console.log(`\n=== 能力接口 ===`);
const health = await get('/api/health');
check('/api/health', health.status === 200 && health.text.includes('"ok":true'));

const qrDenied = await get('/enQrcode?url=https%3A%2F%2Fexample.com');
check('/enQrcode 拒绝无 Referer 请求', qrDenied.status === 403, String(qrDenied.status));
const qr = await get('/enQrcode?url=https%3A%2F%2Fexample.com', {
  headers: { referer: `${BASE}/pay/test` },
});
check('/enQrcode 同源页面生成二维码', qr.status === 200 && qr.type.includes('image/'), `${qr.status} ${qr.type}`);

const me = await get('/api/admin/me');
check('/api/admin/me 未登录 401', me.status === 401, String(me.status));

// 经营统计和状态页不再对匿名公开
const stats = await get('/api/stats');
check('/api/stats 未登录 401', stats.status === 401, String(stats.status));
const oldStatus = await get('/__status');
check('/__status 未登录 404', oldStatus.status === 404, String(oldStatus.status));

console.log(`\n通过 ${pass} 项，失败 ${failures.length} 项`);
if (failures.length) {
  console.log('失败项：' + failures.join('、'));
  process.exit(1);
}
