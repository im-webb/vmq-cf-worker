-- vmq Worker 版数据库结构（D1 / SQLite）
-- 列名沿用原版的字段语义，后台模板才能直接复用。

CREATE TABLE IF NOT EXISTS config (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL DEFAULT ''
);

-- 通道（每个收款码一条）
CREATE TABLE IF NOT EXISTS passages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         INTEGER NOT NULL DEFAULT 1,   -- 1 微信 / 2 支付宝 / 3 QQ / 4 数字人民币
  code         INTEGER NOT NULL DEFAULT 0,   -- 0 无金额收款码 / 1 有金额收款码 / 2 免输入
  zf_pid       TEXT    NOT NULL DEFAULT '',  -- 支付用户ID（支付宝 UID / 数币钱包编码）
  ewm_type     INTEGER NOT NULL DEFAULT 0,   -- 0 二维码内容（需现场生成图）/ 1 已上传的图片
  ewm          TEXT    NOT NULL DEFAULT '',
  balance      TEXT    NOT NULL DEFAULT '0.00',
  old_balance  TEXT    NOT NULL DEFAULT '0.00',
  succcount    INTEGER NOT NULL DEFAULT 0,
  succprice    TEXT    NOT NULL DEFAULT '0.00',
  is_status    INTEGER NOT NULL DEFAULT 0,   -- 监控端是否在线
  status       INTEGER NOT NULL DEFAULT 1,   -- 0 关闭 / 1 开启
  hang_free    INTEGER NOT NULL DEFAULT 0,   -- 免挂（Worker 版未实现，恒 0）
  cookie       TEXT    NOT NULL DEFAULT '',
  money_change INTEGER NOT NULL DEFAULT 0,   -- 1 = 付款需备注
  pay_qf       INTEGER NOT NULL DEFAULT 0,   -- 0 递增 / 1 递减（通道级覆盖）
  transfer     INTEGER NOT NULL DEFAULT 0,   -- 个人转账模式（Worker 版未实现，恒 0）
  run_time     INTEGER NOT NULL DEFAULT 0,
  ck_time      INTEGER NOT NULL DEFAULT 0,
  remarks      TEXT    NOT NULL DEFAULT '',
  create_time  INTEGER NOT NULL DEFAULT 0,
  update_time  INTEGER NOT NULL DEFAULT 0
);

-- 订单
CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        TEXT    NOT NULL UNIQUE,   -- 平台订单号（18 位）
  out_trade_no    TEXT    NOT NULL,          -- 商户订单号
  name            TEXT    NOT NULL DEFAULT '',
  type            INTEGER NOT NULL,
  pid             INTEGER NOT NULL DEFAULT 1,   -- 商户 ID
  passage_id      INTEGER NOT NULL DEFAULT 0,
  money           TEXT    NOT NULL,          -- 商户下单金额
  truemoney       TEXT    NOT NULL,          -- 实际应付金额（金额池分配）
  pay_url         TEXT    NOT NULL DEFAULT '',
  pay_url_type    INTEGER NOT NULL DEFAULT 0,  -- 0 二维码文本 / 1 直接展示图片
  is_auto         INTEGER NOT NULL DEFAULT 1,  -- 1 自动核对；0 是已下线的固定金额码时代留下的历史值
  notify_url      TEXT    NOT NULL DEFAULT '',
  return_url      TEXT    NOT NULL DEFAULT '',
  sitename        TEXT    NOT NULL DEFAULT '',
  param           TEXT    NOT NULL DEFAULT '',
  status          INTEGER NOT NULL DEFAULT 0, -- 0 待支付 1 已支付 2 回调失败 3 已过期
  create_time     INTEGER NOT NULL,
  pay_time        INTEGER NOT NULL DEFAULT 0,
  close_time      INTEGER NOT NULL DEFAULT 0,
  notify_attempts INTEGER NOT NULL DEFAULT 0,
  ip              TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_orders_match ON orders(truemoney, status, type, pid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_out_trade_no ON orders(out_trade_no);
CREATE INDEX IF NOT EXISTS idx_orders_status_time ON orders(status, create_time);
-- 通道列表的「收款笔数/收款金额」按 passage_id + status 聚合，走这条索引
CREATE INDEX IF NOT EXISTS idx_orders_passage ON orders(passage_id, status);

-- 固定金额收款码：按金额精确命中时优先使用，未命中回退通道默认码
CREATE TABLE IF NOT EXISTS qrcodes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  passage_id   INTEGER NOT NULL,
  price_fen    INTEGER NOT NULL,
  pay_url      TEXT    NOT NULL,
  ewm_type     INTEGER NOT NULL DEFAULT 0,   -- 0 二维码文本 / 1 直接展示图片
  status       INTEGER NOT NULL DEFAULT 1,
  remarks      TEXT    NOT NULL DEFAULT '',
  create_time  INTEGER NOT NULL DEFAULT 0,
  update_time  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_qrcodes_match ON qrcodes(price_fen, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qrcodes_passage_price ON qrcodes(passage_id, price_fen);

-- 金额池：price 形如 "1800-1"（分-类型），主键即互斥锁
CREATE TABLE IF NOT EXISTS tmp_price (
  price      TEXT PRIMARY KEY,
  oid        TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 商户回调重试队列
CREATE TABLE IF NOT EXISTS notify_task (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   TEXT    NOT NULL,
  url        TEXT    NOT NULL,
  payload    TEXT    NOT NULL,   -- 已拼好的 query string（不含 url）
  attempts   INTEGER NOT NULL DEFAULT 0,
  next_at    INTEGER NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  last_error TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_notify_due ON notify_task(done, next_at);

-- 未匹配到订单的推送（原版会写进 orders 污染数据，这里单独存）
CREATE TABLE IF NOT EXISTS unmatched_push (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT,
  price      TEXT,
  pid        TEXT,
  t          TEXT,
  sign       TEXT,
  src_ip     TEXT,
  created_at INTEGER NOT NULL
);

-- 监控端状态（单行）
CREATE TABLE IF NOT EXISTS monitor_state (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  last_heart INTEGER NOT NULL DEFAULT 0,
  last_pay   INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO monitor_state (id, last_heart, last_pay) VALUES (1, 0, 0);

-- 后台管理员
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,           -- pbkdf2$迭代次数$salt$hash
  status        INTEGER NOT NULL DEFAULT 1, -- 1 启用 / 0 禁用
  role          INTEGER NOT NULL DEFAULT 1,
  head_img      TEXT    NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL DEFAULT 0,
  update_time   INTEGER NOT NULL DEFAULT 0,
  login_time    INTEGER NOT NULL DEFAULT 0
);

-- 操作日志
CREATE TABLE IF NOT EXISTS logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uid         INTEGER NOT NULL DEFAULT 0,   -- 0 系统 / -1 游客
  content     TEXT    NOT NULL DEFAULT '',
  ip          TEXT    NOT NULL DEFAULT '',
  create_time INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(create_time);

-- 后台上传的图片（收款码等）。存 D1 而不引 R2，省一个绑定
CREATE TABLE IF NOT EXISTS uploads (
  hash       TEXT PRIMARY KEY,
  mime       TEXT    NOT NULL,
  size       INTEGER NOT NULL,
  data       TEXT    NOT NULL,   -- base64
  created_at INTEGER NOT NULL
);

-- 默认配置
INSERT OR IGNORE INTO config (k, v) VALUES
  ('key', ''),            -- 通讯密钥（监控端用）
  ('merchant_key', ''),   -- 商户密钥（下单/回调签名用）
  ('payQf', '1'),         -- 1 金额递增 / 2 递减
  ('close', '5'),         -- 订单超时（分钟）
  ('order_timeout', '5'), -- 同上（后台模板用的键名）
  ('title', 'V免签'),
  ('edition', 'v1.0.0'),
  ('keywords', ''),
  ('description', ''),
  ('footer', ''),
  ('url', ''),
  ('notify_success_body', '@json:code=1'),  -- 回调成功判定：默认按 JSON 的 code=1（商户返回 {"code":1}）
  ('require_online', '1'),
  ('replay_window_seconds', '300'),
  ('admin_captcha', '1'),
  ('notify_max_attempts', '8'),
  ('DEBUG_PAGE', '0'),
  ('jkstate', '0');
