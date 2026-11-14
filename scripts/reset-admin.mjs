#!/usr/bin/env node
/**
 * 重置（或新建）后台管理员口令。
 *
 * 用法：
 *   node scripts/reset-admin.mjs                       # 重置 admin，随机生成 12 位口令
 *   node scripts/reset-admin.mjs admin 我的新密码        # 指定账号与口令
 *   node scripts/reset-admin.mjs --user ops --pass xxx  # 同上，显式参数
 *   node scripts/reset-admin.mjs --list                 # 只列出账号
 *
 * 只操作**本地** D1（.wrangler 下的 sqlite）。
 * 远程库请用：
 *   pnpm exec wrangler d1 execute vmq --remote --command "..."   （哈希见脚本输出）
 *
 * 口令哈希格式与 src/lib/auth.ts 保持一致：pbkdf2$迭代数$base64url(salt)$base64url(hash)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { join } from 'node:path';

const ITER = 60000;

function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hashPassword(pw) {
  const salt = randomBytes(16);
  const bits = pbkdf2Sync(pw, salt, ITER, 32, 'sha256');
  return `pbkdf2$${ITER}$${b64u(salt)}$${b64u(bits)}`;
}

function findDb() {
  const root = '.wrangler/state/v3/d1';
  if (!existsSync(root)) return null;
  for (const dir of readdirSync(root)) {
    const p = join(root, dir);
    if (!p.includes('miniflare')) continue;
    for (const f of readdirSync(p)) {
      if (f.endsWith('.sqlite') && !f.startsWith('metadata')) return join(p, f);
    }
  }
  return null;
}

function sql(db, statement) {
  // 用 stdin 传 SQL：哈希里有 $，走 shell 会被当变量展开
  return execFileSync('sqlite3', [db], { input: statement, encoding: 'utf8' });
}

/** 解析参数 */
const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  } else {
    positional.push(a);
  }
}

const db = findDb();
if (!db) {
  console.error('找不到本地 D1 数据库（.wrangler/state/v3/d1）。');
  console.error('先跑一次 `pnpm dev` 或 `pnpm db:local` 让 wrangler 建库。');
  process.exit(1);
}

if (flags.list) {
  const out = sql(
    db,
    'SELECT id || "  " || username || "  status=" || status || "  role=" || role FROM admins ORDER BY id;'
  );
  console.log(out.trim() || '（还没有任何管理员账号）');
  process.exit(0);
}

const user = String(flags.user ?? positional[0] ?? 'admin').trim();
const given = flags.pass ?? positional[1];
const pass = given ? String(given) : randomBytes(9).toString('base64url').slice(0, 12);

if (!/^[A-Za-z0-9_]{3,20}$/.test(user)) {
  console.error('账号需 3-20 位字母/数字/下划线');
  process.exit(1);
}
if (pass.length < 8) {
  console.error('口令至少 8 位');
  process.exit(1);
}

const hash = hashPassword(pass);
const exists = sql(db, `SELECT 1 FROM admins WHERE username = '${user}';`).trim();

sql(
  db,
  `INSERT INTO admins (username, password_hash, status, role, created_at) ` +
    `VALUES ('${user}', '${hash}', 1, 1, CAST(strftime('%s','now') AS INTEGER)) ` +
    `ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, status = 1;`
);

console.log(exists ? `已重置口令：${user}` : `已创建管理员：${user}`);
console.log(`口令：${pass}`);
console.log('\n登录地址：http://localhost:8787/admin/login');
console.log('（本地 admin_captcha=0 时不需要验证码；改成 1 会要求输入图形验证码）');

console.log('\n--- 远程库（Cloudflare D1）需要执行 ---');
console.log(
  `pnpm exec wrangler d1 execute vmq --remote --command "INSERT INTO admins (username,password_hash,status,role,created_at) VALUES ('${user}','${hash}',1,1,unixepoch()) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash,status=1;"`
);
