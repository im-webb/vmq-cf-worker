export interface Env {
  DB: D1Database;
  /** 静态资源（含后台 SPA 构建产物）—— 用来在 /{别名} 返回 SPA 外壳 */
  ASSETS: Fetcher;
  /** 静态资源前缀（可选）：配了就作为兜底基址，不配则用相对路径 /static */
  RESOURCE_URL: string;
  /** 后台入口别名（旧版叫 admin_alias_name），默认 admin */
  ADMIN_ALIAS?: string;
  /** 可选：首次初始化的令牌。配了之后 /setup 必须带同样的 ?token=，防止被人抢先初始化 */
  SETUP_TOKEN?: string;
}

/** 后台别名（去掉首尾斜杠），没配就用 admin */
/**
 * 后台入口别名。
 *
 * 两种来源：
 *   1) `ADMIN_ALIAS` 环境变量/secret —— 生产用这条，**零数据库查询**（行为与之前完全一致）
 *   2) 开源版在 /setup 里自定义，写进 config.admin_alias，由 [primeAdminAlias] 预热到进程缓存
 *
 * 缓存 60 秒，避免每个请求都查库；env 配了的话连缓存都不用。
 */
let aliasCache: { v: string; exp: number } | null = null;
const ALIAS_TTL_MS = 60_000;

function normAlias(v: string): string {
  return v.trim().replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9_-]/g, '') || 'admin';
}

export function adminAlias(env: Env): string {
  if (env.ADMIN_ALIAS) return normAlias(env.ADMIN_ALIAS);
  if (aliasCache && aliasCache.exp > Date.now()) return aliasCache.v;
  return 'admin';
}

/** 请求入口调一次：env 没配时才去 config 读（配了直接返回，不产生查询）。force=true 跳过缓存 */
export async function primeAdminAlias(env: Env, force = false): Promise<void> {
  if (env.ADMIN_ALIAS) return;
  if (!force && aliasCache && aliasCache.exp > Date.now()) return;
  try {
    const row = await env.DB.prepare("SELECT v FROM config WHERE k = 'admin_alias'").first<{ v: string }>();
    aliasCache = { v: normAlias(row?.v ?? ''), exp: Date.now() + ALIAS_TTL_MS };
  } catch {
    // config 表还不存在（尚未初始化）：缓存成默认值，避免每个请求都白查一次库。
    // /setup 完成时会调 setAdminAliasCache() 立即覆盖，不用等 TTL。
    aliasCache = { v: 'admin', exp: Date.now() + ALIAS_TTL_MS };
  }
}

/** /setup 写完别名后立即生效，不用等缓存过期 */
export function setAdminAliasCache(v: string): void {
  aliasCache = { v: normAlias(v), exp: Date.now() + ALIAS_TTL_MS };
}

export interface OrderRow {
  id: number;
  order_id: string;
  out_trade_no: string;
  name: string;
  type: number;
  pid: number;
  passage_id: number;
  money: string;
  truemoney: string;
  pay_url: string;
  pay_url_type: number;
  is_auto: number;
  notify_url: string;
  return_url: string;
  sitename: string;
  param: string;
  status: number;
  create_time: number;
  pay_time: number;
  close_time: number;
  notify_attempts: number;
  ip: string;
}

export interface QrcodeRow {
  id: number;
  passage_id: number;
  price_fen: number;
  pay_url: string;
  ewm_type: number;
  status: number;
  remarks: string;
  create_time: number;
  update_time: number;
}

export interface PassageRow {
  id: number;
  type: number;
  code: number;
  zf_pid: string;
  ewm_type: number;
  ewm: string;
  balance: string;
  succcount: number;
  succprice: string;
  is_status: number;
  status: number;
  money_change: number;
  pay_qf: number;
  hang_free: number;
  cookie: string;
  remarks: string;
  create_time: number;
  update_time: number;
}

/** 订单状态：与后台模板一致，不要改 */
export const STATUS = {
  PENDING: 0, // 待支付
  PAID: 1, // 已支付（回调成功）
  NOTIFY_FAILED: 2, // 已支付但回调失败
  EXPIRED: 3, // 已过期
} as const;

export async function getConfig(env: Env, key: string, def = ''): Promise<string> {
  const row = await env.DB.prepare('SELECT v FROM config WHERE k = ?')
    .bind(key)
    .first<{ v: string }>();
  return row?.v ?? def;
}

export async function getConfigInt(env: Env, key: string, def: number): Promise<number> {
  const v = await getConfig(env, key, String(def));
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

/**
 * 应用密钥（平台唯一一把）。
 *
 * 兼容性约定：监控端签名与商户签名**共用同一把**通讯密钥（旧版就是这个设计，
 * 没有单独的配置项），三条链路的签名串分别是：
 *   appPush    : md5(type + price + t + pid + KEY)
 *   appHeart   : md5(t + pid + KEY)
 *   submit.php : md5(签名串 + KEY)   易支付标准签名串
 *
 * 取值顺序（兼容历史配置）：
 *   app_key（语义明确的专用键）→ key（历史别名）→ epaykey_ali（旧部署沿用）
 *
 * 监控端 App 里填的 key 也必须是这个值，否则 appPush/appHeart 全部验签失败。
 */
export async function appSecret(env: Env): Promise<string> {
  for (const k of ['app_key', 'key', 'epaykey_ali']) {
    const v = await getConfig(env, k);
    if (v) return v;
  }
  return '';
}

export async function setConfig(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO config (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'
  )
    .bind(key, value)
    .run();
}
