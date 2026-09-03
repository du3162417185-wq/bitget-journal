# 万物详解（FILES.md）

> 本文件把项目里**每一个文件、每一类数据字段、每一个自动化步骤**都讲清楚。
> 配套阅读：`HANDOFF.md`（交接总档）、`DEVLOG.md`（开发日志）。

---

## 一、文件总览

```
D:\bitget-journal\
├─ index.html            公开网页骨架
├─ style.css             全部样式（深色主题）
├─ app.js                全部前端逻辑（渲染/图表/筛选/导出）
├─ admin.html            本机作者复盘编辑器（不部署到 Pages）
├─ data\
│  ├─ data.json          ★ 全量数据 + 归档本体（网站唯一数据源）
│  ├─ version.json       小型版本清单（前端轮询探针）
│  ├─ equity-history.json  权益快照序列（净值曲线原料，追加式）
│  ├─ import-history.json  经典账户导入数据（静态，由脚本生成）
│  └─ reviews.json       作者复盘（平仓唯一键 → 正文/时间）
├─ scripts\
│  ├─ fetch.mjs          同步脚本：API 抓取 + 归档合并 + 统计
│  ├─ import-history.mjs 导入工具：解析 5 个官方导出文件 → import-history.json
│  ├─ review-server.mjs  本机复盘服务：同步→校验→保存→commit→push
│  └─ verify.mjs         项目静态自检（不联网、不改数据）
├─ .github\workflows\
│  ├─ sync.yml           定时同步+部署（核心自动化）
│  └─ deploy.yml         手动改页面时的部署
├─ scheduler\
│  ├─ worker.mjs         Cloudflare Cron → 固定 GitHub 工作流触发器
│  └─ wrangler.toml      Worker 名称与 5 分钟 cron（无密钥）
├─ .env                  ★ 密钥（永不入库，已 gitignore）
├─ .gitignore            排除 .env / node_modules
├─ .gitattributes        统一 LF 换行
├─ sync-and-push.bat     Windows 双击手动同步
├─ 点评.bat              Windows 双击打开作者复盘编辑器
├─ package.json          Node 依赖声明（仅 undici）
├─ README.md             项目简介 + 部署说明
├─ HANDOFF.md            交接总档
├─ DEVLOG.md             开发运维日志（时间线）
└─ FILES.md              本文件
```

外部关联（不在项目目录内）：
- 导出文件源：`E:\OneDrive\Desktop\bitget\`（5 个 Bitget 后台导出文件）
- GitHub 仓库：`du3162417185-wq/bitget-journal`（公开）→ Pages 线上站
- GitHub Secrets：`BITGET_KEY` / `BITGET_SECRET` / `BITGET_PASSPHRASE`（服务器端密钥）
- Cloudflare Worker Secret：`GITHUB_ACTIONS_TOKEN`（仅本仓库 Actions 读写；不能读取 GitHub Secrets）

---

## 二、前端三件套（改页面看这里）

### index.html —— 骨架
- `<head>`：标题、favicon（🪨 emoji 内联 SVG，无图片文件）、meta。
- 头部横幅：站名 h1、副标题（"三年之约：2.7w → 100w（2026–2029）…"）、绿色"只读 API 自动同步"徽章 + 更新时间（id=`syncTime`）。
- 顶部粘性导航（id=`tabs`）：7 个按钮 `data-tab` = overview / positions / closes / fills / orders / transfers / about，对应 7 个 `<section class="panel">`。
- 关键 DOM id（app.js 全靠这些挂载）：
  - 总览：`cards`、`curveChart`、`dailyChart`、`recentCloses`、`curveTabs`、`dailyTabs`
  - 持仓页：`positionsTable`、`openOrdersTable`、`assetsTable`、`fundingTable`、`posCount`、`ooCount`、`posEmpty`、`ooEmpty`
  - 其他页：`closesTable/closesCount/closesFilter`、`fillsTable/fillsCount/fillsFilter`、`ordersTable/ordersCount/ordersFilter`、`transfersTable/transfersCount`
  - 复盘弹层：`reviewModal`、`rvSym`、`rvMeta`、`rvBody`、`rvClose`
  - 页脚：`repoLink`（配合 `window.REPO_URL` 可开）
- 想改文案（如汇率提示、关于页故事）：直接改 HTML 里对应文字。

### style.css —— 样式
- 主题变量全在 `:root`：`--bg #0b0e11`（背景）、`--panel #14181d`（卡片）、`--up #2ebd85`（绿涨）、`--down #f6465d`（红跌）、`--accent #f7c945`（金色强调）、`--blue #4da3ff`（链接）。
- **换配色只改 :root 变量**即可全站生效；红涨绿跌偏好 = 交换 --up/--down 的值。
- 响应式断点 760px（双栏图表并一栏）；表格在窄屏横向滚动。

### app.js —— 逻辑
- 入口 `load()`：并行读取 `data/data.json` 与 `data/reviews.json`（用版本号穿透缓存）→ `prepare()`（合并排序）→ `renderAll()`。
- `checkForUpdate()`：每分钟只读取很小的 `data/version.json`；`generatedAtMs` 变大才调用 `load()`。页面切回前台/窗口重新聚焦时也立即检查；版本探针不可用时最多每 5 分钟回退一次完整加载；`loadPromise` 防止并发重复下载。
- 渲染函数：
  - `renderOverview()`：6 张指标卡；净已实现盈亏支持近 30/60/90 天和交易至今切换
  - `renderCharts()`：累计盈亏 SVG 折线 + 每日盈亏柱；两个图联动切换区间，折线按所选区间重新从 0 累计，支持指针悬浮/触摸提示和 5 个时间刻度
  - `renderRecentCloses()`：最近 10 笔平仓，含开仓时间与作者复盘入口
  - `renderPositions()`：当前持仓表（杠杆/标记价/强平价/收益率）+ 挂单表 + **统一账户资产表（按 USD 降序）** + 资金账户表
  - `renderCloses()/renderFills()/renderOrders()/renderTransfers()`：四个历史表，支持币种筛选（输入框 input 事件重渲染）
- 汉化映射：`SIDE`（long→多）、`TRADE_SIDE`（open_long→开多…）、`ORDER_STATUS`（filled→已成交…）。
- `exportCSV(kind)`：当前表导出带 BOM 的 CSV（Excel 中文不乱码）。
- `rvKey()/openReview()/rvBadge()`：按平仓唯一键关联公开复盘，弹层正文先 HTML 转义再保留换行；平仓 CSV 也附复盘列。
- 数字与时间：千分位、红绿着色、时间全部按 `Asia/Shanghai` 显示。

---

## 三、data/data.json 字段详解（数据结构圣经）

| 顶层键 | 内容 | 来源 |
|---|---|---|
| meta | generatedAt(Ms) 生成时间、family 接口族、errors 非致命错误列表 | fetch 生成 |
| settings | uid、accountMode=unified、holdMode 等账户设置 | API |
| accountAssets | **总权益主线**：accountEquity 账户权益、usdtEquity、unrealisedPnl、assets[] 各币种明细 | API |
| fundingAssets | 资金账户（现货/理财）各币余额 | API |
| positions | 当前持仓数组 | API |
| openOrders | 当前挂单 | API |
| historyPositions | **历史平仓（归档合并后）** | API∪导入∪归集∪旧档 |
| fills | **全部成交（归档合并后，含现货）** | 同上 |
| orders | **全部委托（归档合并后）** | 同上 |
| financialRecords | **统一账户资金流水归档**（含资金费真实发生时间） | API∪旧档 |
| transfers | 充提记录（20 笔，含 txid） | 导入 |
| tickers | {symbol: {lastPr,bidPr,askPr}} 行情快照 | API 公开接口 |
| stats | 全部统计指标（见下） | fetch 计算 |
| equityHistory | [{t, equity}] 权益快照序列 | 追加 |

**positions[] 单条字段**：symbol、posSide(long/short)、leverage、total(数量)、avgPrice(开仓均价)、markPrice、positionBalance(保证金)、unrealisedPnl、profitRate(收益率,小数)、curRealisedPnl(本仓已实现)、liquidationPrice(0=无强平价)、marginMode(crossed/isolated)、createdTime。

**historyPositions[] 单条字段**：updatedTime(平仓时间)、createdTime(开仓时间)、openPriceAvg、closePriceAvg、closeTotalPos、cumRealisedPnl(毛盈亏)、**netProfit(净盈亏=毛-手续费±资金费)**、totalFunding(资金费)、openFeeTotal/closeFeeTotal(手续费,负值)、importSource——**三种值：无(API)、csv(经典导入)、gap-synth(缺口归集)**。

**fills[] 单条字段**：createdTime、symbol、category(USDT-FUTURES/SPOT)、tradeSide(open_long/close_long/…)、side(buy/sell)、orderType、execPrice、execQty、execValue、execPnl(平仓成交才有)、**费用两形态：API 版 feeDetail:[{feeCoin,fee}]，导入版 fee+feeCoin**（前端两种都兼容）、importSource。

**financialRecords[] 单条字段**：只公开统计必需的 id、type、symbol、coin、amount、ts。同步脚本先丢弃资金费以外的账户流水以及 balance 等无关字段，再归档最小数据；资金费主要类型为 `CONTRACT_MAIN_SETTLE_FEE_USER_IN/OUT`，按 IN/OUT 规范正负号后在 `ts` 当天入账。

**stats 字段**：usdtEquity、unrealisedPnl、realizedPnl(逐笔时间账本全量净已实现)、closesCount(平/减仓成交次数)、winRate(仍按整仓净盈亏>0)、fees(仅 USDT 计价)、funding、events[{t,net,kind}]、curve[{t,cum}]、daily[{d,pnl}]、firstCloseAt、accounting。`events.kind` 为 close(实际平/减仓)、fee(非平仓成交手续费)、funding(实际资金流水)、legacy-close(无成交明细的早期整仓兜底)、legacy-funding(90天资金流水窗口前的补录)。

### data/reviews.json

顶层对象的 key 为 `symbol|posSide|floor(updatedTime/1000)`，与 `fetch.mjs` 的 `posKey` 相同。value 为 `{text, time, symbol}`：正文最多 5000 字，time 是作者保存时的毫秒时间戳。空对象 `{}` 表示尚无公开复盘。禁止手工制造找不到平仓记录的 key；`npm run verify` 会检查孤儿记录和重复平仓键。

---

## 四、脚本详解

### scripts/fetch.mjs（核心，每次同步做什么）
1. 读 `.env`/环境变量 → 有代理则用 undici ProxyAgent 包装 fetch；
2. 依次拉 API：settings → account/assets → funding-assets → current-position → unfilled-orders → history-position / fills(合约+现货) / history-orders（cursor 分页）→ financial-records（3×30天窗口）→ tickers；
3. **归档合并**（详见 HANDOFF 第 5 节）：旧 data.json + import-history.json + 本次 API → 平仓、成交、委托、资金流水分别去重合并；缺口归集；
4. 统计：以每次平/减仓 `execPnl`、每笔合约手续费和真实资金费流水构建 `events` 时间账本 → curve/daily/区间净盈亏；整仓历史只继续用于复盘和整仓胜率；
5. equity-history.json 追加一点（本次工作目录距上一归档>5 分钟才记；快速快照不一定提交仓库）；
6. 先写 data/data.json，最后写同版本的 data/version.json。**注意：版本文件最后写，确保前端发现新版本时完整数据已经就绪。**

### scripts/import-history.mjs（导入工具）
- 输入 5 个文件（路径常量 `FILES`，可用 `BITGET_EXPORT_DIR` 环境变量改目录）：
  1. `导出 U 本位合约成交明细-*.csv` → 早期成交（含每笔已实现盈亏）
  2. `导出 U 本位合约历史仓位-*.csv` → 平仓主源（`BZUSDT Long·Isolated` 格式解析方向与仓位模式；`0.59BZ` 解析数量；净盈亏取"仓位盈亏"列）
  3. `20260731_112243_1.csv` → 委托（状态 full fill→filled / cancelled→canceled）
  4. `20260731_112243_2.csv` → 晚期成交（手续费 `0.13USDT` 格式解析出数值+币种）
  5. `导出充提记录-*.xls` → 调 Python xlrd 转 JSON（`python -X utf8` 防 GBK 乱码）
- 已处理的坑：负数手续费取 abs、UTC+8 时间转毫秒、订单号 `\t` 前缀清洗、`rMSTR/USDT`→`rMSTRUSDT`、UTF-8 BOM 剥离。
- 产物 `data/import-history.json` 是**静态**的：生成后 fetch 每次同步自动并入，不需要重跑。

### sync-and-push.bat
读 .env → `npm run sync` → 有变化则 git commit（时间戳消息）+ push（走系统代理）。

### scripts/review-server.mjs + admin.html + 点评.bat
双击批处理后，本机服务只监听 `127.0.0.1:8931`。启动及保存前都要求当前在 `main`、工作区干净，并先 `pull --rebase` 获取最新交易；保存时复核 key、只暂存 `data/reviews.json`、提交并推送。若保存期间恰逢定时同步造成 non-fast-forward，会同步后重试一次；rebase 失败会自动 abort 并明确报错。编辑器支持全部平仓搜索、未保存切换提醒、删除确认和手动同步按钮。

### scripts/verify.mjs
读取现有 JSON、前端、工作流与调度器，检查归档结构、版本一致性、平仓键唯一性、复盘关联/长度/时间、遗留测试复盘、增量刷新、固定 Action SHA 和调度器密钥边界。只读运行：`npm run verify`。

---

## 五、GitHub Actions 工作流逐步说明

### sync.yml（Cloudflare 5 分钟触发；GitHub cron `*/20 * * * *` 兜底）
checkout（不持久保存凭据）→ 装 Node 20 → `npm ci --ignore-scripts` → `node scripts/fetch.mjs`（Bitget 密钥只来自 GitHub Secrets）→ 按 `persist` 决定是否 commit：Cloudflare 每小时一次 `true`，其余快速运行 `false`；GitHub 原生 cron 和手动默认 `true` → 无论是否提交，都在同一运行内整理 `_site` 并部署本次最新快照。归档提交步骤才短暂注入 GitHub 写令牌。

### scheduler（Cloudflare Workers Cron）
cron `2-59/5 * * * *`，避开整点高峰，每小时 2/7/12…57 分触发。Worker 只向固定仓库、固定 `sync.yml`、固定 `main` 发 `workflow_dispatch`；UTC 每小时 17 分那次传 `persist=true`，其余传 `false`。仓库源码不含 token，实际值只存 Cloudflare Secret。Worker 不接收 HTTP 请求、不调用 Bitget、不读取交易数据。

### deploy.yml（手动 push 触发）
main 分支任何 push 都触发 → 整理 `_site` → 发布 Pages。`_site` 只含公开前端、`data/*.json` 与 README/HANDOFF/DEVLOG/FILES；本机编辑器和开发脚本不会部署。

---

## 六、常见修改速查表

| 想做什么 | 改哪里 |
|---|---|
| 改站名/文案 | index.html（h1、title、关于页、页脚） |
| 换配色 | style.css 的 `:root` 变量 |
| 改人民币估算汇率(7.2) | app.js 里 `cny()` 函数 |
| 改浏览器检查频率 | app.js 末尾 `setInterval(checkForUpdate, 60*1000)` |
| 改快速同步频率 | scheduler/wrangler.toml 的 cron（UTC） |
| 改 GitHub 兜底频率 | sync.yml 的 cron（UTC） |
| 加/改标签页 | index.html 加 button+section，app.js 加渲染函数 |
| 导入新导出文件 | import-history.mjs 的 FILES → 重跑 → 推送 |
| 写/修改作者复盘 | 保证 main 工作区干净 → 双击 点评.bat |
| 项目静态自检 | `npm run verify` |
| 改"关于本站"叙述 | index.html 的 tab-about 段落 |

改完任何前端文件：`git add -A && git commit -m "..."` → `git -c http.proxy=http://127.0.0.1:7897 pull --rebase -X ours origin main` → `git -c http.proxy=http://127.0.0.1:7897 push`，1~2 分钟后线上生效。
