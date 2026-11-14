import type { Env } from './db';
import { getConfig, setConfig } from './db';
import { isSecureRequest } from './util';

/** base64url */
export function b64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64u(s: string): Uint8Array {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const enc = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function sign(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

export async function verifySig(payload: string, sig: string, secret: string): Promise<boolean> {
  try {
    const key = await hmacKey(secret);
    return await crypto.subtle.verify('HMAC', key, unb64u(sig), enc.encode(payload));
  } catch {
    return false;
  }
}

/** 后台会话密钥：首次自动生成并落库 */
export async function adminSecret(env: Env): Promise<string> {
  let s = await getConfig(env, 'admin_secret');
  if (!s) {
    s = b64u(crypto.getRandomValues(new Uint8Array(32)));
    await setConfig(env, 'admin_secret', s);
  }
  return s;
}

export interface AdminSession {
  u: string;
  id?: number;
  exp: number;
}

const COOKIE = 'vmq_admin';
const TTL = 60 * 60 * 12;

export async function issueCookie(
  env: Env,
  req: Request,
  username: string,
  id?: number
): Promise<string> {
  const secret = await adminSecret(env);
  const payload = b64u(
    enc.encode(JSON.stringify({ u: username, id, exp: Math.floor(Date.now() / 1000) + TTL }))
  );
  const sig = await sign(payload, secret);
  const secure = isSecureRequest(req, env) ? '; Secure' : '';
  return `${COOKIE}=${payload}.${sig}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL}${secure}`;
}

export function clearCookie(req?: Request, env?: Env): string {
  const secure = req && env && isSecureRequest(req, env) ? '; Secure' : '';
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export interface CurrentAdmin {
  id: number;
  username: string;
  role: number;
  status: number;
}

/** 已验证签名的会话还要再查一次管理员表，确保账号存在且仍处于启用状态。 */
export async function currentAdmin(req: Request, env: Env): Promise<CurrentAdmin | null> {
  const session = await readSession(req, env);
  if (!session?.id) return null;
  const row = await env.DB.prepare(
    'SELECT id, username, role, status FROM admins WHERE id = ? LIMIT 1'
  )
    .bind(session.id)
    .first<CurrentAdmin>();
  if (!row || Number(row.status) !== 1) return null;
  return {
    id: Number(row.id),
    username: String(row.username),
    role: Number(row.role),
    status: Number(row.status),
  };
}

export async function readSession(req: Request, env: Env): Promise<AdminSession | null> {
  const cookie = req.headers.get('cookie') ?? '';
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(cookie);
  if (!m) return null;
  const [payload, sig] = (m[1] ?? '').split('.');
  if (!payload || !sig) return null;
  const secret = await adminSecret(env);
  if (!(await verifySig(payload, sig, secret))) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(unb64u(payload))) as AdminSession;
    if (!s.exp || s.exp < Math.floor(Date.now() / 1000)) return null;
    return s;
  } catch {
    return null;
  }
}

/* ------------------------------ 密码 ------------------------------ */

const ITER = 60_000;

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    key,
    256
  );
  return `pbkdf2$${ITER}$${b64u(salt)}$${b64u(bits)}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iter = Number(parts[1]);
  const salt = unb64u(parts[2] ?? '');
  const want = parts[3] ?? '';
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    key,
    256
  );
  return b64u(bits) === want;
}

/* ------------------------------ 图形验证码 ------------------------------ */

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newCaptcha(len = 4): string {
  const buf = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(buf, (b) => CHARS[b % CHARS.length]).join('');
}

/** 极简 SVG 验证码，够用即可 */
export function captchaSvg(code: string): string {
  const w = 120;
  const h = 40;
  const colors = ['#1668dc', '#12a150', '#e5484d', '#8a5cf6'];
  const chars = [...code]
    .map((c, i) => {
      const x = 12 + i * 26 + Math.random() * 4;
      const y = 28 + Math.random() * 4;
      const rot = Math.random() * 16 - 8;
      const color = colors[i % colors.length];
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="24" font-family="monospace" fill="${color}" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})">${c}</text>`;
    })
    .join('');
  const lines = Array.from({ length: 3 }, () => {
    const x1 = Math.random() * w;
    const y1 = Math.random() * h;
    const x2 = Math.random() * w;
    const y2 = Math.random() * h;
    return `<line x1="${x1.toFixed(0)}" y1="${y1.toFixed(0)}" x2="${x2.toFixed(0)}" y2="${y2.toFixed(0)}" stroke="#d9dde3" stroke-width="1"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#f7f8fa"/>${lines}${chars}</svg>`;
}
