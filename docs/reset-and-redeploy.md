# 清空并重新部署（Cloudflare Workers + D1）

适用场景：想从零验证安装流程，或需要重置演示环境的数据。

> 本文以 Worker / D1 名称 `vmq` 为例。请替换成自己的名称。
>
> **删除操作不可逆**。D1 没有回收站，务必先完成备份。

---

## 0. 准备

- 已安装 Node.js、pnpm，并完成 `npx wrangler login`。
- 已复制 `wrangler.example.jsonc` 为 `wrangler.local.jsonc`，并填写数据库 ID。
- 明确后续命令使用的配置：

```bash
export WRANGLER_CONFIG=wrangler.local.jsonc
node scripts/cfg.mjs
```

确认输出指向正确配置后再继续。

### 备份

```bash
mkdir -p .data
STAMP=$(date +%Y%m%d-%H%M%S)

# 整库导出（schema + 数据）
npx wrangler d1 export vmq --remote --output ".data/vmq-$STAMP.sql" -y

# 单独导出配置表，便于核对
npx wrangler d1 execute vmq --remote --json \
  --command "SELECT k, v FROM config" > ".data/vmq-config-$STAMP.json"
```

验证：

```bash
ls -lh .data/vmq-$STAMP.sql
head -3 .data/vmq-$STAMP.sql
grep -c "INSERT INTO" .data/vmq-$STAMP.sql
```

`.data/` 已在 `.gitignore` 中。备份可能包含密钥、收款码和业务数据，**不要提交或外发**。

---

## 1. 删除 Worker

先删除 Worker，停止请求和定时任务：

```bash
npx wrangler delete vmq -c "$(node scripts/cfg.mjs)" --dry-run
npx wrangler delete vmq -c "$(node scripts/cfg.mjs)"
```

验证：

```bash
npx wrangler deployments list -c "$(node scripts/cfg.mjs)"
curl -s -o /dev/null -w "%{http_code}\n" "https://vmq.<your-subdomain>.workers.dev/api/health"
```

`deployments list` 应提示 Worker 不存在，请求应返回 404 或 Cloudflare 错误页。

> 如果绑定了自定义域名或 route，需要先解绑，否则可能提示
> `workers must be deleted after routes`。

---

## 2. 删除 D1

```bash
npx wrangler d1 delete vmq -y
npx wrangler d1 list
```

确认列表中目标数据库已经消失，再继续。

---

## 3. 重建数据库

```bash
npx wrangler d1 create vmq
```

将输出中的 `database_id` 写入 `wrangler.local.jsonc` 的
`d1_databases[0].database_id`。

验证配置中的 ID 已更新：

```bash
node -e "const s=require('fs').readFileSync('wrangler.local.jsonc','utf8');console.log(/database_id\"\s*:\s*\"([^\"]+)/.exec(s)[1])"
```

---

## 4. 初始化表结构

```bash
npx wrangler d1 execute vmq --remote -c "$(node scripts/cfg.mjs)" --file=./schema.sql
```

验证表与索引：

```bash
npx wrangler d1 execute vmq --remote -c "$(node scripts/cfg.mjs)" --json \
  --command "SELECT type, COUNT(*) n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf%' GROUP BY type"
```

`schema.sql` 使用 `CREATE TABLE IF NOT EXISTS`，不会自动删除旧表。若沿用已有数据库，
需要自行确认并清理不再使用的历史表。

---

## 5. 部署

```bash
pnpm run deploy
```

`pnpm run deploy` 会依次执行前后台构建和 `wrangler deploy`。
不要使用 `pnpm deploy`，后者是 pnpm 的 registry 发布命令。

验证：

```bash
npx wrangler deployments list -c "$(node scripts/cfg.mjs)"
curl -s "https://vmq.<your-subdomain>.workers.dev/api/health"
```

---

## 6. 设置初始化令牌

`/setup` 在管理员表为空时会开放。部署后应尽快设置一次性令牌：

```bash
openssl rand -hex 16
npx wrangler secret put SETUP_TOKEN -c "$(node scripts/cfg.mjs)"
```

未携带正确 token 访问 `/setup` 应返回 404。

---

## 7. 初始化后台

打开：

```text
https://vmq.<your-subdomain>.workers.dev/setup?token=<上一步生成的令牌>
```

填写管理员账号、密码、后台别名和站点名称。提交成功后应跳转到后台登录页。

建议保留令牌。初始化完成后 `/setup` 仍会关闭；但如果 `admins` 表被误清空，只有携带正确 `SETUP_TOKEN` 才允许重新初始化。若删除令牌，重置管理员请使用 `scripts/reset-admin.mjs` 生成命令，而不是依赖公开 `/setup`。

验证配置键：

```bash
npx wrangler d1 execute vmq --remote -c "$(node scripts/cfg.mjs)" --json \
  --command "SELECT k FROM config ORDER BY k"
```

---

## 8. 部署后验证

### 基础入口

```bash
B="https://vmq.<your-subdomain>.workers.dev"

curl -s -o /dev/null -w "health %{http_code}\n" "$B/api/health"
curl -s -o /dev/null -w "setup  %{http_code}\n" "$B/setup"
curl -s -o /dev/null -w "console %{http_code}\n" "$B/console/index.html"
```

预期：健康检查返回 200，初始化完成后 `/setup` 返回 404，后台入口能正常加载。

### 数据库

```bash
npx wrangler d1 execute vmq --remote -c "$(node scripts/cfg.mjs)" --json \
  --command "SELECT COUNT(*) AS admins FROM admins"
```

管理员数量应至少为 1。

### 后台

登录后依次检查概览、订单、通道、日志、管理员和系统配置页面，
确认页面与控制台均无异常。

### 下单链路

- 创建测试通道并确认监控端心跳正常。
- 使用测试参数创建订单，确认返回支付页或 JSON。
- 查询订单状态，确认订单写入数据库。
- 确认支付回调进入 `notify_task`，失败时按退避策略重试。

### 定时任务

确认部署输出包含计划的 Cron 表达式，并观察到过期订单被定时任务更新。

---

## 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `pnpm deploy` 提示发布到 registry | 使用了 pnpm 内置命令 | 改用 `pnpm run deploy` |
| 全站 500，提示 `no such table` | 未执行 schema 或数据库 ID 错误 | 重新检查第 3、4 步 |
| binding 找不到数据库 | 配置中的 ID 未更新 | 重新执行 `d1 create` 并更新配置 |
| `/setup` 返回 404，但已有管理员 | 已完成初始化 | 使用 `scripts/reset-admin.mjs`，不要直接清空管理员表 |
| `/setup` 返回 404，管理员为空 | 实例曾完成初始化，或 `SETUP_TOKEN` 缺失/不匹配 | 配置正确 `SETUP_TOKEN` 后用 `/setup?token=...`；否则用重置脚本 |
| 删除 Worker 提示仍有 routes | 绑定了自定义域名 | 先解绑 route / 自定义域名 |
| 静态资源 404 | 只执行了 `wrangler deploy`，没有构建 | 使用 `pnpm run deploy` |
| 监控端推送 301/403 | HTTPS 跳转丢失 POST body | 关闭强制跳转，确保接口直连 |
| 上传图片 404 | `uploads` 表为空或上传失败 | 检查上传记录与大小限制 |
| Cron 未执行 | 触发器未更新 | 重新部署并查看 Worker 日志 |

---

## 只重置数据

如果只想清空业务数据、保留 Worker 和配置：

```bash
npx wrangler d1 execute vmq --remote -c "$(node scripts/cfg.mjs)" --command \
  "DELETE FROM orders; DELETE FROM tmp_price; DELETE FROM notify_task; DELETE FROM logs; DELETE FROM unmatched_push; DELETE FROM auth_attempt;"

# 如确需重新走 /setup：必须先配置并验证 SETUP_TOKEN，再清空 admins。
# 未配置正确令牌时，已初始化实例即使管理员为空也会返回 404。
```

清空 `admins` 不会自动重新生成通讯密钥；监控端通常无需重新绑定。更推荐直接使用 `scripts/reset-admin.mjs` 重置密码，避免重新开放初始化入口。
