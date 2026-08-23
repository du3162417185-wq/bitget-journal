# 万物详解（FILES.md）

> 本文件把项目里**每一个文件、每一类数据字段、每一个自动化步骤**都讲清楚。
> 配套阅读：`HANDOFF.md`（交接总档）、`DEVLOG.md`（开发日志）。

---

## 一、文件总览

```
D:\bitget-journal\
├─ index.html            网页骨架（唯一的页面）
├─ style.css             全部样式（深色主题）
├─ app.js                全部前端逻辑（渲染/图表/筛选/导出）
├─ data\
│  ├─ data.json          ★ 全量数据 + 归档本体（网站唯一数据源）
│  ├─ equity-history.json  权益快照序列（净值曲线原料，追加式）
│  └─ import-history.json  经典账户导入数据（静态，由脚本生成）
├─ scripts\
│  ├─ fetch.mjs          同步脚本：API 抓取 + 归档合并 + 统计（Actions 每 20 分钟跑）
│  └─ import-history.mjs 导入工具：解析 5 个官方导出文件 → import-history.json
├─ .github\workflows\
│  ├─ sync.yml           定时同步+部署（核心自动化）
│  └─ deploy.yml         手动改页面时的部署
├─ .env                  ★ 密钥（永不入库，已 gitignore）
├─ .gitignore            排除 .env / node_modules
├─ .gitattributes        统一 LF 换行
├─ sync-and-push.bat     Windows 双击手动同步
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

---

## 二、前端三件套（改页面看这里）

### index.html —— 骨架
- `<head>`：标题、favicon（🪨 emoji 内联 SVG，无图片文件）、meta。
- 头部横幅：站名 h1、副标题（"三年之约：2.7w → 100w（2026–2029）…"）、绿色"只读 API 自动同步"徽章 + 更新时间（id=`syncTime`）。
- 顶部粘性导航（id=`tabs`）：7 个按钮 `data-tab` = overview / positions / closes / fills / orders / transfers / about，对应 7 个 `<section class="panel">`。
- 关键 DOM id（app.js 全靠这些挂载）：
  - 总览：`cards`、`curveChart`、`dailyChart`、`recentCloses`
  - 持仓页：`positionsTable`、`openOrdersTable`、`assetsTable`、`fundingTable`、`posCount`、`ooCount`、`posEmpty`、`ooEmpty`
  - 其他页：`closesTable/closesCount/closesFilter`、`fillsTable/fillsCount/fillsFilter`、`ordersTable/ordersCount/ordersFilter`、`transfersTable/transfersCount`
  - 页脚：`repoLink`（配合 `window.REPO_URL` 可开）
- 想改文案（如汇率提示、关于页故事）：直接改 HTML 里对应文字。

### style.css —— 样式
- 主题变量全在 `:root`：`--bg #0b0e11`（背景）、`--panel #14181d`（卡片）、`--up #2ebd85`（绿涨）、`--down #f6465d`（红跌）、`--accent #f7c945`（金色强调）、`--blue #4da3ff`（链接）。
- **换配色只改 :root 变量**即可全站生效；红涨绿跌偏好 = 交换 --up/--down 的值。
- 响应式断点 760px（双栏图表并一栏）；表格在窄屏横向滚动。

### app.js —— 逻辑
- 入口 `load()`：`fetch('data/data.json?t='+Date.now())`（缓存穿透）→ `prepare()`（合并排序）→ `renderAll()`；每 5 分钟自动重跑。
- 渲染函数：
  - `renderOverview()`：6 张指标卡 + `lineChart()`（累计盈亏 SVG 折线）+ `barChart()`（每日盈亏柱）+ 最近 10 笔平仓
  - `renderPositions()`：当前持仓表（杠杆/标记价/强平价/收益率）+ 挂单表 + **统一账户资产表（按 USD 降序）** + 资金账户表
  - `renderCloses()/renderFills()/renderOrders()/renderTransfers()`：四个历史表，支持币种筛选（输入框 input 事件重渲染）
- 汉化映射：`SIDE`（long→多）、`TRADE_SIDE`（open_long→开多…）、`ORDER_STATUS`（filled→已成交…）。
- `exportCSV(kind)`：当前表导出带 BOM 的 CSV（Excel 中文不乱码）。
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
| transfers | 充提记录（20 笔，含 txid） | 导入 |
| tickers | {symbol: {lastPr,bidPr,askPr}} 行情快照 | API 公开接口 |
| stats | 全部统计指标（见下） | fetch 计算 |
| equityHistory | [{t, equity}] 权益快照序列 | 追加 |

**positions[] 单条字段**：symbol、posSide(long/short)、leverage、total(数量)、avgPrice(开仓均价)、markPrice、positionBalance(保证金)、unrealisedPnl、profitRate(收益率,小数)、curRealisedPnl(本仓已实现)、liquidationPrice(0=无强平价)、marginMode(crossed/isolated)、createdTime。

**historyPositions[] 单条字段**：updatedTime(平仓时间)、createdTime(开仓时间)、openPriceAvg、closePriceAvg、closeTotalPos、cumRealisedPnl(毛盈亏)、**netProfit(净盈亏=毛-手续费±资金费)**、totalFunding(资金费)、openFeeTotal/closeFeeTotal(手续费,负值)、importSource——**三种值：无(API)、csv(经典导入)、gap-synth(缺口归集)**。

**fills[] 单条字段**：createdTime、symbol、category(USDT-FUTURES/SPOT)、tradeSide(open_long/close_long/…)、side(buy/sell)、orderType、execPrice、execQty、execValue、execPnl(平仓成交才有)、**费用两形态：API 版 feeDetail:[{feeCoin,fee}]，导入版 fee+feeCoin**（前端两种都兼容）、importSource。

**stats 字段**：usdtEquity、unrealisedPnl、realizedPnl(全量净已实现)、closesCount、winRate(净盈亏>0 占比)、fees(仅 USDT 计价)、funding(已平仓位资金费合计)、curve[{t,cum}]、daily[{d,pnl}]、firstCloseAt。

---

## 四、脚本详解

### scripts/fetch.mjs（核心，每次同步做什么）
1. 读 `.env`/环境变量 → 有代理则用 undici ProxyAgent 包装 fetch；
2. 依次拉 API：settings → account/assets → funding-assets → current-position → unfilled-orders → history-position / fills(合约+现货) / history-orders（cursor 分页，防重复页防御）→ tickers；
3. **归档合并**（详见 HANDOFF 第 5 节）：旧 data.json + import-history.json + 本次 API → 三类去重合并；缺口归集；
4. 统计：全量平仓按时间累计 → curve/daily/胜率/净盈亏；手续费仅计 USDT；
5. equity-history.json 追加一点（间隔>5 分钟才记）；
6. 写 data/data.json。**注意：任何一步失败都保留旧 data.json（站点不挂），错误记入 meta.errors。**

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

---

## 五、GitHub Actions 工作流逐步说明

### sync.yml（每 20 分钟，cron `*/20 * * * *`）
checkout → 装 Node 20 → `npm ci` → `node scripts/fetch.mjs`（密钥来自 Secrets；服务器直连 Bitget，无代理）→ `git add data`，有变化才 commit+push → **同一工作流内**继续：configure-pages(enablement) → upload-pages-artifact → deploy-pages。（为什么部署也在这：GITHUB_TOKEN 的 push 不会触发其他工作流，防止数据更新不发布。）

### deploy.yml（手动 push 触发）
监听 main 分支的 index.html/app.js/style.css/data/** 变化 → 同样的 Pages 部署三步。

---

## 六、常见修改速查表

| 想做什么 | 改哪里 |
|---|---|
| 改站名/文案 | index.html（h1、title、关于页、页脚） |
| 换配色 | style.css 的 `:root` 变量 |
| 改人民币估算汇率(7.2) | app.js 里 `cny()` 函数 |
| 改自动刷新频率 | app.js 末尾 `setInterval(load, 5*60*1000)` |
| 改同步频率 | sync.yml 的 cron（注意是 UTC 时间） |
| 加/改标签页 | index.html 加 button+section，app.js 加渲染函数 |
| 导入新导出文件 | import-history.mjs 的 FILES → 重跑 → 推送 |
| 改"关于本站"叙述 | index.html 的 tab-about 段落 |

改完任何前端文件：`git add -A && git commit -m "..."` → `git -c http.proxy=http://127.0.0.1:7897 pull --rebase -X ours origin main` → `git -c http.proxy=http://127.0.0.1:7897 push`，1~2 分钟后线上生效。
