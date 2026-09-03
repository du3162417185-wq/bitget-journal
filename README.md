# 🪨 Successful西西弗斯 | 交易日记（Bitget 实盘同步）

个人实盘交易记录网站：总权益、当前持仓、历史平仓盈亏、成交明细、历史委托。
全部数据由 **Bitget 统一账户 v3 只读 API** 自动抓取，非手工填写；密钥只存在 `.env`（本地）与 GitHub Secrets（服务器），**绝不进入仓库**。

总览的区间盈亏与两张图采用**逐笔平/减仓成交日口径**：每次平仓的 `execPnl` 记在真实成交日，合约成交手续费按成交日扣除，资金费按账户流水的真实发生日计入。因此长期持仓中途止盈会反映在当月，而不会等整个仓位最终清空时一次性归集。

## 目录结构

```
index.html / app.js / style.css   网站（纯静态，无任何外部依赖）
scripts/fetch.mjs                 同步脚本（Node ≥18，读取 .env 或环境变量；归档合并制：API 90 天窗口外的老记录永久留存）
scripts/import-history.mjs        一次性：导入经典账户官方导出文件（CSV/XLS）→ data/import-history.json
scripts/review-server.mjs         本机作者复盘服务（同步最新交易→保存→提交→推送）
scripts/verify.mjs                不联网、不改数据的项目静态自检
data/data.json                    每次同步生成的数据（被网站读取、随仓库提交留痕）
data/version.json                 小型版本清单（前端用它判断是否需要重载完整数据）
data/equity-history.json          长期净值曲线快照（逐次追加）
data/reviews.json                 作者复盘（按平仓唯一键关联，公开只读）
admin.html / 点评.bat             本机复盘编辑器及双击入口
sync-and-push.bat                 Windows 本地手动/定时同步并推送
.github/workflows/sync.yml        同步、选择性归档并直接部署 Pages
.github/workflows/deploy.yml      数据/页面更新时自动发布 GitHub Pages
scheduler/                        Cloudflare Worker：每 5 分钟触发一次快速同步
```

## 本地运行

```bash
npm install
node scripts/fetch.mjs      # 抓取数据 → data/data.json
npx serve .                 # 或任意静态服务器预览
npm run verify              # 静态检查数据、复盘键和前端关键挂载点
```

`.env` 示例（本地专用，已被 .gitignore 排除）：

```
BITGET_KEY=bg_xxx
BITGET_SECRET=xxx
BITGET_PASSPHRASE=xxx
BITGET_PROXY=http://127.0.0.1:7897   # 服务器上不需要，留空
```

## 部署（GitHub Pages，一次性）

1. 在 GitHub 新建**公开**仓库（如 `bitget-journal`），把本项目推上去；
2. 仓库 Settings → Secrets and variables → Actions 添加三个 Secret：
   `BITGET_KEY`、`BITGET_SECRET`、`BITGET_PASSPHRASE`；
3. Settings → Pages → Build and deployment → Source 选 **GitHub Actions**；
4. 手动触发一次「同步 Bitget 数据」工作流；GitHub 自带计划任务每 20 分钟兜底同步。

## 5 分钟快速刷新（Cloudflare Workers，免费）

`scheduler/worker.mjs` 每 5 分钟只调用一次 GitHub 的 `workflow_dispatch`：快速运行会直接发布最新快照，每小时其中一次才提交长期归档。浏览器每分钟只读取很小的 `data/version.json`，确认版本变化后才下载完整数据。通常从 Bitget 变化到页面可见约 3～6 分钟；GitHub/Cloudflare 排队时可能更久。

Cloudflare 只保存一个名为 `GITHUB_ACTIONS_TOKEN` 的 Secret。它应使用 GitHub fine-grained token，并严格限定为：

- 仅仓库 `du3162417185-wq/bitget-journal`；
- Repository permissions 只开启 `Actions: Read and write`；
- 设置到期时间，绝不写入仓库、日志或网页。

Bitget 的三项凭据仍然只在 GitHub Secrets 中，**不会交给 Cloudflare**。免费额度下每天约 288 次 Cron 调用、GitHub 公共仓库 Actions 与 Pages 均为 0 元。

> 若 Actions 服务器访问 Bitget 受阻（同步工作流报错），改用本地同步：
> 双击 `sync-and-push.bat`（需代理已启动），或用任务计划程序每 20 分钟执行一次。

## 写作者复盘

双击 `点评.bat`。工具只监听 `127.0.0.1:8931`，启动时同步 GitHub 上的最新交易；选择一笔平仓、填写复盘并保存后，只提交 `data/reviews.json` 并推送。访客只能在主站读取复盘，不能通过网站写入。

若项目有未提交改动、当前不在 `main`、网络不可用或发生 Git 冲突，工具会停止并显示原因，不会覆盖代码。`admin.html` 只供本机工具使用，不会进入 GitHub Pages 发布目录。

## 安全说明

- API 密钥为**只读**权限：无交易、无提现能力；
- 密钥只存在本地 `.env` 与 GitHub Secrets 中，页面与仓库中不出现任何密钥；
- Cloudflare 调度令牌只允许触发本仓库 Actions，不能读取 Bitget 密钥或操作交易；
- Actions 全部固定到完整 commit SHA，依赖安装禁用生命周期脚本，checkout 不持久保存写令牌；
- 若怀疑密钥泄露，随时到 Bitget 后台删除该 API 即可，不影响账户资金。
