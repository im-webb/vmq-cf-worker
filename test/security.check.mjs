#!/usr/bin/env node
/** 后台登录、RBAC、密钥查看和公开暴露面回归。 */
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { hashPassword, issueCookie } from '../src/lib/auth.ts';
import { handleCaptcha, handleLoginPost } from '../src/routes/auth.ts';
import { handleAdminApi } from '../src/routes/api-admin.ts';
import { saveAdmin } from '../src/modules/system/system.service.ts';

function makeDb(state) {
  return {
    prepare(sql) {
      const q = sql.replace(/\s+/g, ' ').trim();
      let args = [];
      const stmt = {
        bind(...next) {
          args = next;
          return stmt;
        },
        async first() {
          if (q.includes('FROM auth_attempt')) {
            const [bucket, cutoff] = args;
            const rows = state.authAttempts.filter(
              (row) => row.bucket === bucket && row.created_at >= Number(cutoff)
            );
            return { c: rows.length, last_at: rows.length ? Math.max(...rows.map((r) => r.created_at)) : null };
          }
          if (q === "SELECT v FROM config WHERE k = 'admin_alias'") {
            return { v: String(state.config.admin_alias ?? 'admin') };
          }
          if (q === 'SELECT v FROM config WHERE k = ?') {
            const value = state.config[String(args[0])];
            return value === undefined ? null : { v: String(value) };
          }
          if (q.includes('SELECT id, username, role, status FROM admins WHERE id = ?')) {
            const row = state.admins.find((admin) => admin.id === Number(args[0]));
            return row ? { id: row.id, username: row.username, role: row.role, status: row.status } : null;
          }
          if (q.includes('SELECT id, username, password_hash, status FROM admins WHERE username = ?')) {
            const row = state.admins.find((admin) => admin.username === String(args[0]));
            return row
              ? { id: row.id, username: row.username, password_hash: row.password_hash, status: row.status }
              : null;
          }
          if (q.includes('SELECT id, username, role, head_img, status FROM admins WHERE id = ?')) {
            const row = state.admins.find((admin) => admin.id === Number(args[0]));
            return row ? { ...row } : null;
          }
          if (q.includes('SELECT id FROM admins WHERE username = ? AND id <> ?')) {
            const row = state.admins.find(
              (admin) => admin.username === String(args[0]) && admin.id !== Number(args[1])
            );
            return row ? { id: row.id } : null;
          }
          if (q.includes('SELECT COUNT(*) AS c FROM admins WHERE role = 1 AND status = 1')) {
            const excluded = new Set(args.map(Number));
            return {
              c: state.admins.filter(
                (admin) => admin.role === 1 && admin.status === 1 && !excluded.has(admin.id)
              ).length,
            };
          }
          if (q.includes('SELECT password_hash FROM admins WHERE id = ? AND status = 1')) {
            const row = state.admins.find((admin) => admin.id === Number(args[0]) && admin.status === 1);
            return row ? { password_hash: row.password_hash } : null;
          }
          if (q === 'SELECT COUNT(*) AS c FROM admins') return { c: state.admins.length };
          return null;
        },
        async all() {
          if (q === 'SELECT k, v FROM config') {
            return { results: Object.entries(state.config).map(([k, v]) => ({ k, v })) };
          }
          return { results: [] };
        },
        async run() {
          if (q.startsWith('INSERT INTO auth_attempt')) {
            state.authAttempts.push({ bucket: String(args[0]), created_at: Number(args[1]) });
          } else if (q.startsWith('DELETE FROM auth_attempt WHERE bucket')) {
            state.authAttempts = state.authAttempts.filter((row) => row.bucket !== String(args[0]));
          } else if (q.startsWith('UPDATE admins SET login_time')) {
            const row = state.admins.find((admin) => admin.id === Number(args[1]));
            if (row) row.login_time = Number(args[0]);
          } else if (q.startsWith('UPDATE admins SET username = ?')) {
            const row = state.admins.find((admin) => admin.id === Number(args[6] ?? args[5]));
            if (row) {
              row.username = String(args[0]);
              row.role = Number(args[1]);
              row.status = Number(args[2]);
              row.head_img = String(args[3]);
            }
          } else if (q.startsWith('INSERT INTO logs')) {
            state.logs.push(args.map(String));
          } else if (q.startsWith('INSERT INTO config')) {
            state.config[String(args[0])] = String(args[1]);
          }
          return { meta: { changes: 1, last_row_id: 1 } };
        },
      };
      return stmt;
    },
    async batch(statements) {
      for (const statement of statements) await statement.run();
      return [];
    },
  };
}

async function makeState(overrides = {}) {
  return {
    config: {
      admin_secret: 'test-only-admin-secret', // check-leak-ignore
      admin_captcha: '1',
      key: 'test-only-comm-key',
      epaykey_ali: 'test-only-epay-key',
      admin_alias: 'ops-console',
      ...overrides.config,
    },
    admins: [
      {
        id: 1,
        username: 'root_admin',
        role: 1,
        status: 1,
        password_hash: await hashPassword('root-pass-123'),
        login_time: 0,
      },
      {
        id: 2,
        username: 'operator_admin',
        role: 2,
        status: 1,
        password_hash: await hashPassword('operator-pass-123'),
        login_time: 0,
      },
    ],
    authAttempts: [],
    logs: [],
    ...overrides,
  };
}

function envOf(state) {
  return {
    DB: makeDb(state),
    ASSETS: { fetch: async () => new Response('asset') },
    RESOURCE_URL: '',
  };
}

function cookieOf(response, name) {
  const cookies = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
  return cookies.map((value) => value.split(';')[0]).find((value) => value.startsWith(`${name}=`)) ?? '';
}

/* ---------- 验证码 Cookie 不含明文，登录成功 Cookie 带 Secure ---------- */
{
  const state = await makeState();
  const env = envOf(state);
  const req = new Request('https://admin.example.test/api/admin/captcha');
  const captcha = await handleCaptcha(env, req);
  const cookie = cookieOf(captcha, 'vmq_cap');
  assert.match((captcha.headers.getSetCookie?.() ?? []).join('\n'), /; Secure/);
  const value = cookie.split('=')[1] ?? '';
  assert.match(value, /^\d+\.[A-Za-z0-9_-]+$/, '验证码 Cookie 必须是 exp.HMAC，不能包含答案');
  const svg = await captcha.text();
  const code = [...svg.matchAll(/>([A-Z2-9])<\/text>/g)].map((m) => m[1]).join('');
  assert.equal(code.length, 4, '测试应能从 SVG 提取验证码');
  const login = await handleLoginPost(
    new Request('https://admin.example.test/api/admin/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'cf-connecting-ip': '203.0.113.10',
        cookie,
      },
      body: new URLSearchParams({
        username: 'root_admin',
        password: 'root-pass-123',
        captcha: code,
      }),
    }),
    env
  );
  const payload = await login.json();
  assert.equal(payload.code, 1, '正确验证码与密码应登录成功');
  const adminCookie = cookieOf(login, 'vmq_admin');
  assert.match(adminCookie, /^vmq_admin=/);
  assert.match((login.headers.getSetCookie?.() ?? []).join('\n'), /; Secure/);
}

/* ---------- 连续失败触发账号锁定 ---------- */
{
  const state = await makeState({ config: { admin_captcha: '0' } });
  const env = envOf(state);
  for (let i = 0; i < 5; i++) {
    const res = await handleLoginPost(
      new Request('https://admin.example.test/api/admin/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'cf-connecting-ip': '198.51.100.8',
        },
        body: new URLSearchParams({ username: 'root_admin', password: 'wrong-pass' }),
      }),
      env
    );
    assert.equal((await res.json()).code, 0);
  }
  const locked = await handleLoginPost(
    new Request('https://admin.example.test/api/admin/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'cf-connecting-ip': '198.51.100.8',
      },
      body: new URLSearchParams({ username: 'root_admin', password: 'root-pass-123' }),
    }),
    env
  );
  const lockedPayload = await locked.json();
  assert.equal(lockedPayload.code, 0);
  assert.match(lockedPayload.msg, /尝试过多/);
}

/* ---------- 配置接口不返回密钥明文；普通管理员写配置被拒绝 ---------- */
{
  const state = await makeState();
  const env = envOf(state);
  const superReq = new Request('https://admin.example.test/api/admin/config');
  const superCookie = (await issueCookie(env, superReq, 'root_admin', 1)).split(';')[0];
  const configRes = await handleAdminApi(
    new Request('https://admin.example.test/api/admin/config', { headers: { cookie: superCookie } }),
    env,
    '/config'
  );
  const configPayload = await configRes.json();
  assert.equal(configPayload.code, 1);
  assert.equal(Object.hasOwn(configPayload.data.config, 'key'), false);
  assert.equal(Object.hasOwn(configPayload.data.config, 'epaykey_ali'), false);
  assert.equal(configPayload.data.secretSet.key, true);

  const reveal = await handleAdminApi(
    new Request('https://admin.example.test/api/admin/config/secret/reveal', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'cf-connecting-ip': '203.0.113.20',
        cookie: superCookie,
      },
      body: new URLSearchParams({ key: 'key', password: 'root-pass-123' }),
    }),
    env,
    '/config/secret/reveal'
  );
  const revealPayload = await reveal.json();
  assert.equal(revealPayload.data.value, 'test-only-comm-key');
  assert.ok(state.logs.some((row) => row[1] === '查看密钥：key'), '查看密钥必须写审计日志');

  const operatorReq = new Request('https://admin.example.test/api/admin/me');
  const operatorCookie = (await issueCookie(env, operatorReq, 'operator_admin', 2)).split(';')[0];
  const denied = await handleAdminApi(
    new Request('https://admin.example.test/api/admin/config', {
      method: 'PUT',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: operatorCookie,
      },
      body: new URLSearchParams({ title: 'nope' }),
    }),
    env,
    '/config'
  );
  assert.equal(denied.status, 403, '普通管理员不能修改配置');

  const demote = await saveAdmin(
    env,
    { username: 'root_admin', role: '2', status: '1', head_img: '' },
    1
  );
  assert.equal(demote.code, 0);
  assert.match(demote.msg, /至少保留一个/);
}

/* ---------- /api/stats、/__status、/admin 和 /enQrcode ---------- */
{
  const state = await makeState();
  const env = envOf(state);
  const health = await worker.fetch(new Request('https://admin.example.test/api/health'), env, {});
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(health.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.ok(health.headers.get('Content-Security-Policy')?.includes("frame-ancestors 'none'"));
  assert.equal(health.headers.get('Strict-Transport-Security'), 'max-age=31536000');
  assert.equal(health.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');

  const stats = await worker.fetch(new Request('https://admin.example.test/api/stats'), env, {});
  assert.equal(stats.status, 401);
  const status = await worker.fetch(new Request('https://admin.example.test/__status'), env, {});
  assert.equal(status.status, 404);
  const oldAdmin = await worker.fetch(new Request('https://admin.example.test/admin'), env, {});
  assert.equal(oldAdmin.status, 404, '别名不是 admin 时 /admin 不应再提供后台入口');

  const qrNoRef = await worker.fetch(
    new Request('https://admin.example.test/enQrcode?url=wxp%3A%2F%2Fexample-test'),
    env,
    {}
  );
  assert.equal(qrNoRef.status, 403);
  const qr = await worker.fetch(
    new Request('https://admin.example.test/enQrcode?url=wxp%3A%2F%2Fexample-test', {
      headers: { referer: 'https://admin.example.test/pay/test' },
    }),
    env,
    {}
  );
  assert.equal(qr.status, 200);
  assert.equal(qr.headers.get('cache-control'), 'private, max-age=300');
}

/* ---------- 已初始化但管理员为空时，/setup 必须有 SETUP_TOKEN ---------- */
{
  const state = await makeState({ config: { setup_done: '1' } });
  state.admins = [];
  const env = envOf(state);
  const noToken = await worker.fetch(new Request('https://admin.example.test/setup'), env, {});
  assert.equal(noToken.status, 404);
  const withTokenEnv = { ...env, SETUP_TOKEN: 'test-only-setup-token' }; // check-leak-ignore
  const withToken = await worker.fetch(
    new Request('https://admin.example.test/setup?token=test-only-setup-token'),
    withTokenEnv,
    {}
  );
  assert.equal(withToken.status, 200);
}

console.log('全部通过（验证码、限速、RBAC、密钥审计、暴露面与安全头）');
