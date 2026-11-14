-- 固定金额码功能升级（现有 D1 只执行一次）
-- 执行：
--   pnpm exec wrangler d1 execute vmq --remote -c .\wrangler.local.jsonc --file=.\migrations\20261108_fixed_amount_qrcodes.sql
-- 本脚本会修改 orders 表，不要在已经升级过的库上重复执行。

ALTER TABLE orders ADD COLUMN pay_url_type INTEGER NOT NULL DEFAULT 0;

UPDATE orders
SET pay_url_type = COALESCE(
  (SELECT p.ewm_type FROM passages p WHERE p.id = orders.passage_id),
  0
);

CREATE TABLE IF NOT EXISTS qrcodes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  passage_id   INTEGER NOT NULL,
  price_fen    INTEGER NOT NULL,
  pay_url      TEXT    NOT NULL,
  ewm_type     INTEGER NOT NULL DEFAULT 0,
  status       INTEGER NOT NULL DEFAULT 1,
  remarks      TEXT    NOT NULL DEFAULT '',
  create_time  INTEGER NOT NULL DEFAULT 0,
  update_time  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_qrcodes_match ON qrcodes(price_fen, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qrcodes_passage_price ON qrcodes(passage_id, price_fen);