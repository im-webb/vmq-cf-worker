-- 安全加固：登录失败窗口（已有 D1 只执行一次）
-- 执行：
--   pnpm exec wrangler d1 execute vmq --remote -c .\wrangler.local.jsonc --file=.\migrations\20261109_security_hardening.sql

CREATE TABLE IF NOT EXISTS auth_attempt (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket     TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_attempt_bucket ON auth_attempt(bucket, created_at);
