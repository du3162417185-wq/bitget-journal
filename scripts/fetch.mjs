#!/usr/bin/env node
/**
 * Bitget 统一账户（UTA）v3 只读 API 数据同步
 * 拉取：账户资产 / 当前持仓 / 历史平仓 / 当前挂单 / 历史委托 / 成交明细 / 行情
 * 输出：data/data.json（网站读取）、data/equity-history.json（长期净值曲线）
 *
 * 密钥来源：环境变量或项目根目录 .env（.gitignore 已排除，绝不进入仓库）
 */
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------------- 配置 ---------------- */
try {
  const txt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* 无 .env 则走环境变量 */ }

const KEY = process.env.BITGET_KEY;
const SECRET = process.env.BITGET_SECRET;
const PASS = process.env.BITGET_PASSPHRASE;
const PROXY = process.env.BITGET_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';

if (!KEY || !SECRET || !PASS) {
  console.error('[sync] 缺少 BITGET_KEY / BITGET_SECRET / BITGET_PASSPHRASE');
  process.exit(1);
}

/* ---------------- HTTP（可选代理） ---------------- */
let fetchImpl = globalThis.fetch;
if (PROXY) {
  try {
    const { ProxyAgent, fetch: uFetch } = await import('undici');
    const agent = new ProxyAgent(PROXY);
    fetchImpl = (url, opts = {}) => uFetch(url, { ...opts, dispatcher: agent });
    console.log('[sync] 使用代理:', PROXY);
  } catch (e) {
    console.error('[sync] 代理初始化失败（先 npm install）:', e.message);
    process.exit(1);
  }
}

const BASE = 'https://api.bitget.com';
const log = (...a) => console.log('[sync]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const round = (n, dp = 4) => { const p = 10 ** dp; return Math.round(n * p) / p; };

/* ---------------- 签名与请求 ---------------- */
const sign = (ts, method, reqPath, body = '') =>
  createHmac('sha256', SECRET).update(ts + method + reqPath + body).digest('base64');

async function get(reqPath) {
  const ts = Date.now().toString();
  const res = await fetchImpl(BASE + reqPath, {
    headers: {
      'ACCESS-KEY': KEY,
      'ACCESS-SIGN': sign(ts, 'GET', reqPath),
      'ACCESS-TIMESTAMP': ts,
      'ACCESS-PASSPHRASE': PASS,
      'Content-Type': 'application/json',
      locale: 'zh-CN',
    },
  });
  let j;
  try { j = await res.json(); }
  catch { throw new Error(`${reqPath} → HTTP ${res.status}（非 JSON，可能被网络拦截）`); }
  if (j.code !== '00000') {
    const err = new Error(`${reqPath} → ${j.code} ${j.msg || ''}`);
    err.apiCode = j.code;
    throw err;
  }
  return j.data;
}

const toList = (d) => (Array.isArray(d) ? d : d?.list || d?.rows || []);

/* ---------------- 分页（v3 cursor 游标） ---------------- */
async function getAll(basePath, extra = {}, maxPages = 100) {
  const base = new URLSearchParams(extra);
  let cursor = null;
  let prevFirst = null;
  const out = [];
  for (let i = 0; i < maxPages; i++) {
    const qs = new URLSearchParams(base);
    qs.set('limit', '100');
    if (cursor) qs.set('cursor', cursor);
    let d;
    try { d = await get(`${basePath}?${qs.toString()}`); }
    catch (e) {
      if (i === 0) throw e;
      errors.push(e.message);
      break;
    }
    const list = toList(d);
    if (!list.length) break;
    const first = list[0].execId ?? list[0].orderId ?? list[0].positionId ?? JSON.stringify(list[0]).slice(0, 64);
    if (first === prevFirst) break; // 游标未被识别导致重复页，防御性终止
    prevFirst = first;
    out.push(...list);
    const nc = d?.cursor;
    if (!nc || nc === cursor) break;
    cursor = nc;
    await sleep(150);
  }
  return out;
}

/* ---------------- 主流程 ---------------- */
const PT = 'USDT-FUTURES';
const data = {
  meta: { generatedAt: new Date().toISOString(), generatedAtMs: Date.now(), errors: [] },
  settings: null,
  accountAssets: null,
  fundingAssets: null,
  positions: [],
  openOrders: [],
  historyPositions: [],
  fills: [],
  orders: [],
  spotFills: [],
  tickers: {},
  stats: {},
  equityHistory: [],
};

async function main() {
  /* 账户设置（展示统一账户信息） */
  try { data.settings = await get('/api/v3/account/settings'); } catch (e) { errors.push('settings: ' + e.message); }

  /* 统一账户资产（总权益主线） */
  try { data.accountAssets = await get('/api/v3/account/assets'); } catch (e) { errors.push('assets: ' + e.message); }

  /* 资金账户资产（如有理财/资金余额） */
  try { data.fundingAssets = await get('/api/v3/account/funding-assets'); } catch { /* 尽力而为 */ }

  /* 当前持仓（全品类，取不到再退回 USDT 合约） */
  try {
    data.positions = toList(await tryGetPaths([
      '/api/v3/position/current-position',
      `/api/v3/position/current-position?category=${PT}`,
    ]));
  } catch (e) { errors.push('positions: ' + e.message); }
  log('当前持仓:', data.positions.length);

  /* 当前挂单 */
  try {
    data.openOrders = await getAll('/api/v3/trade/unfilled-orders', { category: PT });
  } catch (e) { errors.push('openOrders: ' + e.message); }
  log('当前挂单:', data.openOrders.length);

  /* 历史平仓（盈亏主线，API 保留近 90 天） */
  try {
    data.historyPositions = await getAll('/api/v3/position/history-position', { category: PT });
  } catch (e) { errors.push('historyPositions: ' + e.message); }
  log('历史平仓:', data.historyPositions.length);

  /* 成交明细 / 历史委托 */
  try { data.fills = await getAll('/api/v3/trade/fills', { category: PT }); } catch (e) { errors.push('fills: ' + e.message); }
  try { data.orders = await getAll('/api/v3/trade/history-orders', { category: PT }); } catch (e) { errors.push('orders: ' + e.message); }
  log('成交明细:', data.fills.length, '· 历史委托:', data.orders.length);

  /* 现货成交（如有） */
  try { data.spotFills = await getAll('/api/v3/trade/fills', { category: 'SPOT' }, 40); } catch { /* 无现货 */ }

  /* 行情价（公开接口，用于展示标记价） */
  try {
    const tks = toList(await get(`/api/v3/market/tickers?category=${PT}`));
    for (const t of tks) data.tickers[t.symbol] = { lastPr: t.lastPr, bidPr: t.bidPr, askPr: t.askPr };
  } catch (e) { errors.push('tickers: ' + e.message); }

  /* ---------------- 统计 ---------------- */
  const closes = data.historyPositions
    .map((p) => {
      const fee = -(Number(p.openFeeTotal || 0) + Number(p.closeFeeTotal || 0));
      return {
        t: Number(p.updatedTime || p.createdTime || 0),
        net: Number(p.netProfit ?? 0),                 // 净利润（含手续费/资金费）
        pnl: Number(p.cumRealisedPnl ?? 0),            // 毛盈亏
        fee,
        funding: Number(p.totalFunding || 0),
      };
    })
    .filter((c) => c.t > 0)
    .sort((a, b) => a.t - b.t);

  let cum = 0;
  const curve = closes.map((c) => { cum += c.net; return { t: c.t, cum: round(cum, 2) }; });

  const dayMap = new Map();
  for (const c of closes) {
    const day = new Date(c.t).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    dayMap.set(day, round((dayMap.get(day) || 0) + c.net, 2));
  }
  const daily = [...dayMap.entries()].map(([d, pnl]) => ({ d, pnl })).sort((a, b) => a.d.localeCompare(b.d));

  const fees = round(data.fills.reduce((s, f) => s + sumFee(f.feeDetail), 0), 2);
  const usdtEquity = round(Number(data.accountAssets?.usdtEquity ?? data.accountAssets?.accountEquity ?? 0), 2);

  /* 权益快照（长期净值曲线，逐次追加） */
  const eqFile = path.join(DATA_DIR, 'equity-history.json');
  let eqHist = [];
  try { eqHist = JSON.parse(fs.readFileSync(eqFile, 'utf8')); } catch { /* 首次 */ }
  if (!eqHist.length || Date.now() - eqHist[eqHist.length - 1].t > 5 * 60 * 1000) {
    eqHist.push({ t: Date.now(), equity: usdtEquity });
    if (eqHist.length > 5000) eqHist = eqHist.slice(-5000);
    fs.writeFileSync(eqFile, JSON.stringify(eqHist));
  }
  data.equityHistory = eqHist;

  data.stats = {
    usdtEquity,
    accountEquity: data.accountAssets ? round(Number(data.accountAssets.accountEquity || 0), 2) : null,
    unrealisedPnl: data.accountAssets ? round(Number(data.accountAssets.unrealisedPnl ?? data.accountAssets.usdtUnrealisedPnl ?? 0), 2) : null,
    realizedPnl: round(cum, 2),
    closesCount: closes.length,
    winRate: closes.length ? round((closes.filter((c) => c.net > 0).length / closes.length) * 100, 1) : null,
    fees,
    funding: round(closes.reduce((s, c) => s + c.funding, 0), 2),
    curve,
    daily,
    firstCloseAt: closes.length ? closes[0].t : null,
  };
  data.meta.errors = errors;

  fs.writeFileSync(path.join(DATA_DIR, 'data.json'), JSON.stringify(data));
  log(
    `完成：权益≈${usdtEquity} USDT · 净已实现盈亏 ${data.stats.realizedPnl} · 平仓 ${closes.length} 笔 · 手续费 ${fees}`
  );
  if (errors.length) log('警告', errors.length, '条:', errors.slice(0, 3).join(' | '));
}

function sumFee(feeDetail) {
  if (Array.isArray(feeDetail)) return feeDetail.reduce((s, f) => s + Number(f.fee || 0), 0);
  return Number(feeDetail || 0);
}

async function tryGetPaths(paths) {
  let lastErr;
  for (const p of paths) {
    try { return await get(p); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

main().catch((e) => {
  console.error('[sync] 失败:', e.message);
  if (e.apiCode === '40101' || e.apiCode === '40001') {
    console.error('签名/密钥校验失败：请确认 API Key、Secret、Passphrase 完整。');
  }
  process.exit(1);
});
