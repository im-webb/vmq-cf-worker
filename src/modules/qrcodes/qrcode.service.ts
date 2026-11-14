/**
 * 固定金额码业务：列表、保存、启停、删除。
 */
import type { Env } from '../../lib/db';
import { fenToYuan, yuanToFen } from '../../lib/amount';
import type { ApiResult } from '../../http/respond';
import { fail, ok, okData, table } from '../../http/respond';
import { filterVal, idsOf, intVal, pageArgs, strVal } from '../../http/request';
import { withTimes } from '../shared/format';
import type { QrcodeInput } from './qrcode.repository';
import * as repo from './qrcode.repository';

export async function listQrcodes(env: Env, p: Record<string, string>): Promise<ApiResult> {
  const { limit, offset } = pageArgs(p);
  const passageId = filterVal(p, 'passage_id') || filterVal(p, 'pid');
  const type = filterVal(p, 'type');
  const status = filterVal(p, 'status');
  const { rows, count } = await repo.list(env.DB, {
    passageId: passageId === '' ? undefined : Number(passageId),
    type: type === '' ? undefined : Number(type),
    status: status === '' ? undefined : Number(status),
    limit,
    offset,
  });

  return table(
    rows.map((r) => ({
      ...withTimes(r as unknown as Record<string, unknown>, ['create_time', 'update_time']),
      price: fenToYuan(r.price_fen),
    })),
    count
  );
}

/** 新增（id=0）或修改固定金额码。 */
export async function saveQrcode(
  env: Env,
  p: Record<string, string>,
  id: number
): Promise<ApiResult> {
  const passageId = intVal(p, 'passage_id') || intVal(p, 'pid');
  const priceRaw = strVal(p, 'price') || strVal(p, 'money');
  const payUrl = strVal(p, 'pay_url') || strVal(p, 'ewm');
  const status = p['status'] === undefined ? 1 : intVal(p, 'status', 1);
  const ewmType = intVal(p, 'ewm_type', 0) === 1 ? 1 : 0;
  const remarks = strVal(p, 'remarks');

  if (!passageId) return fail('请选择所属通道');
  const passage = await repo.findPassage(env.DB, passageId);
  if (!passage) return fail('所属通道不存在');

  const priceFen = yuanToFen(priceRaw);
  if (priceFen === null || priceFen <= 0) return fail('金额格式不正确');
  if (!payUrl) return fail('请填写固定金额收款码');

  const duplicate = await repo.findByPassagePrice(env.DB, passageId, priceFen, id);
  if (duplicate) return fail('该通道已存在相同金额的固定码');

  const data = {
    passage_id: passageId,
    price_fen: priceFen,
    pay_url: payUrl,
    ewm_type: ewmType,
    status: status === 0 ? 0 : 1,
    remarks,
  };

  try {
    if (id) {
      const existing = await repo.findById(env.DB, id);
      if (!existing) return fail('固定金额码不存在');
      await repo.update(env.DB, id, data);
      return ok('保存成功');
    }
    await repo.insert(env.DB, data);
    return ok('添加成功');
  } catch (error) {
    if (String(error).toUpperCase().includes('UNIQUE')) {
      return fail('该通道已存在相同金额的固定码');
    }
    throw error;
  }
}

export interface QrcodeBatchItem {
  price: string;
  pay_url: string;
  ewm_type?: number | string;
  status?: number | string;
  remarks?: string;
}

export interface QrcodeBatchPayload {
  passage_id?: number | string;
  ewm_type?: number | string;
  status?: number | string;
  remarks?: string;
  items?: QrcodeBatchItem[];
}

/** 批量新增：先整体校验，再用 D1 batch 一次性写入。 */
export async function saveQrcodeBatch(
  env: Env,
  payload: QrcodeBatchPayload
): Promise<ApiResult> {
  const passageId = Number(payload?.passage_id);
  if (!Number.isInteger(passageId) || passageId <= 0) return fail('请选择所属通道');
  const passage = await repo.findPassage(env.DB, passageId);
  if (!passage) return fail('所属通道不存在');

  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!items.length) return fail('没有可导入的固定码');
  if (items.length > 200) return fail('一次最多导入 200 条');

  const defaultStatus = Number(payload.status) === 0 ? 0 : 1;
  const defaultEwmType = Number(payload.ewm_type) === 1 ? 1 : 0;
  const defaultRemarks = String(payload.remarks ?? '').trim();
  const existing = await repo.existingPrices(env.DB, passageId);
  const seen = new Set<number>();
  const rows: QrcodeInput[] = [];
  const conflicts: string[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') return fail('导入数据格式不正确');

    const priceText = String(item.price ?? '').trim();
    const priceFen = yuanToFen(priceText);
    if (priceFen === null || priceFen <= 0) {
      return fail(`金额格式不正确：${priceText || '(空)'}`);
    }
    if (seen.has(priceFen)) return fail(`批次内金额重复：${fenToYuan(priceFen)}`);
    seen.add(priceFen);
    if (existing.has(priceFen)) {
      conflicts.push(fenToYuan(priceFen));
      continue;
    }

    const payUrl = String(item.pay_url ?? '').trim();
    if (!payUrl) return fail(`金额 ${fenToYuan(priceFen)} 缺少收款码`);

    rows.push({
      passage_id: passageId,
      price_fen: priceFen,
      pay_url: payUrl,
      ewm_type: item.ewm_type === undefined ? defaultEwmType : Number(item.ewm_type) === 1 ? 1 : 0,
      status: item.status === undefined ? defaultStatus : Number(item.status) === 0 ? 0 : 1,
      remarks: String(item.remarks ?? defaultRemarks).trim(),
    });
  }

  if (conflicts.length) {
    return fail(`有 ${conflicts.length} 个金额已存在，未导入任何数据`);
  }

  try {
    await repo.insertMany(env.DB, rows);

    return okData({ inserted: rows.length }, `已添加 ${rows.length} 条`);
  } catch (error) {
    if (String(error).toUpperCase().includes('UNIQUE')) {
      return fail('导入时发现重复金额，未写入任何数据');
    }
    throw error;
  }
}

export async function setQrcodeStatus(
  env: Env,
  p: Record<string, string>
): Promise<ApiResult> {
  const id = intVal(p, 'id');
  if (!id) return fail('缺少 id');
  await repo.setStatus(env.DB, id, intVal(p, 'status'));
  return ok('设置成功');
}

export async function removeQrcodes(env: Env, p: Record<string, string>): Promise<ApiResult> {
  const list = idsOf(p);
  if (!list.length) return fail('缺少 id');
  await repo.removeMany(env.DB, list);
  return ok(`已删除 ${list.length} 条`);
}

export async function passageOptions(env: Env): Promise<ApiResult> {
  return okData(await repo.passageOptions(env.DB));
}