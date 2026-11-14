import type { Env } from './db';
import { now } from './util';

/** 登录失败窗口与锁定策略。按账号/用户名和 IP 双维度限制。 */
const WINDOW_SECONDS = 15 * 60;
const ACCOUNT_LIMIT = 5;
const IP_LIMIT = 20;
const LOCK_SECONDS = 15 * 60;
const CLEANUP_SECONDS = 24 * 60 * 60;

function usernameBucket(username: string): string {
  return `user:${username.trim().toLowerCase().slice(0, 64) || '-'}`;
}

function ipBucket(ip: string): string {
  return `ip:${ip.trim().slice(0, 128) || 'unknown'}`;
}

export interface LoginThrottleState {
  locked: boolean;
  retryAfter: number;
}

async function bucketLocked(
  env: Env,
  bucket: string,
  limit: number,
  ts: number
): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS c, MAX(created_at) AS last_at FROM auth_attempt WHERE bucket = ? AND created_at >= ?'
  )
    .bind(bucket, ts - WINDOW_SECONDS)
    .first<{ c: number; last_at: number | null }>();
  if (Number(row?.c ?? 0) < limit) return 0;
  const unlockAt = Number(row?.last_at ?? 0) + LOCK_SECONDS;
  return unlockAt > ts ? unlockAt - ts : 0;
}

/** 登录前检查；数据库暂时异常时不让限流表本身把后台锁死。 */
export async function checkLoginThrottle(
  env: Env,
  username: string,
  ip: string
): Promise<LoginThrottleState> {
  const ts = now();
  try {
    const [account, address] = await Promise.all([
      bucketLocked(env, usernameBucket(username), ACCOUNT_LIMIT, ts),
      bucketLocked(env, ipBucket(ip), IP_LIMIT, ts),
    ]);
    const retryAfter = Math.max(account, address, 0);
    return { locked: retryAfter > 0, retryAfter };
  } catch (error) {
    console.error('auth throttle check failed', error);
    return { locked: false, retryAfter: 0 };
  }
}

/** 记录一次失败：验证码错误、账号不存在、密码错误都计数。 */
export async function recordLoginFailure(env: Env, username: string, ip: string): Promise<void> {
  const ts = now();
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO auth_attempt (bucket, created_at) VALUES (?, ?)').bind(
        usernameBucket(username),
        ts
      ),
      env.DB.prepare('INSERT INTO auth_attempt (bucket, created_at) VALUES (?, ?)').bind(
        ipBucket(ip),
        ts
      ),
    ]);
  } catch (error) {
    console.error('auth throttle record failed', error);
  }
}

/** 登录成功后清除该账号和 IP 的失败窗口。 */
export async function clearLoginFailures(env: Env, username: string, ip: string): Promise<void> {
  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM auth_attempt WHERE bucket = ?').bind(usernameBucket(username)),
      env.DB.prepare('DELETE FROM auth_attempt WHERE bucket = ?').bind(ipBucket(ip)),
    ]);
  } catch (error) {
    console.error('auth throttle clear failed', error);
  }
}

/** cron 清理过期失败记录。 */
export async function pruneAuthAttempts(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM auth_attempt WHERE created_at < ?')
    .bind(now() - CLEANUP_SECONDS)
    .run();
}

export const AUTH_THROTTLE = {
  windowSeconds: WINDOW_SECONDS,
  accountLimit: ACCOUNT_LIMIT,
  ipLimit: IP_LIMIT,
  lockSeconds: LOCK_SECONDS,
} as const;
