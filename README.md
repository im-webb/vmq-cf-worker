# V免签(易支付协议) · Cloudflare Workers 版

> V免签 Cloudflare Workers 版，使用易支付协议，对PHP原版做了部分能力增强。

**它解决什么问题**：你想在自己的站点上收几块钱，但不想接支付宝/微信的商户资质。V免签用「监听手机收款通知」来代替支付回调，把钱到账这件事自动化。

```
用户扫码付款 → 手机/电脑收到收款通知 → 监控端 App 监听到 → POST /appPush
                                                              ↓
                        按金额匹配订单 → 标记已支付 → 回调你的商户系统 → 发货
```

> 用 AI 助手代为安装、配置或维护：直接看 [AI Agent 指南](#ai-agent-指南)，里面有可整段复制的提示语。
> 提交与安全约束在 [AGENTS.md](./AGENTS.md)。

## 和 V免签、易支付的关系

这个项目**不是「V免签 + 易支付」两套东西拼在一起**，而是「**V免签 的一个 TypeScript / Workers 重写**」。它天生同时具备两个身份：

- **对外是易支付协议的兼容网关**（这是 V免签 原本的对外形态）：商户用标准参数下单、按同一套 MD5 规则验签、按同一套格式回调。已经接过易支付的商城，改个网关地址和通讯密钥就能用。
- **对内是个人收款码 + 手机监听的免签收单机**：没有支付回调，靠监控端 App 监听收款通知确认到账 —— 这就是「免签」二字的含义，也是 V免签 的内核。

所以「易支付的内容」本质只是 V免签 的商户接口层（`src/routes/submit.ts`、`src/lib/sign.ts`、`src/lib/notify.ts`），仓库主体仍是 V免签 的业务（通道、订单、金额池、监控端）。**本项目也没有对接任何第三方易支付网关**：全仓唯一的出站请求是回调你自己的 `notify_url`。

## 特性

|                  |                                                                   |
| ---------------- | ----------------------------------------------------------------- |
| **零服务器**     | 全部跑在 Cloudflare，不需要 VPS、不需要 MySQL                     |
| **免费额度够用** | Workers 10 万请求/天、D1 5GB，个人站点绰绰有余                    |
| **双通道回调**   | 服务端异步回调（带 8 次退避重试）+ 浏览器回跳兜底                 |
| **金额池防串单** | 同一金额同一时间只能有一笔待支付订单，避免"钱到了不知道是谁的"    |
| **独立后台**     | React + shadcn 的 SPA，深色模式、分 tab 配置；不依赖任何 PHP 页面 |
| **一键初始化**   | 部署后访问 `/setup` 创建管理员并随机生成密钥，没有默认密码        |

## 界面预览

**前台 · 站点首页**

![前台首页：顶部导航、主标题与四步支付流程卡片](./docs/screenshots/site-home.jpg)

> 顶部是「首页 / 开发文档 / 支付体验」导航；右侧卡片把支付流程拆成
> 创建订单 → 用户支付 → 结果通知 → 确认状态四步；下方是三步接入指引。

**后台 · 概览**

![后台概览：左侧功能导航、监控端状态徽标、收入与订单统计](./docs/screenshots/admin-overview.jpg)

> 左侧是功能导航（概览 / 订单管理 / 通道管理 / 操作日志 / 管理员 / 系统配置）；
> 顶部徽标是监控端心跳状态（绿=在线、黄=心跳中断未超 10 分钟、红=离线）；
> 下方依次是累计与今日收入、订单数、近 7 天收入明细、订单状态分布和系统信息。

> 截图入库前已压到宽 1400（原图是 2x 视网膜尺寸），仓库里不存原始大图。
> 它们放在 `docs/screenshots/`，不在 `wrangler` 的 assets 目录下，不会随 Worker 部署。

## 快速开始

### 0. 前置

- [Node.js](https://nodejs.org/) 22.15+
- [pnpm](https://pnpm.io/installation) 9+（`corepack enable` 即可；仓库已用 `packageManager` 锁定版本）
- [Cloudflare 账号](https://dash.cloudflare.com/sign-up)（免费即可）
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-update/)：`npm i -g wrangler`
- 监控端 App：**推荐 [V免签配套监控安卓端](https://github.com/im-webb/vmq-monitor-android)** —— Kotlin 原生实现，监听通知栏到账通知后上报到本服务端，扫码复用同一套配置；`minSdk 24`（Android 7.0+）

```bash
wrangler login
```

### 1. 拉代码 + 装依赖

```bash
git clone https://github.com/im-webb/vmq-cf-worker.git
cd vmq-cf-worker
pnpm install
```

### 2. 创建 D1 数据库

```bash
wrangler d1 create vmq
```

输出里会有 `database_id = "xxxx-xxxx-..."`，复制下来。

### 3. 填配置

```bash
cp wrangler.example.jsonc wrangler.local.jsonc
```

把 `wrangler.local.jsonc` 里的 `<your-database-id>` 换成上一步的 id。

> `wrangler.local.jsonc` 已在 `.gitignore` 里，不会被提交。
>
> **多个环境**（比如本地开发库一个账号、测试环境又一个账号）：把配置另存一份，
> 用环境变量指定即可，不用来回改文件：
>
> ```bash
> WRANGLER_CONFIG=wrangler.local.test.jsonc pnpm run deploy
> ```
>
> 不指定就走默认的 `wrangler.local.jsonc`。

### 4. 建表

```bash
pnpm db:remote        # 建表（schema.sql）
```

表结构是全部配置的来源；后台菜单由 SPA 内置，不需要额外数据。

> ⚠️ 必须带 `--remote`（脚本里已经带了）。不带的话只初始化本地模拟库，线上仍然是空的。

### 5. 部署

```bash
pnpm run deploy
```

> 必须写 `pnpm run deploy`：`pnpm deploy` 是 pnpm 自己的命令（用于 workspace 部署），
> 会报 `ERR_PNPM_NOTHING_TO_DEPLOY`，不会执行本项目的脚本。

它会先构建后台 SPA（`apps/admin`）与前台站点（`apps/web`），产物落到 `public/`，再随 Worker 一起上传。
完成后会给你一个 `https://vmq.<你的子域>.workers.dev` 地址。

### 6. 初始化（关键一步）

打开 `https://你的地址/setup`，填：

| 项                | 说明                                   |
| ----------------- | -------------------------------------- |
| 管理员账号 / 密码 | 至少 8 位，**没有默认密码**            |
| 后台入口别名      | 后台会挂在 `/<别名>`，建议别用 `admin` |
| 站点名称          | 显示在支付页上                         |

提交后直接跳到登录页 `/<别名>/login`，用刚设置的账号登录即可。

通讯密钥在安装时自动生成（32 位十六进制），之后可以在后台「系统配置 → 密钥管理」查看并复制完整值；填新值保存才会覆盖，留空保存表示保持不变。它是后台管理员和商户、监控端共用的敏感信息，请勿泄露。

初始化完成后 `/setup` 自动关闭（再次访问返回 404）。

> **防抢注（可选）**：部署完到点开 `/setup` 之间，任何人先访问就能占走管理员。
> 想堵住这个窗口，先设一个初始化令牌：
>
> ```bash
> npx wrangler secret put SETUP_TOKEN        # 随便一串只有你知道的值
> ```
>
> 之后必须用 `/setup?token=<令牌>` 打开；表单里会自动带上令牌，提交不需要手动加。
> 初始化完成后可以删掉：`npx wrangler secret delete SETUP_TOKEN`。

### 7. 后台配置

登录 `/<别名>/login`：

1. **通道管理** → 新增通道（微信 / 支付宝 / QQ / 数字人民币），填收款码
2. **系统配置 → 站点信息** → 站点地址、站点名称等（站点地址在 `/setup` 时已自动写成当前域名，可改）
3. **系统配置 → 密钥管理** → 通讯密钥就在这里；商户下单签名和监控端签名共用同一把

> 回调成功判定（`notify_success_body`，默认 `@json:code=1`）暂时没有后台入口，需要改库：
>
> ```bash
> npx wrangler d1 execute vmq --remote --command "UPDATE config SET v='success' WHERE k='notify_success_body'"
> ```
>
> 三种取值见下面「异步回调」一节。

### 8. 固定金额码（可选）

后台「固定金额码」用于给某个通道预先绑定：

```text
实际支付金额 + 支付类型 → 固定金额收款码
```

下单流程：

1. 系统先按金额池分配实际应付金额
2. 用“实际应付金额 + 支付类型”精确查找启用的固定码
3. 命中时返回固定码，接口 `isAuto = 0`，订单归属固定码所属通道
4. 未命中时回退该支付类型的第一个启用通道默认码，接口 `isAuto = 1`，用户需按页面金额付款

例如 `10.00` 已被其他待支付订单占用，新订单会变成 `10.01`。此时应配置 `10.01` 的固定码；没有配置就自动回退无金额码。

固定码支持两种录入方式：

- **上传图片并解码**：保存二维码文本，支付页现场生成二维码
- **上传为图片**：保存图片地址，支付页直接展示原图（适合赞赏码）

批量添加有两种方式：

1. **金额 + 地址**：每行 `金额,二维码内容或图片地址`，支持逗号、Tab 或 `|` 分隔
2. **批量图片**：优先从文件名或二维码参数识别金额；仍无法识别时，在浏览器本地 OCR 识别二维码上方的金额。导入时不会自动按步长填值，无法识别的行保持空白，可再手动点击“按规则填充空白金额”

批量导入前先选择所属通道。解析后会在“人工复核”列表中显示每张码的缩略图、金额、码类型和来源；点击缩略图会在当前页面弹窗放大。可修改金额、切换文本码/图片码、删除错误行，再一次性提交。一次最多 200 条；批次内重复或与数据库已有金额冲突时整批拒绝，不写入任何数据。

全新安装直接执行 `pnpm db:remote` 即可。已有 D1 升级只需执行一次：

```bash
pnpm exec wrangler d1 execute vmq --remote -c .\wrangler.local.jsonc --file=.\migrations\20261108_fixed_amount_qrcodes.sql
```

> 同一通道、同一金额只允许一条固定码。当前监控协议按“支付类型 + 到账金额”匹配订单，因此仍需依赖金额池保证同一金额、同一支付类型同时只有一笔待支付订单。

### 9. 绑定监控端

用 [V免签配套监控安卓端](https://github.com/im-webb/vmq-monitor-android) 扫描后台「通道管理」列表里的「APP扫码配置」二维码，或在 App 里按同样格式手动填写：

```
https://your-domain.com/通讯密钥/通道id,支付类型      例：https://pay.example.com/3f9a…/8,1
```

域名取「系统配置 → 站点信息」的站点地址，没配则用你访问后台时所用的域名。

## AI Agent 指南

给 AI 助手（Claude Code、Codex、Cursor、Qoder、Copilot 等）用的操作说明：**怎么装、怎么用、怎么维护**。
安全与提交的硬约束在 [AGENTS.md](./AGENTS.md)，动手前先读那一份；本节只讲"怎么做"。

> 下文 `<地址>`、`<别名>`、`<database-id>` 均为占位符。真实域名、D1 ID、密钥、收款码**只能**写进
> `wrangler.local.jsonc` 等已忽略文件，绝不进入任何会被提交的内容。

### 三条硬性约束

1. **先读 [AGENTS.md](./AGENTS.md)** —— 它列了绝对不能提交的清单（真实域名、Account ID、密钥、收款码）。
2. **改完必须过门禁** —— 提交前 `pnpm check:leak:worktree`，推送前 `pnpm check:leak`。
3. **破坏性操作先问** —— `DROP` / `DELETE` / `wrangler d1 delete` / 改 schema / 重置管理员，一律先确认再动。

### 命令速查

| 目的 | 命令 | 作用范围 |
| --- | --- | --- |
| 装依赖 | `pnpm install` | 本地 |
| 新建 D1 库 | `pnpm db:create` | 远程 |
| 建表 / 补表结构 | `pnpm db:remote` | 远程，只跑 `IF NOT EXISTS`，不删数据 |
| 升级固定金额码（已有库一次） | pnpm exec wrangler d1 execute vmq --remote -c .\wrangler.local.jsonc --file=.\migrations\20261108_fixed_amount_qrcodes.sql | 远程，新增 qrcodes 与 orders.pay_url_type |
| 构建 + 部署 | `pnpm run deploy` | 远程 Worker |
| 本地起服务 | `pnpm dev` | 本地 |
| 初始化本地库 | `pnpm db:local` | 本地 |
| 全量自检 | `pnpm verify` | 需先 `pnpm db:local`，且 `pnpm dev` 在跑 |
| 泄露门禁 | `pnpm check:leak` | 工作区 + 全部 Git 历史 |
| 重置管理员 | `node scripts/reset-admin.mjs` | **只改本地**，会同时打印远程命令 |
| 同步 CDN（可选） | `pnpm cdn:sync` | 远程 OSS |
| 查远程库 | `pnpm exec wrangler d1 execute vmq --remote -c "$(node scripts/cfg.mjs)" --command "..."` | 远程 |

> 必须写 `pnpm run deploy`。`pnpm deploy` 是 pnpm 自身的命令，会报 `ERR_PNPM_NOTHING_TO_DEPLOY`。

**多环境容易踩的坑**：所有带 `-c "$(node scripts/cfg.mjs)"` 的命令都认 `WRANGLER_CONFIG`。
目录里存在多份 `wrangler.local.*.jsonc` 时，先确认当前用的是哪一份——它们可能绑的是不同的 D1，
选错会报 `7404` / `10181`（database not found），因为 wrangler 认的是当前登录的账号。

```bash
node scripts/cfg.mjs                             # 看当前解析到哪个配置文件
WRANGLER_CONFIG=wrangler.local.other.jsonc ...   # 临时切换到另一份
```

### 场景一：全新安装

复制下面整段给 Agent：

```text
请在本仓库完成一次全新安装。每步都要验证，任一步失败就停下报告现象，不要跳过、不要靠猜修复。

前置检查（任一项不满足就先告诉我，不要自动安装全局工具）：
- node -v            → 需 >= 22.15
- pnpm -v            → 需 >= 9（没有就让我自己执行 corepack enable）
- wrangler --version → 可用
- wrangler whoami    → 已登录

步骤：
1. pnpm install
2. pnpm db:create
   → 记下输出里的 database_id
3. cp wrangler.example.jsonc wrangler.local.jsonc
   → 把文件里的 <your-database-id> 换成上一步的 id
   → 改完确认 git status 里看不到这个文件（它已 gitignore）
4. pnpm db:remote
5. pnpm run deploy
   → 记下部署后的地址
6. 提醒我自己去打开 <地址>/setup 完成初始化；管理员账号密码由我填写，你不要代填

验收标准：
- 第 4 步后执行
  pnpm exec wrangler d1 execute vmq --remote -c "$(node scripts/cfg.mjs)" --command "SELECT name FROM sqlite_master WHERE type='table'"
  结果里必须有 passages / orders / admins
- 第 5 步后执行 curl -s -o /dev/null -w '%{http_code}' <地址>/api/health → 必须是 200

禁止：
- 不要执行 wrangler d1 delete、DROP、DELETE FROM
- 不要把真实域名 / database_id / 密钥写进任何会被提交的文件、注释或提交说明
```

### 场景二：配置到能收一笔测试款

```text
帮我把站点配到「能收一笔测试款」的状态，每步验证后再进下一步，遇到阻塞停下报告。

前置：我已经在 /setup 完成初始化，能登录后台。

1. 通道管理 → 新增通道
   支付模式 = 微信（wxpay）、通道模式 = 无金额收款码、支付用户ID 留空
   收款码 = 我口述给你的内容（你不要把它写进任何文件）
   保存后告诉我通道 id
2. 用测试参数下一单：商户号 1001、金额 0.12，确认接口返回 pay_url
3. curl -I <pay_url>，确认 200 且 content-type 是 text/html
4. 打开 pay_url，确认页面显示金额 0.12 和收款二维码

验收：后台「订单管理」能看到这笔订单、状态「待支付」；概览页「累计订单」比之前多 1。

注意：不要替我改订单状态、不要点「标记已支付」，测试款到账后由我自己处理。
```

### 场景三：对接商户系统

```text
帮我把本项目的易支付接口接到我的站点（我的语言：<你的语言>）。

1. 读 README「接口 → 创建订单」一节，列出必填参数和签名规则
2. 用 pid=1001、key=test-only-key 生成一个签名示例，把 MD5 的拼接顺序完整写出来
3. 给我一段最小可运行的下单代码，域名用 example.com、密钥用 test-only-key
4. 说明：异步回调怎么验签、失败会重试几次、什么条件算「已到账」

约束：示例里只用假值，不要用我的真实域名和密钥。
```

### 场景四：例行体检（只读）

```text
帮我做一次只读体检，不要修改任何数据。输出每行「项目：结论」，异常项前面加 [异常]。

1. curl -s -o /dev/null -w '%{http_code}' <地址>/api/health → 期望 200
2. 后台概览：报告监控端状态（在线 / 异常 / 离线）和心跳年龄
3. 订单管理：统计最近 24 小时「回调失败」的订单数量，列出订单号
4. 订单管理：统计最近 24 小时已支付订单的笔数和金额，与概览页对比是否一致
5. 通道管理：报告是否存在「有订单但收款笔数/金额全为 0」的通道
6. 若配了外部 CDN：pnpm cdn:dry，报告三个目录待上传对象数

不要导出全表，不要输出订单号以外的用户信息。
```

### 场景五：升级到最新版

```text
帮我把仓库升级到最新版并重新部署，前提是不能破坏线上数据。

1. git status → 有未提交改动就停下问我，不要 stash、不要 reset
2. git pull --ff-only
3. pnpm install
4. 对比 schema.sql：有没有新增表 / 列 / 索引，先告诉我影响再继续
5. pnpm db:remote      （只跑 CREATE ... IF NOT EXISTS，不会删数据）
6. pnpm run deploy
7. 部署完跑一次「例行体检」

如果 pull 出现冲突或分支分叉，停下报告，不要 rebase、不要强推。
```

### 场景六：重置管理员密码

```text
帮我重置后台管理员密码。先问我重置的是本地还是线上，不要自己假设。

本地：
  node scripts/reset-admin.mjs
  → 它会打印新口令，以及一条现成的远程 wrangler 命令

线上：
  1. 本地先跑 node scripts/reset-admin.mjs <账号> <新密码>，拿到它打印的哈希
  2. 执行它给出的那条 wrangler 命令；如果配了多环境，末尾补 -c "$(node scripts/cfg.mjs)"
  3. 用新密码登录验证，旧密码应当失效

注意：该脚本本身只改本地库，线上必须用上面第 2 步的命令。
如果是「彻底重装」（删 Worker 和 D1 再来一次），不要自行决定删除顺序，按 docs/reset-and-redeploy.md 走。
```

### 日常维护清单（人或 Agent 都能照做）

| 频率 | 检查项 | 怎么做 |
| --- | --- | --- |
| 每天 | 服务可达 | `curl -s -o /dev/null -w '%{http_code}' <地址>/api/health` 应为 200 |
| 每天 | 监控端在线 | 概览页徽标：绿=在线、黄=心跳中断 1~10 分钟、红=离线超过 10 分钟 |
| 每周 | 回调失败单 | 订单管理筛「回调失败」，逐条确认钱是否真到账，必要时手动补发 |
| 每周 | 泄露门禁 | `pnpm check:leak` |
| 每次改代码 | 全量自检 | `pnpm verify`（需 `pnpm dev` 在另一个终端运行） |
| 每月 | 备份 D1 | 见下方备份命令，存到 `.data/`（已 gitignore） |
| 每月 | 旧静态资源 | 每次部署会产生新的 hash 文件，旧的不会自动删；确认新版稳定后可手工清理 |
| 每季度 | 依赖升级 | `pnpm outdated`，升级后跑 `pnpm verify` |

备份线上库（**产物含真实数据，不要提交、不要上传**）：

```bash
pnpm exec wrangler d1 export vmq --remote --output ./.data/backup-$(date +%Y%m%d).sql -c "$(node scripts/cfg.mjs)"
```

## 接口

### 创建订单（你的站点 → 本站）

```
POST /api/order/create
```

> 旧版 PHP 站的 `/submit.php`（以及 `/submit`）仍然可用，已经写死旧地址的商户代码不用改。
> 新接入请用 `/api/order/create`，和查询接口 `/api/order/status` 成对。

| 参数           | 必填 | 说明                                                   |
| -------------- | ---- | ------------------------------------------------------ |
| `pid`          | ✅   | 商户 ID，见后台「系统配置 → 密钥管理」，安装时自动生成 |
| `type`         | ✅   | `wxpay` / `alipay` / `qqpay` / `rmb`（也接受 1/2/3/4） |
| `out_trade_no` | ✅   | 你的订单号，必须唯一                                   |
| `name`         | ✅   | 商品名                                                 |
| `money`        | ✅   | 金额，两位小数                                         |
| `notify_url`   | ✅   | 异步回调地址，**必须是域名，不能用裸 IP**              |
| `return_url`   |      | 支付完成后浏览器跳转地址                               |
| `sitename`     |      | 站点名                                                 |
| `sign`         | ✅   | 见下                                                   |
| `sign_type`    |      | 固定 `MD5`                                             |

签名：把所有非空参数按 **参数名 ASCII 升序** 拼成 `k1=v1&k2=v2`，末尾直接接通讯密钥，取 MD5：

```
sign = md5("money=1.00&name=月卡&notify_url=...&out_trade_no=...&pid=1001&return_url=...&sitename=...&type=wxpay" + 通讯密钥)
```

> `sign`、`sign_type` 不参与签名。响应默认 302 到支付页；带 `format=json` 时返回 JSON。

### 异步回调（本站 → 你的 notify_url）

GET 请求，参数：

```
pid, type, out_trade_no, trade_no, trade_status=TRADE_SUCCESS,
money, really_money, name, sitename, sign, sign_type=MD5
```

验签规则与下单一致。**返回什么算成功**取决于后台「回调成功判定」：

| 取值                   | 判定                             |
| ---------------------- | -------------------------------- |
| `success`              | 响应体去空白后等于 success       |
| `@any2xx`              | 只看 HTTP 状态码 2xx             |
| `@json:code=1`（默认） | 响应体是 JSON 且 `code` 字段为 1 |

失败会按 30s → 2m → 10m → 1h → 6h 退避重试，最多 8 次。

> 同一笔订单可能收到多次回调（服务端回调 + 浏览器回跳），**你的接口必须幂等**：
> 先查 `out_trade_no` 是否已处理，已处理直接返回成功。

### 其他

| 接口                       | 用途                                          |
| -------------------------- | --------------------------------------------- |
| `GET /checkOrder?orderId=` | 支付页轮询状态                                |
| `POST /appPush`            | 监控端推送到账（`type, price, t, pid, sign`） |
| `POST /appHeart`           | 监控端心跳（60 秒内无心跳会拒单）             |
| `GET /enQrcode?url=`       | 现场生成二维码 PNG                            |
| `GET /api/health`          | 健康检查                                      |

## 常见问题

**Q：回调一直失败，错误是 `403 error code: 1003`？**
`notify_url` 用了裸 IP。Cloudflare 只认 zone 自己的域名，请求 IP 会被拒。换成域名即可 —— **不要用 IP 做回调地址**。

**Q：后台显示"监控端离线"，下不了单？**
监控端 60 秒没心跳就会拒单。检查 App 是否被系统杀掉（需要保活 / 自启动权限），或在后台把 `require_online` 改成 0 临时放开。

**Q：忘记管理员密码？**
在 D1 里清空管理员表，重新访问 `/setup`：

```sql
DELETE FROM admins;
```

再打开 `/setup` 重设账号。**通讯密钥不会被重新生成**，监控端不用重新绑定。

**Q：上传图片提示"编码后超出数据库单条上限"？**
图片以 base64 存 D1，D1 单个值上限 2MB，所以原始文件限制在 1.4MB。收款码通常只有几十 KB，够用。要传大图建议改用 R2。

**Q：换域名要改哪些地方？**
① `wrangler.local.jsonc` 的 `routes`；② 后台「系统配置 → 站点信息」的站点地址；③ 商户侧的 `notify_url`。监控端二维码里的域名也要重新扫。

**Q：想彻底重来（删掉 Worker 和数据库再装一次）？**
见 [`docs/reset-and-redeploy.md`](docs/reset-and-redeploy.md)：备份 → 删除顺序 → 重建 D1 → 部署 → 初始化 → 五组验证 → 常见报错排查，每一步都有对应的验证命令。

## 本地开发

```bash
pnpm db:local            # 首次：初始化本地 D1 模拟库
pnpm dev                 # 本地起服务（另一个终端保持运行）
pnpm test                # 类型 + 模板渲染 + 签名 + 二维码解码 + 路由 + HTTP 冒烟，全量自检
pnpm check:leak          # 泄露门禁：工作区 + 全部 Git 历史 + 提交说明
pnpm check:leak:worktree # 只查可发布的工作区文件（更快）
pnpm check:leak:history  # 只查历史 blob 与提交信息
```

> `pnpm test` / `pnpm verify` 里的 `test:http`、`test:api` 会直接请求
> `http://localhost:8787`，不会自己起服务：先跑 `pnpm db:local`，并在另一个终端保持 `pnpm dev`。

泄露门禁会把命中内容脱敏后输出。真实域名 / 账号 / 姓名等私有值写在
`.private-rules.json`（已在 `.gitignore` 中，模板见 `.private-rules.example.json`）；
确认是测试假值时，可在同一行加 `check-leak-ignore` 注释。它只扫描 Git 可达历史，
不会读取 `wrangler.local.jsonc`、`seed.local.sql` 等被忽略的本地文件。

本地库初始化：

```bash
pnpm db:local
```

目录结构：

```
src/
  index.ts              路由入口
  routes/               后台 / 支付 / 推送 / 站点 / 初始化
  lib/                  签名、二维码、配置读取、D1 封装
  templates/pay.ts       支付页（内联样式，无外部 CSS 依赖）
public/                 构建产物与静态图，随 Worker 一起发布
schema.sql              D1 表结构
seed.sql                预留的种子数据入口（当前为空）
wrangler.example.jsonc  配置模板（复制成 wrangler.local.jsonc 再填）
```

## 许可与致谢

- 本项目代码以 **MIT** 发布，见 [LICENSE](./LICENSE)；上游、UI 组件与依赖的完整版权声明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)
- 本项目是 [V免签（vmqphp）](https://github.com/szvone/vmqphp) 的 TypeScript / Cloudflare Workers 重写，上游以 MIT 发布（Copyright © 2019 vone）
- 后台部分 UI 组件改编自 [shadcn/ui](https://github.com/shadcn-ui/ui)（MIT，Copyright © 2023 shadcn）
- 微信 / 支付宝 / QQ / 数字人民币标识仅用于标示支付方式，商标权归各自权利人，不适用 MIT

> 仅供个人学习与自用。请遵守当地法律法规与合作平台的服务条款，不要用于违法用途。
