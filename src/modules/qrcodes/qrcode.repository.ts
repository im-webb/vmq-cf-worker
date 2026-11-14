/**
 * 固定金额收款码数据访问。
 *
 * qrcodes 是“通道 + 实际应付金额 → 收款码”的精确映射；
 * 下单时优先命中固定码，未命中回退通道默认码。
 */
import type { QrcodeRow } from '../../lib/db';
import { now } from '../../lib/util';
import { marks } from '../shared/sql';

const LIST_COLUMNS = `
  q.id, q.passage_id, q.price_fen, q.pay_url, q.ewm_type,
  q.status, q.remarks, q.create_time, q.update_time,
  p.type AS passage_type, p.remarks AS passage_remarks
`;

export interface QrcodeListFilter {
  passageId?: number;
  type?: number;
  status?: number;
  limit: number;
  offset: number;
}

export type QrcodeListRow = QrcodeRow & {
  passage_type: number;
  passage_remarks: string;
};

export interface QrcodeMatchRow {
  id: number;
  passage_id: number;
  pay_url: string;
  ewm_type: number;
}

export interface QrcodeInput {
  passage_id: number;
  price_fen: number;
  pay_url: string;
  ewm_type: number;
  status: number;
  remarks: string;
}

export interface PassageOptionRow {
  id: number;
  type: number;
  status: number;
  remarks: string;
}

export async function list(
  db: D1Database,
  f: QrcodeListFilter
): Promise<{ rows: QrcodeListRow[]; count: number }> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (f.passageId !== undefined) {
    where.push('q.passage_id = ?');
    binds.push(f.passageId);
  }
  if (f.type !== undefined) {
    where.push('p.type = ?');
    binds.push(f.type);
  }
  if (f.status !== undefined) {
    where.push('q.status = ?');
    binds.push(f.status);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const cnt = await db
    .prepare(`SELECT COUNT(*) AS c FROM qrcodes q JOIN passages p ON p.id = q.passage_id ${w}`)
    .bind(...binds)
    .first<{ c: number }>();

  const rows = await db
    .prepare(
      `SELECT ${LIST_COLUMNS}
       FROM qrcodes q
       JOIN passages p ON p.id = q.passage_id
       ${w}
       ORDER BY q.id DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...binds, f.limit, f.offset)
    .all<QrcodeListRow>();

  return { rows: rows.results, count: cnt?.c ?? 0 };
}

export async function findById(db: D1Database, id: number): Promise<QrcodeRow | null> {
  const row = await db.prepare('SELECT * FROM qrcodes WHERE id = ?').bind(id).first<QrcodeRow>();
  return row ?? null;
}

export async function findByPassagePrice(
  db: D1Database,
  passageId: number,
  priceFen: number,
  excludeId = 0
): Promise<{ id: number } | null> {
  return db
    .prepare('SELECT id FROM qrcodes WHERE passage_id = ? AND price_fen = ? AND id <> ? LIMIT 1')
    .bind(passageId, priceFen, excludeId)
    .first<{ id: number }>();
}

/**
 * 下单匹配：金额和支付类型都精确命中，且固定码与所属通道均启用。
 * 返回的 passage_id 是固定码真正所属的通道，不能沿用默认通道。
 */
export async function findMatch(
  db: D1Database,
  priceFen: number,
  type: number
): Promise<QrcodeMatchRow | null> {
  return db
    .prepare(
      `SELECT q.id, q.passage_id, q.pay_url, q.ewm_type
       FROM qrcodes q
       JOIN passages p ON p.id = q.passage_id
       WHERE q.price_fen = ?
         AND q.status = 1
         AND p.status = 1
         AND p.type = ?
       ORDER BY q.id
       LIMIT 1`
    )
    .bind(priceFen, type)
    .first<QrcodeMatchRow>();
}

export async function findPassage(
  db: D1Database,
  id: number
): Promise<{ id: number; type: number; status: number; remarks: string } | null> {
  return db
    .prepare('SELECT id, type, status, remarks FROM passages WHERE id = ?')
    .bind(id)
    .first<{ id: number; type: number; status: number; remarks: string }>();
}

export async function passageOptions(db: D1Database): Promise<PassageOptionRow[]> {
  const rows = await db
    .prepare('SELECT id, type, status, remarks FROM passages ORDER BY id')
    .all<PassageOptionRow>();
  return rows.results;
}

export async function existingPrices(db: D1Database, passageId: number): Promise<Set<number>> {
  const rows = await db
    .prepare('SELECT price_fen FROM qrcodes WHERE passage_id = ?')
    .bind(passageId)
    .all<{ price_fen: number }>();
  return new Set(rows.results.map((row) => Number(row.price_fen)));
}

const INSERT_SQL = `INSERT INTO qrcodes
  (passage_id, price_fen, pay_url, ewm_type, status, remarks, create_time, update_time)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

function bindInsert(db: D1Database, data: QrcodeInput, t: number) {
  return db
    .prepare(INSERT_SQL)
    .bind(
      data.passage_id,
      data.price_fen,
      data.pay_url,
      data.ewm_type,
      data.status,
      data.remarks,
      t,
      t
    );
}

export async function insert(db: D1Database, data: QrcodeInput): Promise<number> {
  const t = now();
  const r = await bindInsert(db, data, t).run();
  return Number(r.meta.last_row_id ?? 0);
}

/** 多行一次提交，D1 batch 在同一事务中执行。 */
export async function insertMany(db: D1Database, rows: QrcodeInput[]): Promise<number> {
  if (!rows.length) return 0;
  const t = now();
  const statements = rows.map((row) => bindInsert(db, row, t));
  await db.batch(statements);
  return rows.length;
}

export async function update(db: D1Database, id: number, data: QrcodeInput): Promise<void> {
  await db
    .prepare(
      `UPDATE qrcodes
       SET passage_id = ?, price_fen = ?, pay_url = ?, ewm_type = ?,
           status = ?, remarks = ?, update_time = ?
       WHERE id = ?`
    )
    .bind(
      data.passage_id,
      data.price_fen,
      data.pay_url,
      data.ewm_type,
      data.status,
      data.remarks,
      now(),
      id
    )
    .run();
}

export async function removeMany(db: D1Database, idList: number[]): Promise<void> {
  if (!idList.length) return;
  await db
    .prepare(`DELETE FROM qrcodes WHERE id IN (${marks(idList.length)})`)
    .bind(...idList)
    .run();
}

export async function setStatus(db: D1Database, id: number, status: number): Promise<void> {
  await db
    .prepare('UPDATE qrcodes SET status = ?, update_time = ? WHERE id = ?')
    .bind(status, now(), id)
    .run();
}