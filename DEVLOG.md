# 开发与运维日志（DEVLOG）

> 本文件按时间线记录本项目从 0 到上线的全过程：每一步做了什么、遇到什么问题、怎么解决的。
> 密钥等敏感值一律不写入本文件（只存于 `.env` 与 GitHub Secrets）。

---

## 2026-08-23（Day 1：从需求到上线）

### 1. 需求确认
- 用户在 X 发帖承诺"三年之约"（2026–2029，2.7万→100万），要一个公开的实盘交易记录网站发在帖子下面，要求展示：总权益、当前持仓、历史持仓、历史平仓盈亏、历史委托，数据可信（防篡改、非手工）。
- 用户提供 Bitget 只读 API 三要素（API Key 截图识别 + 文本口令），权限：统一账户交易只读 / C2C 只读 / 统一账户管理只读。
- 用户规则：**项目一律放 D 盘**，最终落在 `D:\bitget-journal`。

### 2. 环境侦察
- 已有：Node v22、git、Python 3.11；缺失：gh CLI（后补装）。
- **问题**：直连 `api.bitget.com` SSL 握手失败（exit 35，典型的 SNI 阻断）。
- **解决**：扫描常见本地代理端口，发现 Clash Verge 的 `127.0.0.1:7897` 可用 → 之后所有本机访问 Bitget/GitHub 都走它。

### 3. API 接口踩坑（本项目最大的坑）
- 第一版脚本按 Bitget v2 经典接口写 → 全部报 `40085 您处于统一账户模式，暂不支持调用经典账户接口`。
- 查官方文档确认：该账户是 **UTA（统一交易账户），必须用 v3 接口**（`/api/v3/...`），分页从 `idLessThan` 改为 `cursor` 游标。
- 探测 8 个 v3 端点全部打通：settings / account/assets / funding-assets / current-position / history-position / unfilled-orders / fills / history-orders。
- 首次签名一次通过（说明截图识别的 Secret 正确，两行拼接 63 字符）。
- 重要发现：`position/history-position` 只保留约 90 天 → 这成为后来"归档合并制"的直接原因。

### 4. 构建网站（本地）
- `scripts/fetch.mjs`：签名、cursor 分页、限速 sleep、统计计算（曲线/每日/胜率/手续费/资金费）。
- 前端三件套 `index.html + style.css + app.js`：纯静态零依赖、深色交易风、7 个标签页、手写 SVG 折线/柱状图、表格筛选、CSV 导出、5 分钟自动刷新。
- 本地验证：python http.server 起本地服务，用浏览器自动化读 DOM 快照确认渲染（截图功能在环境中受限，以 DOM 树验证为准）。

### 5. 部署上线（GitHub Pages）
- winget 静默安装 gh CLI → 在用户桌面弹出设备授权窗口 → 后台轮询检测登录成功（账号 `du3162417185-wq`）。
- `gh repo create` 建公开仓库；**git push 直连失败（github.com 被墙）→ 挂 7897 代理解决**。
- 配置 3 个 Actions Secrets；`POST /pages` 启用 Pages（build_type=workflow）。
- **坑 A**：第一次 deploy 失败——`configure-pages` 在 Pages 启用完成前执行。修复：加 `enablement: true`。
- **坑 B**：同步工作流推送的数据提交不触发 deploy 工作流——这是 GitHub 的防递归设计（**GITHUB_TOKEN 的 push 不触发其他工作流**）。修复：sync.yml 内置完整的 Pages 部署三步（configure → upload → deploy）。
- **坑 C**：Pages CDN 对 data.json 有 ~10 分钟缓存。修复：前端 fetch 时带 `?t=时间戳` 穿透。
- 23:37 全链路验证通过，网站正式可用。

---

## 2026-08-24（Day 2：全量历史 + 四连问）

### 1. "90 天后老记录会不会丢？"——会，所以重写了核心
- 用户的理解是"每笔都会留存"；原实现是**覆盖式**（每次同步用 API 最新 90 天窗口整体替换 data.json），90 天后老记录确实会消失、曲线会缩水。
- **重写为归档合并制**：
  - 平仓按 `symbol+方向+平仓秒` 去重合并；委托按 `orderId`；
  - 成交用**多重集**算法（键=`symbol|秒|价|量`，同键多笔取各源最大计数）——解决"同一毫秒同价同量多笔成交"的去重难题；
  - 源优先级：旧归档 < CSV 导入 < API（后源覆盖，保证带 execPnl 的 API 版本胜出）；
  - **`data/data.json` 从此是归档本体，永不删除**。

### 2. rMCD"消失"事件
- 用户反馈资产明细看不到 rMCD。排查：本地与线上数据**一直都有**（5.62 枚 ≈ $1,523，第二大资产）。用户看的应是已停止的本地预览缓存页。
- 顺手改进：资产表按 USD 价值降序，rMCD 稳定在第一行。

### 3. 导入经典账户历史（5 个官方导出文件）
- 源：`E:\OneDrive\Desktop\bitget\`：成交明细 CSV（03-06月，含每笔已实现盈亏）、历史仓位 CSV（02-06月）、委托 CSV（06-07月，含现货）、成交 CSV（06-07月）、充提记录 XLS（真 OLE2 二进制，用 Python xlrd 读取）。
- **坑 D**：经典导出 CSV 手续费是**负数**（-0.03 式），UTA API 是正数 → 直接累加导致手续费从 98 假跌到 46。修复：导入时统一 `abs`。
- **坑 E**：合并优先级首版写反，CSV 版（无 execPnl）覆盖 API 版 → 缺口归集的盈亏算错。修复：后源优先。
- **缺口归集**：CSV 平仓止于 06-04、API 平仓始于 06-25，中间 7 组平仓由成交明细的平仓方向+execPnl 按"币种+方向+自然日"归集，页面标「归集」徽章，口径透明。
- 新增**充提记录页**：20 笔，txid 链接 etherscan 可验证——证明无外部注资，是信任叙事的关键一环。
- 结果：平仓 88 笔（54 导入+27 API+7 归集），全量净已实现盈亏 **+1,801.03U**（此前只有 +597），胜率 56.8%。

### 4. Git 协作坑
- **坑 F**：自动同步每 20 分钟产生远端提交，本地 push 被拒（non-fast-forward）；首次 `pull --rebase` 又因全局 git 身份未配置而中断，仓库一度游离。
- 修复：仓库级配置 user.name/email；**标准流程固化为 `git pull --rebase -X ours origin main` 后再 push**（-X ours 让数据文件冲突时保留远端版本，反正下次同步会重建）。

### 5. 更名与交接
- 应用户要求全站"西西弗斯"→"Successful西西弗斯"（index.html ×4、app.js 注释、README）。
- 产出 `HANDOFF.md`（交接总档）、`DEVLOG.md`（本文件）、`FILES.md`（万物详解）。
- 上线体检：数据新鲜度 8 分钟、工作流全绿、零错误、净值快照开始生长。

---

## 附：本项目全部已解决的坑（速查）

| # | 坑 | 解决 |
|---|---|---|
| 1 | 直连 Bitget/GitHub 被墙 | 本机统一走 Clash 代理 7897 |
| 2 | UTA 账户 v2 接口全废 | 全部改用 v3（cursor 分页） |
| 3 | 平仓 API 仅 90 天 | 归档合并制，永不丢数据 |
| 4 | configure-pages 时序失败 | enablement: true |
| 5 | GITHUB_TOKEN push 不触发工作流 | sync.yml 内置部署步骤 |
| 6 | CDN 缓存 data.json | 前端 ?t= 穿透 |
| 7 | 经典 CSV 手续费负数 | 导入时 abs |
| 8 | 合并源优先级反了 | 后源（API）覆盖 |
| 9 | 同毫秒同价同量多笔成交 | 多重集去重（按源取最大计数） |
| 10 | rebase 身份缺失/远端新提交 | 仓库级身份 + `pull --rebase -X ours` |

## 附：尚未发生但要有预案的事
- **国内大规模打不开 github.io** → 迁 Cloudflare Pages（同步机制不变，改域名）。
- **Bitget 密钥泄露怀疑** → 后台删旧建新，更新 .env + 3 个 Secrets。
- **用户升级/更换 Bitget 账户体系** → 重新核对 v3 端点字段是否变动。
- **data.json 无限增长** → 目前 ~1MB/年 级别，几年内无需处理；真大了可做按年分片。
