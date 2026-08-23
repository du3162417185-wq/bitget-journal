#!/usr/bin/env node
/**
 * Bitget 统一账户（UTA）v3 只读 API 数据同步 + 历史归档
 *
 * 关键机制：
 * 1. API 只返回近 90 天，但本脚本每次同步都会与既有归档【合并】而非覆盖——
 *    老记录永久留存，指标（累计盈亏曲线/胜率等）始终基于全量历史计算；
 * 2. data/import-history.json 里的经典账户历史（官方导出文件导入）每次都会并入；
 * 3. 经典账户导出与 API 记录之间的平仓缺口，由成交明细中的平仓盈亏自动归集补全（标记「归集」）。
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
    if (first === prevFirst) break;
    prevFirst = first;
    out.push(...list);
    const nc = d?.cursor;
    if (!nc || nc === cursor) break;
    cursor = nc;
    await sleep(150);
  }
  return out;
}

async function tryGetPaths(paths) {
  let lastErr;
  for (const p of paths) {
    try { return await get(p); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/* ---------------- 归档合并 ---------------- */
const posKey = (p) => `${p.symbol}|${p.posSide || ''}|${Math.floor(Number(p.updatedTime || p.createdTime || 0) / 1000)}`;

function mergePositions(...sources) { // 后面的源优先（同键取最新版本）
  const map = new Map();
  for (const arr of sources) for (const p of arr) map.set(posKey(p), p);
  return [...map.values()];
}

function mergeOrders(...sources) {
  const map = new Map();
  for (const arr of sources) for (const o of arr) if (o.orderId) map.set(String(o.orderId), o);
  return [...map.values()];
}

function mergeFills(...sources) { // 同键多笔（同一订单同一毫秒同价同量的多笔成交）按各源最大计数保留
  const keyOf = (f) => `${f.symbol}|${Math.floor(Number(f.createdTime || 0) / 1000)}|${Number(f.execPrice)}|${Number(f.execQty)}`;
  const final = new Map();
  for (const arr of sources) {
    const local = new Map();
    for (const f of arr) {
      const k = keyOf(f);
      const e = local.get(k);
      if (e) e.n++; else local.set(k, { item: f, n: 1 });
    }
    for (const [k, { item, n }] of local) {
      const prev = final.get(k);
      if (!prev || n >= prev.n) final.set(k, { item, n: Math.max(n, prev?.n || 0) }); // 后源优先（API 覆盖导入）
    }
  }
  const out = [];
  for (const { item, n } of final.values()) for (let i = 0; i < n; i++) out.push(item);
  return out;
}

/* 用成交明细归集 API 平仓窗口之外的平仓记录（经典导出与 API 之间的缺口） */
function synthesizeGapPositions(allFills, knownPositions) {
  const knownDays = new Set(knownPositions.map((p) =>
    `${p.symbol}|${p.posSide}|${new Date(Number(p.updatedTime)).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })}`));
  const apiStart = Math.min(...knownPositions.filter((p) => p.importSource !== 'csv').map((p) => Number(p.updatedTime)).filter(Number.isFinite), Infinity);
  const csvEnd = Math.max(...knownPositions.filter((p) => p.importSource === 'csv').map((p) => Number(p.updatedTime)).filter(Number.isFinite), 0);
  const groups = new Map();
  for (const f of allFills) {
    if (f.category === 'SPOT') continue;
    const t = Number(f.createdTime);
    if (!t || t <= csvEnd || t >= apiStart) continue;
    if (!String(f.tradeSide || '').startsWith('close')) continue;
    const posSide = f.tradeSide.includes('long') ? 'long' : 'short';
    const day = new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const k = `${f.symbol}|${posSide}|${day}`;
    if (knownDays.has(k)) continue;
    const g = groups.get(k) || { symbol: f.symbol, posSide, fills: [] };
    g.fills.push(f);
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => {
    const sorted = [...g.fills].sort((a, b) => Number(a.createdTime) - Number(b.createdTime));
    const pnl = sorted.reduce((s, f) => s + Number(f.execPnl || 0), 0);
    const fee = sorted.reduce((s, f) => s + (Array.isArray(f.feeDetail) ? f.feeDetail.reduce((x, y) => x + Number(y.fee || 0), 0) : Number(f.fee || 0)), 0);
    const qty = sorted.reduce((s, f) => s + Number(f.execQty || 0), 0);
    const vwap = sorted.reduce((s, f) => s + Number(f.execPrice || 0) * Number(f.execQty || 0), 0) / (qty || 1);
    return {
      importSource: 'gap-synth',
      category: 'USDT-FUTURES',
      symbol: g.symbol,
      posSide: g.posSide,
      openPriceAvg: null,
      closePriceAvg: round(vwap, 4),
      closeTotalPos: round(qty, 6),
      cumRealisedPnl: round(pnl, 4),
      netProfit: round(pnl - fee, 4),
      totalFunding: 0,
      openFeeTotal: 0,
      closeFeeTotal: -round(fee, 4),
      createdTime: String(Number(sorted[0].createdTime)),
      updatedTime: String(Number(sorted[sorted.length - 1].createdTime)),
    };
  });
}

/* ---------------- 主流程 ---------------- */
const PT = 'USDT-FUTURES';

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); }
  catch { return fallback; }
}

async function main() {
  const prev = readJson('data.json', null);
  const imp = readJson('import-history.json', { fills: [], positions: [], orders: [], transfers: [] });

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
    transfers: imp.transfers || [],
    tickers: {},
    stats: {},
    equityHistory: [],
  };

  try { data.settings = await get('/api/v3/account/settings'); } catch (e) { errors.push('settings: ' + e.message); }
  try { data.accountAssets = await get('/api/v3/account/assets'); } catch (e) { errors.push('assets: ' + e.message); }
  try { data.fundingAssets = await get('/api/v3/account/funding-assets'); } catch { /* 尽力而为 */ }

  try {
    data.positions = toList(await tryGetPaths([
      '/api/v3/position/current-position',
      `/api/v3/position/current-position?category=${PT}`,
    ]));
  } catch (e) { errors.push('positions: ' + e.message); }
  log('当前持仓:', data.positions.length);

  try { data.openOrders = await getAll('/api/v3/trade/unfilled-orders', { category: PT }); }
  catch (e) { errors.push('openOrders: ' + e.message); }

  const apiHistPos = await getAll('/api/v3/position/history-position', { category: PT }).catch((e) => { errors.push('historyPositions: ' + e.message); return []; });
  const apiFills = await getAll('/api/v3/trade/fills', { category: PT }).catch((e) => { errors.push('fills: ' + e.message); return []; });
  const apiSpotFills = await getAll('/api/v3/trade/fills', { category: 'SPOT' }, 40).catch(() => []);
  const apiOrders = await getAll('/api/v3/trade/history-orders', { category: PT }).catch((e) => { errors.push('orders: ' + e.message); return []; });
  log('API：平仓', apiHistPos.length, '· 成交', apiFills.length + apiSpotFills.length, '· 委托', apiOrders.length);

  /* ---------- 归档合并（先归集缺口，再三方合并） ---------- */
  const mergedFills = mergeFills(prev?.fills || [], imp.fills, [...apiFills, ...apiSpotFills]);
  const basePositions = mergePositions(prev?.historyPositions || [], imp.positions, apiHistPos);
  const gapSynth = synthesizeGapPositions(mergedFills, basePositions);
  data.historyPositions = mergePositions(basePositions, gapSynth);
  data.orders = mergeOrders(prev?.orders || [], imp.orders, apiOrders);
  data.fills = mergedFills;
  log('合并后：平仓', data.historyPositions.length, `（含导入 ${imp.positions.length}、归集 ${gapSynth.length}）· 成交`, data.fills.length, '· 委托', data.orders.length);

  try {
    const tks = toList(await get(`/api/v3/market/tickers?category=${PT}`));
    for (const t of tks) data.tickers[t.symbol] = { lastPr: t.lastPr, bidPr: t.bidPr, askPr: t.askPr };
  } catch (e) { errors.push('tickers: ' + e.message); }

  /* ---------------- 统计（基于全量归档） ---------------- */
  const closes = data.historyPositions
    .map((p) => ({
      t: Number(p.updatedTime || p.createdTime || 0),
      net: Number(p.netProfit ?? 0),
      pnl: Number(p.cumRealisedPnl ?? 0),
      fee: -(Number(p.openFeeTotal || 0) + Number(p.closeFeeTotal || 0)),
      funding: Number(p.totalFunding || 0),
    }))
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

  const usdtFee = (f) => {
    if (Array.isArray(f.feeDetail)) return f.feeDetail.filter((x) => (x.feeCoin || 'USDT') === 'USDT').reduce((s, x) => s + Number(x.fee || 0), 0);
    return (f.feeCoin || 'USDT') === 'USDT' ? Number(f.fee || 0) : 0;
  };
  const fees = round(data.fills.reduce((s, f) => s + usdtFee(f), 0), 2);
  const usdtEquity = round(Number(data.accountAssets?.usdtEquity ?? data.accountAssets?.accountEquity ?? 0), 2);

  /* 权益快照（长期净值曲线，逐次追加） */
  const eqFile = path.join(DATA_DIR, 'equity-history.json');
  let eqHist = readJson('equity-history.json', []);
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
  log(`完成：权益≈${usdtEquity} USDT · 全量净已实现盈亏 ${data.stats.realizedPnl}（${closes.length} 笔平仓）· 手续费 ${fees}`);
  if (errors.length) log('警告', errors.length, '条:', errors.slice(0, 3).join(' | '));
}

main().catch((e) => {
  console.error('[sync] 失败:', e.message);
  if (e.apiCode === '40101' || e.apiCode === '40001') {
    console.error('签名/密钥校验失败：请确认 API Key、Secret、Passphrase 完整。');
  }
  process.exit(1);
});
