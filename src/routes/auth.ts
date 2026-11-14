/**
 * 后台登录：验证码签发与登录校验。
 *
 * 验证码保持无状态，但 Cookie 中只放过期时间和 HMAC(code+exp)，
 * 不再保存可被 atob 直接还原的验证码答案。
 */
import type { Env } from '../lib/db';
import { getConfig } from '../lib/db';
import {
  adminSecret,
  captchaSvg,
  issueCookie,
  newCaptcha,
  sign,
  verifyPassword,
  verifySig,
} from '../lib/auth';
import {
  checkLoginThrottle,
  clearLoginFailures,
  recordLoginFailure,
} from '../lib/auth-throttle';
import { clientIp, isSecureRequest, json, now, readParams } from '../lib/util';
import * as contentRepo from '../modules/content/content.repository';

const CAP_COOKIE = 'vmq_cap';
const CAP_TTL = 300;

function secureSuffix(req: Request, env: Env): string {
  return isSecureRequest(req, env) ? '; Secure' : '';
}

function captchaCookie(req: Request, env: Env, value: string, maxAge: number): string {
  return `${CAP_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureSuffix(req, env)}`;
}

/** 写操作日志。日志失败不影响主流程 */
function addLog(env: Env, uid: number, content: string, ip: string): Promise<void> {
  return contentRepo.addLog(env.DB, uid, content, ip);
}

async function captchaProof(code: string, exp: number, secret: string): Promise<string> {
  return sign(`captcha:${code.toUpperCase()}:${exp}`, secret);
}

export async function handleCaptcha(env: Env, req: Request): Promise<Response> {
  const code = newCaptcha();
  const secret = await adminSecret(env);
  const exp = Math.floor(Date.now() / 1000) + CAP_TTL;
  const sig = await captchaProof(code, exp, secret);
  return new Response(captchaSvg(code), {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'no-store',
      'set-cookie': captchaCookie(req, env, `${exp}.${sig}`, CAP_TTL),
    },
  });
}

async function checkCaptcha(req: Request, env: Env, input: string): Promise<boolean> {
  const cookie = req.headers.get('cookie') ?? '';
  const m = new RegExp(`(?:^|;\\s*)${CAP_COOKIE}=([^;]+)`).exec(cookie);
  if (!m) return false;
  const [expStr, sig] = (m[1] ?? '').split('.');
  const exp = Number(expStr);
  if (!expStr || !sig || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const secret = await adminSecret(env);
  const code = input.trim().toUpperCase();
  return verifySig(`captcha:${code}:${exp}`, sig, secret);
}

export async function handleLoginPost(req: Request, env: Env): Promise<Response> {
  const p = await readParams(req);
  const username = (p['username'] ?? '').trim();
  const password = p['password'] ?? '';
  const captcha = p['captcha'] ?? '';
  const ip = clientIp(req);

  const throttle = await checkLoginThrottle(env, username, ip);
  if (throttle.locked) {
    const mins = Math.max(1, Math.ceil(throttle.retryAfter / 60));
    return json({ code: 0, msg: `登录尝试过多，请 ${mins} 分钟后再试` });
  }

  const requireCaptcha = (await getConfig(env, 'admin_captcha', '1')) === '1';
  if (requireCaptcha && !(await checkCaptcha(req, env, captcha))) {
    await recordLoginFailure(env, username, ip);
    return json({ code: 0, msg: '验证码错误' });
  }

  const row = await env.DB.prepare(
    'SELECT id, username, password_hash, status FROM admins WHERE username = ?'
  )
    .bind(username)
    .first<{ id: number; username: string; password_hash: string; status: number }>();

  if (!row || row.status !== 1 || !(await verifyPassword(password, row.password_hash))) {
    await recordLoginFailure(env, username, ip);
    return json({ code: 0, msg: '账号或密码错误' });
  }

  await clearLoginFailures(env, username, ip);
  await env.DB.prepare('UPDATE admins SET login_time = ? WHERE id = ?').bind(now(), row.id).run();
  await addLog(env, row.id, `登录后台`, ip);

  const res = json({ code: 1, msg: '登录成功' });
  res.headers.append('set-cookie', await issueCookie(env, req, username, row.id));
  res.headers.append('set-cookie', captchaCookie(req, env, '', 0));
  return res;
}
