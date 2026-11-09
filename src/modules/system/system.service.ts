/**
 * 系统域业务：管理员与站点配置。
 */
import type { Env } from '../../lib/db';
import { hashPassword } from '../../lib/auth';
import { fmtTime } from '../../lib/page';
import { DEFAULT_HEAD_IMG } from '../../lib/const';
import type { ApiResult } from '../../http/respond';
import { fail, ok, table } from '../../http/respond';
import { filterVal, idsOf, intVal, pageArgs, strVal } from '../../http/request';
import { ROLES } from '../shared/labels';
import { withTimes } from '../shared/format';
import * as repo from './system.repository';

/* ============================ 管理员 ============================ */

export async function listAdmins(env: Env, p: Record<string, string>): Promise<ApiResult> {
  const { limit, offset } = pageArgs(p);
  const role = filterVal(p, 'role');

  const { rows, count } = await repo.listAdmins(env.DB, {
    role: role === '' ? undefined : Number(role),
    limit,
    offset,
  });

  return table(
    rows.map((r) => {
      const roleId = Number(r.role ?? 1);
      return {
        ...withTimes(r as unknown as Record<string, unknown>, ['created_at', 'login_time']),
        // 模板列名是 create_time，值是格式化后的 created_at
        create_time: fmtTime(Number(r.created_at ?? 0)),
        role: ROLES.find((x) => x.id === roleId)?.name ?? '管理员',
      };
    }),
    count
  );
}

/** 新增（id=0）或修改管理员 */
export async function saveAdmin(
  env: Env,
  p: Record<string, string>,
  id: number
): Promise<ApiResult> {
  const username = strVal(p, 'username');
  const password = p['password'] ?? '';
  const repassword = p['repassword'] ?? '';
  const role = Number(p['role'] ?? 2) || 2;
  const status = Number(p['status'] ?? 1) || 0;
  // 头像留空时用默认图（与线上一致：/static/admin/images/head.jpg）
  const headImg = strVal(p, 'head_img') || DEFAULT_HEAD_IMG;

  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return fail('用户名需 3-20 位字母数字下划线');
  if (password || repassword) {
    if (password.length < 8) return fail('密码至少 8 位');
    if (password !== repassword) return fail('两次密码不一致');
  }
  if (await repo.usernameTaken(env.DB, username, id)) return fail('用户名已存在');
  if (role !== 1 && role !== 2) return fail('管理员角色不正确');
  if (status !== 0 && status !== 1) return fail('管理员状态不正确');

  if (id) {
    const old = await repo.findAdmin(env.DB, id);
    if (!old) return fail('管理员不存在');
    const wasActiveSuper = Number(old.role ?? 0) === 1 && Number(old.status ?? 0) === 1;
    const remainsActiveSuper = role === 1 && status === 1;
    if (wasActiveSuper && !remainsActiveSuper) {
      if ((await repo.countActiveSuperAdmins(env.DB, [id])) === 0) {
        return fail('至少保留一个启用状态的超级管理员');
      }
    }
  }

  const data = { username, role, status, head_img: headImg };

  if (id) {
    await repo.updateAdmin(env.DB, id, data, password ? await hashPassword(password) : undefined);
    return ok('保存成功');
  }

  if (!password) return fail('请设置密码');
  await repo.insertAdmin(env.DB, data, await hashPassword(password));
  return ok('添加成功');
}

export async function setAdminStatus(env: Env, p: Record<string, string>): Promise<ApiResult> {
  const id = intVal(p, 'id');
  const status = Number(p['status'] ?? 0) || 0;
  if (!id) return fail('缺少 id');
  if (status !== 0 && status !== 1) return fail('管理员状态不正确');
  const old = await repo.findAdmin(env.DB, id);
  if (!old) return fail('管理员不存在');
  if (status === 0 && Number(old.role ?? 0) === 1 && Number(old.status ?? 0) === 1) {
    if ((await repo.countActiveSuperAdmins(env.DB, [id])) === 0) {
      return fail('至少保留一个启用状态的超级管理员');
    }
  }
  await repo.setAdminStatus(env.DB, id, status);
  return ok('设置成功');
}

/** 删除管理员：不能删自己 */
export async function removeAdmins(
  env: Env,
  p: Record<string, string>,
  currentUid: number
): Promise<ApiResult> {
  const list = idsOf(p);
  if (list.includes(currentUid)) return fail('不能删除当前登录账号');
  if (!list.length) return fail('缺少 id');
  if ((await repo.countActiveSuperAdmins(env.DB, list)) === 0) {
    return fail('至少保留一个启用状态的超级管理员');
  }
  await repo.removeAdmins(env.DB, list);
  return ok(`已删除 ${list.length} 条`);
}

/**
 * 修改自己的资料。
 *
 * 只更新头像。手机 / 邮箱字段已整块下线（建表脚本里也没有这两列），
 * 资料接口只负责 head_img。
 */
export async function saveProfile(
  env: Env,
  p: Record<string, string>,
  currentUid: number
): Promise<ApiResult> {
  await repo.updateProfile(env.DB, currentUid, {
    head_img: p['head_img'] ?? '',
  });
  return ok('保存成功');
}

/** 修改自己的密码 */
export async function changePassword(
  env: Env,
  p: Record<string, string>,
  currentUid: number
): Promise<ApiResult> {
  const pw = p['password'] ?? '';
  const again = p['password_again'] ?? '';
  if (pw.length < 8) return fail('密码至少 8 位');
  if (pw !== again) return fail('两次密码不一致');
  await repo.updatePassword(env.DB, currentUid, await hashPassword(pw));
  return ok('密码已修改，请重新登录');
}

/* ============================ 站点配置 ============================ */

/** 配置项白名单：只写这些键，防止表单被塞任意配置 */
export const CONFIG_KEYS = [
  'url',
  // 静态资源（CSS/JS/图片）基址：留空 = 相对路径 /static/…，由 Worker 的 assets 分发；
  // 填 CDN 地址则所有页面引用 CDN。未保存过这一项时回退环境变量 RESOURCE_URL。
  'resource_url',
  'title',
  'keywords',
  'description',
  'footer',
  'cron_key',
  'home_url',
  'order_timeout',
  'timeout_url',
  // 「支付配置」页的表单实际 POST 到 system/config/edit，所以这三个键必须放行，
  // 否则保存时会报「没有需要保存的内容」
  'epayurl_ali',
  'epayid_ali',
];

/** 密钥类：留空表示不修改，避免误清空导致 App 全部验签失败 */
const SECRET_KEYS = ['key', 'app_key', 'merchant_key', 'epaykey_ali'] as const;

export async function saveConfig(env: Env, p: Record<string, string>): Promise<ApiResult> {
  // 静态资源地址校验：非空必须是 http(s):// 开头
  // —— 填错（比如漏了协议头）会让整站 CSS/JS 全部 404，后台直接裸奔，提前拦住
  const resUrl = strVal(p, 'resource_url');
  if (resUrl && !/^https?:\/\//i.test(resUrl)) {
    return fail('静态资源地址必须以 http:// 或 https:// 开头，留空则使用相对路径');
  }

  const entries: Array<[string, string]> = [];
  for (const k of CONFIG_KEYS) {
    if (p[k] === undefined) continue;
    entries.push([k, String(p[k])]);
  }
  for (const k of SECRET_KEYS) {
    const v = strVal(p, k);
    if (v) entries.push([k, v]);
  }
  if (!entries.length) return fail('没有需要保存的内容');

  await repo.saveConfigEntries(env.DB, entries);
  return ok('保存成功');
}

/* ============================ 支付配置 ============================ */

const EPAY_KEYS = ['epayid_ali', 'epaykey_ali', 'epayurl_ali'];

export async function saveEpayConfig(env: Env, p: Record<string, string>): Promise<ApiResult> {
  const entries: Array<[string, string]> = [];
  for (const k of EPAY_KEYS) {
    if (p[k] === undefined) continue;
    entries.push([k, String(p[k])]);
  }
  await repo.saveConfigEntries(env.DB, entries);
  return ok('保存成功');
}
