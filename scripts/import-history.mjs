#!/usr/bin/env node
/**
 * 导入 Bitget 经典账户官方导出文件（CSV/XLS）→ data/import-history.json
 * 数据源：Bitget 网页后台「导出记录」功能生成的文件（非手工整理）
 * 运行一次即可；fetch.mjs 每次同步都会把这些历史并入 data.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SRC = process.env.BITGET_EXPORT_DIR || 'E:\\OneDrive\\Desktop\\bitget';
const FILES = {
  fillsEarly: path.join(SRC, '导出 U 本位合约成交明细-2026-08-19 23_14_28.497.csv'), // 2026-03 ~ 06-04
  positions: path.join(SRC, '导出 U 本位合约历史仓位-2026-07-29 22_50_23.211.csv'),   // 2026-02 ~ 06-04
  orders: path.join(SRC, '20260731_112243_1.csv'),                                    // 2026-06-04 ~ 07-31 委托
  fillsLate: path.join(SRC, '20260731_112243_2.csv'),                                 // 2026-06-04 ~ 07-31 成交
  transfers: path.join(SRC, '导出充提记录-2026-08-19 20_05_12.132.xls'),               // 充提记录
};

const toMs = (s) => Date.parse(String(s).trim().replace(' ', 'T') + '+08:00'); // 导出时间为 UTC+8
const num = (s) => parseFloat(String(s ?? '').replace(/,/g, '')) || 0;
const str = (n) => String(n ?? '');

function readCsvLines(file) {
  const txt = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return txt.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(',').map((f) => f.trim().replace(/^\t/, '')));
}
const normSymbol = (s) => String(s).replace('/USDT', 'USDT').trim();
const TRADE_SIDE = { 'open long': 'open_long', 'close long': 'close_long', 'open short': 'open_short', 'close short': 'close_short', buy: 'buy', sell: 'sell' };
const sideOf = (ts) => ({ open_long: 'buy', close_long: 'sell', open_short: 'sell', close_short: 'buy', buy: 'buy', sell: 'sell' }[ts] || '');
const parseFee = (s) => { // "0.13USDT" / "0.00005rMSTR" → {fee(正数成本), feeCoin}
  const m = String(s ?? '').match(/^(-?[\d.]+)(.*)$/);
  return m ? { fee: Math.abs(parseFloat(m[1])), feeCoin: m[2] || 'USDT' } : { fee: 0, feeCoin: 'USDT' };
};

/* ---------- 成交明细（早期：带每笔平仓盈亏） ---------- */
function importFillsEarly() {
  const lines = readCsvLines(FILES.fillsEarly);
  const head = lines[0];
  const i = (name) => head.indexOf(name);
  return lines.slice(1).map((c) => {
    const tradeSide = TRADE_SIDE[(c[i('方向')] || '').toLowerCase()] || '';
    return {
      importSource: 'csv',
      category: 'USDT-FUTURES',
      symbol: normSymbol(c[i('合约')]),
      tradeSide,
      side: sideOf(tradeSide),
      orderType: '—',
      execPrice: str(num(c[i('成交均价')])),
      execQty: str(num(c[i('成交数量')])),
      execValue: str(num(c[i('成交额')])),
      execPnl: num(c[i('已实现盈亏')]),
      fee: Math.abs(num(c[i('手续费')])), // 统一为正数成本
      feeCoin: 'USDT',
      createdTime: String(toMs(c[i('时间')])),
    };
  });
}

/* ---------- 成交明细（晚期：2026-06~07，含现货） ---------- */
function importFillsLate() {
  const lines = readCsvLines(FILES.fillsLate);
  const head = lines[0];
  const i = (name) => head.indexOf(name);
  return lines.slice(1).map((c) => {
    const tradeSide = TRADE_SIDE[(c[i('方向')] || '').toLowerCase()] || '';
    const { fee, feeCoin } = parseFee(c[i('手续费')]);
    return {
      importSource: 'csv',
      category: (c[i('交易类型')] || '').includes('spot') ? 'SPOT' : 'USDT-FUTURES',
      symbol: normSymbol(c[i('币对')]),
      orderId: c[i('订单号')],
      tradeSide,
      side: sideOf(tradeSide),
      orderType: c[i('委托类型')] || '—',
      execPrice: str(num(c[i('成交价')])),
      execQty: str(num(c[i('成交量')])),
      execValue: str(num(c[i('成交额')])),
      fee,
      feeCoin,
      createdTime: String(toMs(c[i('时间')])),
    };
  });
}

/* ---------- 历史仓位（2026-02 ~ 06） ---------- */
function importPositions() {
  const lines = readCsvLines(FILES.positions);
  const head = lines[0];
  const i = (name) => head.indexOf(name);
  return lines.slice(1).map((c) => {
    const m = (c[i('合约')] || '').match(/^(\S+)\s+(Long|Short)\s*·\s*(Isolated|Cross)/i);
    const [, symbol, side, margin] = m || [, c[i('合约')], '', ''];
    return {
      importSource: 'csv',
      category: 'USDT-FUTURES',
      symbol: normSymbol(symbol),
      posSide: side ? side.toLowerCase() : undefined,
      marginMode: /isolated/i.test(margin || '') ? 'isolated' : 'crossed',
      openPriceAvg: str(num(c[i('开仓均价')])),
      closePriceAvg: str(num(c[i('平仓均价')])),
      closeTotalPos: str(num(c[i('平仓量')])),
      cumRealisedPnl: num(c[i('已实现盈亏')]),      // 毛盈亏（不含费用）
      netProfit: num(c[i('仓位盈亏')]),              // 净盈亏（含手续费与资金费）
      totalFunding: num(c[i('资金费用')]),
      openFeeTotal: num(c[i('开仓手续费')]),          // 负值
      closeFeeTotal: num(c[i('平仓手续费')]),         // 负值
      createdTime: String(toMs(c[i('开仓时间')])),
      updatedTime: String(toMs(c[i('全部平仓时间')])),
    };
  });
}

/* ---------- 历史委托（2026-06 ~ 07，含现货） ---------- */
function importOrders() {
  const lines = readCsvLines(FILES.orders);
  const head = lines[0];
  const i = (name) => head.indexOf(name);
  return lines.slice(1).map((c) => {
    const tradeSide = TRADE_SIDE[(c[i('方向')] || '').toLowerCase()] || '';
    const { fee, feeCoin } = parseFee(c[i('手续费')]);
    const status = (c[i('状态')] || '').toLowerCase();
    return {
      importSource: 'csv',
      category: (c[i('交易类型')] || '').includes('spot') ? 'SPOT' : 'USDT-FUTURES',
      orderId: c[i('订单号')],
      symbol: normSymbol(c[i('币对')]),
      orderType: c[i('委托类型')] || '—',
      timeInForce: c[i('订单类型')] || '',
      tradeSide,
      side: sideOf(tradeSide),
      price: str(num(c[i('价格')])),
      qty: str(num(c[i('委托量')])),
      cumExecQty: str(num(c[i('成交量')])),
      avgPrice: str(num(c[i('成交均价')])),
      cumExecValue: str(num(c[i('成交额')])),
      fee,
      feeCoin,
      orderStatus: status.includes('full') ? 'filled' : status.includes('cancel') ? 'canceled' : status,
      createdTime: String(toMs(c[i('时间')])),
    };
  });
}

/* ---------- 充提记录（xls） ---------- */
function importTransfers() {
  const py = `
import xlrd, json, sys
wb = xlrd.open_workbook(r'''${FILES.transfers}''')
sh = wb.sheet_by_index(0)
rows = [[str(c.value).strip() for c in r] for r in sh.get_rows()]
print(json.dumps(rows, ensure_ascii=False))
`;
  const out = execFileSync('python', ['-X', 'utf8', '-c', py], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const rows = JSON.parse(out);
  const head = rows[0];
  const i = (n) => head.indexOf(n);
  return rows.slice(1).map((c) => ({
    time: String(toMs(c[i('时间')])),
    type: c[i('类型')],
    account: c[i('充提账户')],
    coin: c[i('币种')],
    amount: str(num(c[i('数量')])),
    txid: c[i('交易ID')],
    status: c[i('状态')],
  }));
}

/* ---------- 汇总输出 ---------- */
const fills = [...importFillsEarly(), ...importFillsLate()];
const positions = importPositions();
const orders = importOrders();
let transfers = [];
try { transfers = importTransfers(); } catch (e) { console.error('[import] 充提记录读取失败:', e.message); }

const out = {
  meta: {
    generatedAt: new Date().toISOString(),
    note: '经典账户历史（Bitget 官方导出文件导入）',
    files: Object.fromEntries(Object.entries(FILES).map(([k, v]) => [k, path.basename(v)])),
    counts: { fills: fills.length, positions: positions.length, orders: orders.length, transfers: transfers.length },
  },
  fills,
  positions,
  orders,
  transfers,
};
fs.writeFileSync(path.join(ROOT, 'data', 'import-history.json'), JSON.stringify(out));
console.log('[import] 完成：成交', fills.length, '· 平仓', positions.length, '· 委托', orders.length, '· 充提', transfers.length);
