/**
 * 系统域数据访问：管理员 + 站点配置。
 *
 * 配置表是 k/v 结构（config），全站读它（站点名、密钥、开关），
 * 所以读写都收在这里，避免各处手写 UPSERT。
 */
import { now } from '../../lib/util';
import { marks } from '../shared/sql';

/* ============================ 管理员 ============================ */

export interface AdminRow {
  id: number;
  username: string;
  role: number;
  head_img: string;
  status: number;
  created_at: number;
  login_time: number;
}

const ADMIN_LIST_COLUMNS = 'id, username, role, head_img, status, created_at, login_time';

export async function listAdmins(
  db: D1Database,
  filter: { role?: number; limit: number; offset: number }
): Promise<{ rows: AdminRow[]; count: number }> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filter.role !== undefined) {
    where.push('role = ?');
    binds.push(filter.role);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const cnt = await db
    .prepare(`SELECT COUNT(*) AS c FROM admins ${w}`)
    .bind(...binds)
    .first<{ c: number }>();

  const rows = await db
    .prepare(`SELECT ${ADMIN_LIST_COLUMNS} FROM admins ${w} ORDER BY id ASC LIMIT ? OFFSET ?`)
    .bind(...binds, filter.limit, filter.offset)
    .all<AdminRow>();

  return { rows: rows.results, count: cnt?.c ?? 0 };
}

/** 下拉用：id + username，按 id 升序 */
export async function listAdminNames(
  db: D1Database
): Promise<Array<{ id: number; username: string }>> {
  const r = await db
    .prepare('SELECT id, username FROM admins ORDER BY id ASC')
    .all<{ id: number; username: string }>();
  return r.results;
}

export async function findAdmin(
  db: D1Database,
  id: number
): Promise<Record<string, unknown> | null> {
  const row = await db
    .prepare('SELECT id, username, role, head_img, status FROM admins WHERE id = ?')
    .bind(id)
    .first();
  return (row as Record<string, unknown>) ?? null;
}

/** 登录校验用：带 password_hash */
export async function findAdminForLogin(
  db: D1Database,
  username: string
): Promise<{ id: number; username: string; password_hash: string; status: number } | null> {
  const row = await db
    .prepare('SELECT id, username, password_hash, status FROM admins WHERE username = ?')
    .bind(username)
    .first<{ id: number; username: string; password_hash: string; status: number }>();
  return row ?? null;
}

/** 用户名是否被他人占用 */
export async function usernameTaken(
  db: D1Database,
  username: string,
  exceptId: number
): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM admins WHERE username = ? AND id <> ?')
    .bind(username, exceptId)
    .first<{ id: number }>();
  return !!row;
}

/** 是否还没有任何管理员（决定 /setup 是否会接管） */
export async function countAdmins(db: D1Database): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) AS c FROM admins').first<{ c: number }>();
  return r?.c ?? 0;
}

export interface AdminInput {
  username: string;
  role: number;
  status: number;
  head_img: string;
}

export async function insertAdmin(
  db: D1Database,
  data: AdminInput,
  passwordHash: string
): Promise<number> {
  const t = now();
  const r = await db
    .prepare(
      'INSERT INTO admins (username, password_hash, role, status, head_img, created_at, update_time) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(data.username, passwordHash, data.role, data.status, data.head_img, t, t)
    .run();
  return Number(r.meta.last_row_id ?? 0);
}

/** passwordHash 传 undefined 表示不改密码 */
export async function updateAdmin(
  db: D1Database,
  id: number,
  data: AdminInput,
  passwordHash?: string
): Promise<void> {
  const t = now();
  if (passwordHash) {
    await db
      .prepare(
        'UPDATE admins SET username = ?, role = ?, status = ?, head_img = ?, password_hash = ?, update_time = ? WHERE id = ?'
      )
      .bind(data.username, data.role, data.status, data.head_img, passwordHash, t, id)
      .run();
    return;
  }
  await db
    .prepare(
      'UPDATE admins SET username = ?, role = ?, status = ?, head_img = ?, update_time = ? WHERE id = ?'
    )
    .bind(data.username, data.role, data.status, data.head_img, t, id)
    .run();
}

export async function updateLoginTime(db: D1Database, id: number): Promise<void> {
  await db.prepare('UPDATE admins SET login_time = ? WHERE id = ?').bind(now(), id).run();
}

export async function updateProfile(
  db: D1Database,
  id: number,
  data: { head_img: string }
): Promise<void> {
  await db
    .prepare('UPDATE admins SET head_img = ?, update_time = ? WHERE id = ?')
    .bind(data.head_img, now(), id)
    .run();
}

export async function updatePassword(
  db: D1Database,
  id: number,
  passwordHash: string
): Promise<void> {
  await db
    .prepare('UPDATE admins SET password_hash = ?, update_time = ? WHERE id = ?')
    .bind(passwordHash, now(), id)
    .run();
}

export async function profileOf(
  db: D1Database,
  id: number
): Promise<Record<string, unknown> | null> {
  const row = await db
    .prepare('SELECT id, username, head_img, status FROM admins WHERE id = ?')
    .bind(id)
    .first();
  return (row as Record<string, unknown>) ?? null;
}

export async function usernameOf(db: D1Database, id: number): Promise<string> {
  const row = await db
    .prepare('SELECT username FROM admins WHERE id = ?')
    .bind(id)
    .first<{ username: string }>();
  return row?.username ?? '';
}

export async function headImgOf(db: D1Database, username: string): Promise<string> {
  const row = await db
    .prepare('SELECT head_img FROM admins WHERE username = ?')
    .bind(username)
    .first<{ head_img: string }>();
  return row?.head_img ?? '';
}

export async function removeAdmins(db: D1Database, idList: number[]): Promise<void> {
  if (!idList.length) return;
  await db
    .prepare(`DELETE FROM admins WHERE id IN (${marks(idList.length)})`)
    .bind(...idList)
    .run();
}

export async function setAdminStatus(
  db: D1Database,
  id: number,
  status: number
): Promise<void> {
  await db.prepare('UPDATE admins SET status = ? WHERE id = ?').bind(status, id).run();
}

/** 统计启用中的超级管理员，可排除指定 id。 */
export async function countActiveSuperAdmins(
  db: D1Database,
  excludeIds: number[] = []
): Promise<number> {
  let sql = "SELECT COUNT(*) AS c FROM admins WHERE role = 1 AND status = 1";
  if (excludeIds.length) sql += ` AND id NOT IN (${marks(excludeIds.length)})`;
  const row = await db.prepare(sql).bind(...excludeIds).first<{ c: number }>();
  return Number(row?.c ?? 0);
}

/* ============================ 站点配置 ============================ */

export async function allConfig(db: D1Database): Promise<Record<string, string>> {
  const rows = await db.prepare('SELECT k, v FROM config').all<{ k: string; v: string }>();
  const out: Record<string, string> = {};
  for (const r of rows.results) out[r.k] = r.v;
  return out;
}

/** 批量 UPSERT（一次 batch，避免 N 次往返） */
export async function saveConfigEntries(
  db: D1Database,
  entries: Array<[string, string]>
): Promise<void> {
  if (!entries.length) return;
  const stmt = db.prepare(
    'INSERT INTO config (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'
  );
  await db.batch(entries.map(([k, v]) => stmt.bind(k, v)));
}
