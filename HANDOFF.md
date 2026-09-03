# 项目交接文档 — Successful西西弗斯 | 交易日记（Bitget 实盘同步站）

> 最后更新：2026-09-04。本文档面向接手维护的 AI/开发者，覆盖全部架构、文件位置、凭据位置、已知坑与运维手册。

## 1. 项目是什么

用户（X：@XiaoHan_aw，站名 **Successful西西弗斯**）在 X 上公开承诺"三年之约"（2026–2029，本金 2.7万 → 100万），需要一个**公开、防篡改、自动同步**的实盘交易记录网站作为信任凭证。

- **线上地址**：https://du3162417185-wq.github.io/bitget-journal/
- **代码仓库**：https://github.com/du3162417185-wq/bitget-journal（公开）
- **本地目录**：`D:\bitget-journal`（Windows + Git Bash；⚠️ 用户规矩：**任何文件不许放 C 盘**）
- **GitHub 账号**：`du3162417185-wq`，gh CLI 已装（`C:\Program Files\GitHub CLI\gh.exe`）且已登录
- **成本**：0 元（GitHub Pages + 公共仓库 Actions + Cloudflare Workers 免费额度），用户无需服务器、无需开机

## 2. 架构与数据流（一句话版）

Cloudflare Cron 每 5 分钟触发 GitHub Actions → `scripts/fetch.mjs` 从 Bitget 统一账户 v3 **只读 API** 抓取并与历史归档合并 → 快速运行直接部署 GitHub Pages，每小时一次提交 `data/*.json` 作为长期归档 → 访客浏览器每分钟检查 `version.json`，版本变化才读取完整 `data.json`。GitHub 自带 20 分钟 cron 继续作为独立兜底。

```
┌─ 本地 D:\bitget-journal ─────────────────────────────┐
│ index.html / app.js / style.css      网站前端（纯静态、零依赖、深色主题） │
│ scripts/fetch.mjs                    同步+归档合并脚本（Node ≥18，唯一依赖 undici）│
│ scripts/import-history.mjs           一次性工具：导入经典账户官方导出文件 │
│ scripts/review-server.mjs            本机作者复盘服务（同步→保存→提交→推送）│
│ scripts/verify.mjs                   不联网、不改数据的静态自检 │
│ data/data.json                       全量数据（网站唯一数据源，也是归档本体）│
│ data/version.json                    小型版本清单（前端增量刷新探针） │
│ data/equity-history.json             权益快照，逐次追加（长期净值曲线） │
│ data/import-history.json             经典账户导入数据（静态，2026-02~07）│
│ data/reviews.json                    作者复盘（平仓唯一键→正文/时间）│
│ admin.html / 点评.bat                本机复盘编辑器与双击入口 │
│ .env                                 密钥（被 .gitignore 排除，绝不入库）│
│ sync-and-push.bat                    Windows 本地手动同步+推送 │
│ .github/workflows/sync.yml           抓取→选择性归档→每次部署 Pages │
│ .github/workflows/deploy.yml         手动改页面推仓库时：部署 Pages │
│ scheduler/worker.mjs + wrangler.toml Cloudflare 5 分钟触发器（不接触 Bitget）│
└──────────────────────────────────────────────────────┘
```

前端标签页：总览（指标卡+累计盈亏曲线+每日盈亏柱图）/ 当前持仓 / 平仓历史 / 成交明细 / 历史委托 / 充提记录 / 关于本站。表格可筛选、可导出 CSV。前端每分钟用 `cache:no-store` 检查百余字节的版本文件；仅在版本号变化时用版本化 URL 重载完整数据，并在版本探针异常时保留 5 分钟完整刷新兜底。

### 2.1 作者复盘数据流

双击 `点评.bat` → `review-server.mjs` 仅监听 `127.0.0.1:8931` → 启动及保存前先同步远端 `main` → `admin.html` 选择平仓并编辑 → 校验复盘 key 确实对应最新平仓 → 只写 `data/reviews.json` → commit + push → `deploy.yml` 发布。访客主站并行读取 `data.json` 与 `reviews.json`，只显示复盘，无写接口。

复盘唯一键与归档平仓键完全相同：`symbol|posSide|floor(updatedTime/1000)`。当前 88 笔平仓无键冲突；`npm run verify` 会持续检查重复键、孤儿复盘、空正文和遗留测试文案。

本机工具的保护规则：必须位于 `main`、工作区必须干净；pull/rebase、网络或 push 任一步失败都会明确停止。不要恢复旧版“吞掉 pull 错误继续 push”的逻辑。`admin.html`、脚本和本地工具不会打入 Pages artifact。

## 3. 密钥（只读，无资金风险）

- Bitget API 权限：**仅只读**（统一账户交易只读 + 管理），无交易/提现权限，泄露最大风险是别人能看到持仓。
- 存放位置：本地 `D:\bitget-journal\.env`（`BITGET_KEY / BITGET_SECRET / BITGET_PASSPHRASE / BITGET_PROXY`）+ GitHub 仓库 Secrets（同前三项，Actions 用）。
- **绝不能**把密钥写进任何入库文件（`.env` 已被 `.gitignore` 排除并验证）。
- 轮换方法：Bitget 后台删旧建新 → 改 `.env` → `gh secret set BITGET_KEY -R du3162417185-wq/bitget-journal -b "新值"`（三个各来一次）。
- Cloudflare 只有 `GITHUB_ACTIONS_TOKEN`：GitHub fine-grained token，仓库范围仅本项目，权限仅 `Actions: Read and write`，设到期时间；它只能触发工作流，不能读取 Actions Secrets，也不能访问 Bitget。不要把 token 写进 `wrangler.toml` 或任何文件。

## 4. Bitget API 关键事实（血泪坑）

1. **账户是统一交易账户（UTA），必须用 v3 接口**（`/api/v3/...`）。v2 全部报 40085"您处于统一账户模式"。常用：
   - `GET /api/v3/account/assets`（总权益）、`/api/v3/account/settings`
   - `GET /api/v3/position/current-position`、`/api/v3/position/history-position`（**仅保留约 90 天**）
   - `GET /api/v3/trade/fills`、`/api/v3/trade/history-orders`、`/api/v3/trade/unfilled-orders`
   - `GET /api/v3/account/financial-records`（资金费真实发生时间；最多回溯 90 天，单次区间最多 30 天）
   - 公开行情：`GET /api/v3/market/tickers?category=USDT-FUTURES`
2. 鉴权：header `ACCESS-KEY / ACCESS-SIGN / ACCESS-TIMESTAMP / ACCESS-PASSPHRASE`；签名 = Base64(HMAC-SHA256(ts + "GET" + path含query + ""))；成功码 `00000`。
3. 分页：`limit=100` + 响应里的 `cursor` 回传（不是 pageNo）。
4. **网络**：本机访问 api.bitget.com 和 github.com 都必须走 Clash 代理 `http://127.0.0.1:7897`（fetch.mjs 通过 `.env` 的 BITGET_PROXY + undici ProxyAgent 实现）；GitHub Actions（美国 IP）直连 Bitget 正常，无需代理。

## 5. 归档合并机制（本项目灵魂）

API 只给近 90 天平仓/成交，但网站承诺"全量、不丢失"。`fetch.mjs` 因此**不是覆盖而是合并**：

- 平仓：按 `symbol+posSide+平仓秒级时间戳` 去重，源优先级 旧归档 < CSV导入 < API（后源覆盖同键）；
- 委托：按 `orderId` 去重；
- 成交：多重集去重——键 = `symbol|秒|成交价|数量`，同键多笔按各源最大计数保留（处理同一毫秒多笔同量成交）；后源覆盖（API 版含 execPnl，优先于 CSV 版）；
- 资金流水：按流水 `id` 去重；每次分 3 个 30 天窗口抓满近 90 天，并与旧 `financialRecords` 合并永久归档；
- **缺口归集**：经典账户 CSV（止于 2026-06-04）与 API 平仓（始于 06-25）之间的缺口，用成交明细里的平仓方向+execPnl 按"币种+方向+自然日"归集成伪平仓记录，`importSource: 'gap-synth'`，页面上标「归集」；
- ⚠️ **`data/data.json` 就是归档本体，永远不要删它**（删了 = 丢掉 90 天窗口外的全部历史）。equity-history.json 同理（追加式快照）。

时间统计口径（`stats`）已于 2026-08-27 改为**逐笔成交日入账**：每次平仓/减仓的 `fills.execPnl` 记在真实成交日，所有合约成交手续费按成交日扣除，资金费按 `financial-records.ts` 的真实收支日计入。资金流水 API 覆盖之前的早期资金费只能按官方历史仓位结清日补录；2026-02 首批没有逐笔成交明细的 9 个整仓记录也以 `legacy-close` 兜底。胜率仍按整仓 `netProfit>0` 计算，避免把同一订单拆成多次撮合后扭曲胜率。

## 6. 经典账户历史导入（scripts/import-history.mjs）

- 数据源：`E:\OneDrive\Desktop\bitget\` 下的 Bitget 后台导出文件（路径可用环境变量 `BITGET_EXPORT_DIR` 覆盖）：
  - `导出 U 本位合约成交明细-*.csv`（2026-03~06-04，含每笔已实现盈亏）
  - `导出 U 本位合约历史仓位-*.csv`（2026-02~06-04，平仓记录主源）
  - `20260731_112243_1.csv`（06-04~07-31 委托，含现货 rMSTR/rNVDA）
  - `20260731_112243_2.csv`（06-04~07-31 成交）
  - `导出充提记录-*.xls`（真·OLE2 二进制 Excel，用 Python xlrd 读取，`python -X utf8`）
- CSV 坑：经典导出**手续费是负数**（导入时取 abs 统一为正）；时间为 **UTC+8**；订单号字段带 `\t` 前缀；现货币对 `rMSTR/USDT` 需规范化为 `rMSTRUSDT`；文件头有 BOM。
- 运行：`node scripts/import-history.mjs` → 重写 `data/import-history.json` → 下次同步自动并入（fetch 每次都会 merge 它）。
- 有新导出文件：改脚本里 `FILES` 路径（或加文件）→ 重跑 → commit push。**不要删 data.json**。

## 7. Git / 部署流程（照抄即可）

```bash
cd /d/bitget-journal
# 改完代码后：
git add -A
git commit -m "说明"
git -c http.proxy=http://127.0.0.1:7897 pull --rebase -X ours origin main   # 必须！自动归档会产生远端提交
git -c http.proxy=http://127.0.0.1:7897 push
```

- 仓库级 git 身份已配置（user.name=xixifusi）；全局没配，命令行临时身份不再需要。
- 直接 push 会触发 `deploy.yml` 部署；`sync.yml` 每次运行都直接部署本次快照。`persist=false` 的快速运行不提交仓库，每小时 `persist=true` 一次以及 GitHub 原生 cron 会提交长期归档。
- 两个工作流都会先整理 `_site`，仅发布前端、JSON 数据和四份说明文档；不会把 `admin.html`、本机脚本、node_modules 或其他开发文件发布到 Pages。
- Pages 已启用 build_type=workflow；`configure-pages` 带 `enablement: true`。
- Pages CDN 对 data.json 有缓存；前端先轮询 `version.json?t=分钟号`，发现变化后读取 `data.json?v=生成时间`，不会把 1MB 级完整数据每分钟重复下载。
- 手动归档并部署：`gh workflow run sync.yml -R du3162417185-wq/bitget-journal -f persist=true`；仅快速部署用 `-f persist=false`（gh 命令需走本机代理）。
- 两个工作流引用的官方 Actions 均固定到完整 commit SHA；checkout 不持久保存凭据，`npm ci --ignore-scripts` 禁止依赖生命周期脚本，仓库写令牌只在归档提交步骤注入。

## 8. 常见运维

| 任务 | 做法 |
|---|---|
| 本地看效果 | `cd /d/bitget-journal && python -m http.server 8923 --bind 127.0.0.1` → http://127.0.0.1:8923 |
| 本地手动同步 | `npm run sync`（.env 里已配代理）或双击 `sync-and-push.bat` |
| 写/改作者复盘 | 保证工作区干净且在 main → 双击 `点评.bat` → 选择平仓 → 保存并推送 |
| 上线前静态自检 | `npm run verify`（不联网、不修改数据） |
| 改页面文案/样式 | 改 index.html/app.js/style.css → 按第 7 节推送 |
| 导入新历史文件 | 见第 6 节 |
| 查工作流状态 | `gh run list -R du3162417185-wq/bitget-journal --limit 5` |
| 查 5 分钟调度 | Cloudflare Dashboard → Workers & Pages → bitget-journal-scheduler → Triggers / Logs |
| 国内打不开 | 已知问题（github.io 被墙）。预案：迁 Cloudflare Pages——repo 接入 CF Pages（build 无命令、输出根目录），定时同步改为 CF Workers Cron 或仍用 GitHub Actions push（CF 自动部署）；域名换成 pages.dev |

## 9. 当前数据基线（2026-08-27 18:29）

逐笔平/减仓成交 715 次，逐笔全量净已实现盈亏 **+2,018.88 USDT**；近 30 天 **+527.91 USDT**；2026-06-03 当日 **+359.44 USDT**（均为扣实际成交手续费及可获得资金费后的时间口径）。整仓结束记录 89 笔（CSV 导入 54 / API 28 / 归集 7），整仓胜率 57.3%，手续费 153.01，时间账本资金费 −173.99，成交 2,122 笔，委托 617 笔，资金费流水归档 142 条，充提 20 笔，权益约 3,690.00 USDT（数字会随自动同步变化）。

## 10. 环境清单

Windows 10/11 + Git Bash；Node v22（唯一 npm 依赖 undici@6，`npm install` 即可）；Python 3.11 + xlrd 2.x（仅导 xls 用）；gh CLI 2.98；Clash Verge 代理端口 7897（开机需运行，否则本地同步/推送失败——GitHub Actions 不受影响）。
