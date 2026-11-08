# 第三方声明

本项目自身代码以 [MIT](./LICENSE) 发布。本文件汇总上游项目、UI 组件与第三方依赖的版权和许可信息。

> 本文件随仓库更新，依赖版本以 `pnpm-lock.yaml` 为准；它不构成法律意见。

## 1. 上游项目

### V免签（vmqphp）

- 仓库：<https://github.com/szvone/vmqphp>
- 许可证：MIT
- 版权：Copyright © 2019 vone

本项目是 V免签的 TypeScript / Cloudflare Workers 重写，支付协议、订单与监控端交互等部分业务逻辑和接口行为沿用上游。上游仓库未放置根目录 `LICENSE` 文件，但其 README 明确以 MIT 发布；上游 MIT 声明如下：

```text
MIT License

Copyright (c) 2019 vone

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### shadcn/ui

- 仓库：<https://github.com/shadcn-ui/ui>
- 许可证：MIT
- 版权：Copyright © 2023 shadcn

`apps/admin/src/components/ui/` 下的部分组件改编自 shadcn/ui，同样适用 MIT 条款：

```text
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 2. 直接依赖

下表按 `package.json` 中的直接依赖整理。依赖的许可证以各自 `package.json` 的 `license`
字段和包内 `LICENSE*` 文件为准，安装后可在 `node_modules` 中查看。

| 依赖 | 使用位置 | 许可证 |
| --- | --- | --- |
| `@cloudflare/workers-types` | 根目录（构建 / 类型） | MIT OR Apache-2.0 |
| `typescript` | 根目录 / 后台 / 前台（构建） | Apache-2.0 |
| `wrangler` | 根目录（构建 / 部署） | MIT OR Apache-2.0 |
| `@radix-ui/react-dialog` | 后台 | MIT |
| `@radix-ui/react-label` | 后台 | MIT |
| `@radix-ui/react-popover` | 后台 | MIT |
| `@radix-ui/react-select` | 后台 | MIT |
| `@radix-ui/react-slot` | 后台 / 前台 | MIT |
| `@radix-ui/react-tabs` | 后台 | MIT |
| `@tanstack/react-query` | 后台 | MIT |
| `@tesseract.js-data/eng` | 后台（固定金额码图片 OCR） | MIT |
| `tesseract.js` | 后台（固定金额码图片 OCR） | Apache-2.0 |
| `class-variance-authority` | 后台 / 前台 | Apache-2.0 |
| `clsx` | 后台 / 前台 | MIT |
| `date-fns` | 后台 | MIT |
| `jsqr` | 后台 | Apache-2.0 |
| `lucide-react` | 后台 / 前台 | ISC |
| `react` | 后台 / 前台 | MIT |
| `react-dom` | 后台 / 前台 | MIT |
| `react-day-picker` | 后台 | MIT |
| `react-router-dom` | 后台 | MIT |
| `sonner` | 后台 | MIT |
| `tailwind-merge` | 后台 / 前台 | MIT |
| `@tailwindcss/vite` | 后台 / 前台（构建） | MIT |
| `@types/react` | 后台 / 前台（类型） | MIT |
| `@types/react-dom` | 后台 / 前台（类型） | MIT |
| `@vitejs/plugin-react` | 后台 / 前台（构建） | MIT |
| `tailwindcss` | 后台 / 前台（构建） | MIT |
| `vite` | 后台 / 前台（构建） | MIT |

## 3. 间接依赖与构建工具

前端构建产物中可能包含若干传递依赖（如 `@floating-ui/*`、`@remix-run/router`、`@tanstack/query-core`、`react-remove-scroll*`、`scheduler`、`tslib` 等），它们分别以 MIT、ISC、0BSD 等许可证发布，许可证原文随包分发。

以下工具仅用于构建或本地开发，不会被打包进 Worker 或前端产物：

- `workerd`、`sharp`：Apache-2.0
- `@img/sharp-libvips-*`：LGPL-3.0-or-later（作为 `sharp` 的预编译依赖提供）
- `lightningcss`：MPL-2.0
- `caniuse-lite`：CC-BY-4.0，数据来源于 <https://caniuse.com/>，版权归 caniuse 贡献者所有
- `browserslist`、`postcss`、`rollup`、`esbuild` 等：MIT

`apps/admin/public/ocr/` 下的 OCR worker/core 与英文训练数据来自 Tesseract.js / Tesseract / tessdata 生态，用于在浏览器本地识别固定金额码图片；相关上游分别按 Apache-2.0 或包内声明的许可证发布。

Apache-2.0 全文见 [licenses/Apache-2.0.txt](./licenses/Apache-2.0.txt)；其他许可证可在 <https://spdx.org/licenses/> 查阅。

## 4. 商标与图片素材

以下文件仅用于在支付页 / 站点上标示支付方式：

- `public/static/pay/3/img/` 下的支付标识
- `public/static/web/picture/` 下的支付标识
- `apps/web/public/images/qqpay-icon.png`

微信、支付宝、QQ、数字人民币等名称、标识及相关图形是其各自权利人的商标或受版权保护的作品。它们不适用本项目的 MIT 许可，本项目也不表示获得其授权或背书。若你重新分发这些素材，请自行确认是否符合权利人的使用要求。
