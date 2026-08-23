/* 西西弗斯 | 交易日记 — 前端渲染（纯静态，读取 data/data.json） */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ---------- 工具 ---------- */
const fmt = (n, dp = 2) =>
  n === null || n === undefined || isNaN(Number(n)) ? '–' :
  Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pnl = (n, dp = 2) => (n > 0 ? '+' : '') + fmt(n, dp);
const cls = (n) => (Number(n) > 0 ? 'pos' : Number(n) < 0 ? 'neg' : 'dim');
const pct = (n) => (n === null || n === undefined || isNaN(Number(n)) ? '–' : pnl(Number(n), 2) + '%');
const TZ = { timeZone: 'Asia/Shanghai', hour12: false };
const t = (ms) => ms ? new Date(Number(ms)).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', ...TZ, hour: '2-digit', minute: '2-digit' }) : '–';
const tFull = (ms) => ms ? new Date(Number(ms)).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', ...TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '–';
const dOnly = (ms) => ms ? new Date(Number(ms)).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', ...TZ }) : '–';
const sym = (s) => String(s || '').replace(/USDT$/, '').replace(/USDC$/, '');
const cny = (usdt) => usdt == null ? null : usdt * 7.2; // 估算汇率，仅作参考
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SIDE = { long: '多', short: '空' };
const TRADE_SIDE = { open_long: '开多', close_long: '平多', open_short: '开空', close_short: '平空', buy: '买入', sell: '卖出' };
const ORDER_STATUS = { filled: '已成交', canceled: '已撤销', cancelled: '已撤销', new: '待成交', partial: '部分成交', live: '待成交' };

const state = { data: null, closes: [], fills: [], orders: [] };

/* ---------- 数据加载 ---------- */
async function load() {
  const r = await fetch(`data/data.json?t=${Date.now()}`);
  state.data = await r.json();
  prepare();
  renderAll();
}

function prepare() {
  const d = state.data;
  state.closes = [...(d.historyPositions || [])].sort((a, b) => Number(b.updatedTime) - Number(a.updatedTime));
  const fills = [...(d.fills || []), ...(d.spotFills || [])];
  state.fills = fills.sort((a, b) => Number(b.createdTime) - Number(a.createdTime));
  state.orders = [...(d.orders || [])].sort((a, b) => Number(b.createdTime) - Number(a.createdTime));
}

/* ---------- 总览 ---------- */
function renderOverview() {
  const { stats } = state.data;
  const eq = stats.usdtEquity, c = cny(eq);
  const cards = [
    { k: '账户总权益（USDT）', v: fmt(eq), hint: c ? `≈ ¥${fmt(c, 0)} · 1U≈7.2¥估算` : '', hi: true },
    { k: '未实现盈亏', v: pnl(stats.unrealisedPnl ?? NaN), cls: cls(stats.unrealisedPnl), hint: '当前持仓浮动' },
    { k: '净已实现盈亏（近90天）', v: pnl(stats.realizedPnl), cls: cls(stats.realizedPnl), hint: `平仓 ${stats.closesCount} 笔 · 含费用` },
    { k: '胜率', v: stats.winRate == null ? '–' : stats.winRate + '%', hint: '按净盈亏计' },
    { k: '累计手续费', v: fmt(stats.fees), hint: '全部成交（近90天）' },
    { k: '资金费收支', v: pnl(stats.funding), cls: cls(stats.funding), hint: '已平仓位合计' },
  ];
  $('#cards').innerHTML = cards.map((x) => `
    <div class="stat ${x.hi ? 'hi' : ''}">
      <div class="k">${x.k}</div>
      <div class="v ${x.cls || ''}">${x.v}${x.hint ? `<div class="hint">${x.hint}</div>` : ''}</div>
    </div>`).join('');

  lineChart($('#curveChart'), state.data.stats.curve || []);
  barChart($('#dailyChart'), (state.data.stats.daily || []).slice(-30));

  const head = `<thead><tr><th>平仓时间</th><th>币种</th><th>方向</th><th>数量</th><th>开仓均价</th><th>平仓均价</th><th>净盈亏(USDT)</th></tr></thead>`;
  const rows = state.closes.slice(0, 10).map((p) => `
    <tr>
      <td>${t(p.updatedTime)}</td>
      <td><b>${esc(sym(p.symbol))}</b><span class="tag">${p.category === 'SPOT' ? '现货' : '合约'}</span></td>
      <td class="${p.posSide === 'long' ? 'pos' : 'neg'}">${SIDE[p.posSide] || '–'}</td>
      <td class="num">${fmt(p.closeTotalPos, 3)}</td>
      <td class="num">${fmt(p.openPriceAvg, p.openPriceAvg > 100 ? 2 : 4)}</td>
      <td class="num">${fmt(p.closePriceAvg, p.closePriceAvg > 100 ? 2 : 4)}</td>
      <td class="num ${cls(p.netProfit)}">${pnl(p.netProfit)}</td>
    </tr>`).join('');
  $('#recentCloses').innerHTML = head + `<tbody>${rows || '<tr><td colspan="7" class="empty">暂无平仓记录</td></tr>'}</tbody>`;
}

/* ---------- SVG 折线图（累计盈亏曲线） ---------- */
function lineChart(el, pts) {
  if (!pts || pts.length < 2) {
    el.innerHTML = '<div class="placeholder">数据点不足，曲线将随每次同步自动生长 🌱</div>';
    return;
  }
  const W = 720, H = 260, P = 34;
  const xs = pts.map((p) => p.t), ys = pts.map((p) => p.cum);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(0, ...ys), y1 = Math.max(0, ...ys);
  const sx = (t) => P + ((t - x0) / (x1 - x0 || 1)) * (W - 2 * P);
  const sy = (v) => H - P - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * P);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t).toFixed(1)},${sy(p.cum).toFixed(1)}`).join('');
  const area = `${line}L${sx(x1).toFixed(1)},${sy(Math.max(0, y0))}L${sx(x0).toFixed(1)},${sy(Math.max(0, y0))}Z`;
  const last = pts[pts.length - 1], up = last.cum >= 0, col = up ? '#2ebd85' : '#f6465d';
  el.innerHTML = `
  <svg viewBox="0 0 ${W} ${H}" role="img">
    <line x1="${P}" y1="${sy(0)}" x2="${W - P}" y2="${sy(0)}" stroke="#3a434f" stroke-dasharray="4 4"/>
    <path d="${area}" fill="${col}" opacity="0.12"/>
    <path d="${line}" fill="none" stroke="${col}" stroke-width="2"/>
    <circle cx="${sx(last.t)}" cy="${sy(last.cum)}" r="3.5" fill="${col}"/>
    <text x="${P}" y="${H - 8}" fill="#848e9c" font-size="11">${dOnly(x0)}</text>
    <text x="${W - P}" y="${H - 8}" fill="#848e9c" font-size="11" text-anchor="end">${dOnly(x1)}</text>
    <text x="${P}" y="${sy(0) - 6}" fill="#848e9c" font-size="11">累计 ${pnl(last.cum)} USDT</text>
    ${pts.map((p) => `<title>${tFull(p.t)}：累计 ${pnl(p.cum)} USDT</title>`).join('')}
  </svg>`;
}

/* ---------- SVG 柱状图（每日盈亏） ---------- */
function barChart(el, days) {
  if (!days.length) { el.innerHTML = '<div class="placeholder">暂无数据</div>'; return; }
  const W = 720, H = 260, P = 30;
  const maxAbs = Math.max(...days.map((d) => Math.abs(d.pnl)), 1);
  const n = days.length, gap = 2, bw = Math.min(28, (W - 2 * P) / n - gap);
  const y0 = H / 2, half = H / 2 - P;
  const bars = days.map((d, i) => {
    const h = (Math.abs(d.pnl) / maxAbs) * half;
    const x = P + i * ((W - 2 * P) / n);
    const y = d.pnl >= 0 ? y0 - h : y0;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="2" fill="${d.pnl >= 0 ? '#2ebd85' : '#f6465d'}" opacity="0.9"><title>${d.d}：${pnl(d.pnl)} USDT</title></rect>`;
  }).join('');
  el.innerHTML = `
  <svg viewBox="0 0 ${W} ${H}" role="img">
    <line x1="${P}" y1="${y0}" x2="${W - P}" y2="${y0}" stroke="#3a434f"/>
    <text x="${P}" y="${P - 12}" fill="#2ebd85" font-size="11">+${fmt(maxAbs)}</text>
    <text x="${P}" y="${H - P + 16}" fill="#f6465d" font-size="11">-${fmt(maxAbs)}</text>
    <text x="${P}" y="${H - 6}" fill="#848e9c" font-size="11">${days[0].d.slice(5)}</text>
    <text x="${W - P}" y="${H - 6}" fill="#848e9c" font-size="11" text-anchor="end">${days[days.length - 1].d.slice(5)}</text>
    ${bars}
  </svg>`;
}

/* ---------- 当前持仓 ---------- */
function renderPositions() {
  const d = state.data;
  const ps = d.positions || [];
  $('#posCount').textContent = ps.length ? `(${ps.length})` : '';
  $('#posEmpty').hidden = ps.length > 0;
  const head = `<thead><tr><th>币种</th><th>方向</th><th>杠杆</th><th>数量</th><th>开仓均价</th><th>标记价</th><th>保证金</th><th>浮动盈亏</th><th>收益率</th><th>本仓已实现</th><th>强平价</th><th>开仓时间</th></tr></thead>`;
  const rows = ps.map((p) => {
    const mark = p.markPrice ?? d.tickers?.[p.symbol]?.lastPr;
    return `<tr>
      <td><b>${esc(sym(p.symbol))}</b><span class="tag">${p.category === 'SPOT' ? '现货' : esc((p.marginMode === 'crossed' ? '全仓' : '逐仓'))}</span></td>
      <td class="${p.posSide === 'long' ? 'pos' : 'neg'}">${SIDE[p.posSide] || '–'}</td>
      <td class="num dim">${esc(p.leverage)}x</td>
      <td class="num">${fmt(p.total, 3)}</td>
      <td class="num">${fmt(p.avgPrice, p.avgPrice > 100 ? 2 : 4)}</td>
      <td class="num">${fmt(mark, mark > 100 ? 2 : 4)}</td>
      <td class="num">${fmt(p.positionBalance)}</td>
      <td class="num ${cls(p.unrealisedPnl)}">${pnl(p.unrealisedPnl)}</td>
      <td class="num ${cls(p.profitRate)}">${pct(p.profitRate && p.profitRate * 100)}</td>
      <td class="num ${cls(p.curRealisedPnl)}">${pnl(p.curRealisedPnl)}</td>
      <td class="num dim">${Number(p.liquidationPrice) > 0 ? fmt(p.liquidationPrice, p.liquidationPrice > 100 ? 2 : 4) : '–'}</td>
      <td class="dim">${t(p.createdTime)}</td>
    </tr>`;
  }).join('');
  $('#positionsTable').innerHTML = head + `<tbody>${rows}</tbody>`;

  const oos = d.openOrders || [];
  $('#ooCount').textContent = oos.length ? `(${oos.length})` : '';
  $('#ooEmpty').hidden = oos.length > 0;
  $('#openOrdersTable').innerHTML = oos.length
    ? `<thead><tr><th>时间</th><th>币种</th><th>方向</th><th>类型</th><th>委托价</th><th>数量</th><th>已成交</th><th>状态</th></tr></thead><tbody>` +
      oos.map((o) => `<tr>
        <td>${t(o.createdTime)}</td>
        <td><b>${esc(sym(o.symbol))}</b></td>
        <td class="${o.side === 'buy' ? 'pos' : 'neg'}">${TRADE_SIDE[o.side] || esc(o.side)}${o.posSide && SIDE[o.posSide] ? ` ${SIDE[o.posSide]}` : ''}</td>
        <td class="dim">${esc(o.orderType)}</td>
        <td class="num">${Number(o.price) > 0 ? fmt(o.price, o.price > 100 ? 2 : 4) : '市价'}</td>
        <td class="num">${fmt(o.qty, 3)}</td>
        <td class="num">${fmt(o.cumExecQty, 3)}</td>
        <td class="dim">${ORDER_STATUS[o.orderStatus] || esc(o.orderStatus)}</td>
      </tr>`).join('') + '</tbody>'
    : '';

  const assets = d.accountAssets?.assets || [];
  $('#assetsTable').innerHTML = assets.length
    ? `<thead><tr><th>币种</th><th>权益</th><th>≈价值(USD)</th><th>可用</th><th>锁定</th></tr></thead><tbody>` +
      assets.map((a) => `<tr>
        <td><b>${esc(a.coin)}</b></td>
        <td class="num">${fmt(a.equity, 4)}</td>
        <td class="num dim">${fmt(a.usdValue)}</td>
        <td class="num">${fmt(a.available, 4)}</td>
        <td class="num dim">${fmt(a.locked, 4)}</td>
      </tr>`).join('') + '</tbody>'
    : '<tbody><tr><td class="empty">–</td></tr></tbody>';

  const fund = (d.fundingAssets || []).filter((f) => Number(f.balance) > 0);
  $('#fundingTable').innerHTML = fund.length
    ? `<thead><tr><th>币种</th><th>可用</th><th>冻结</th><th>余额</th></tr></thead><tbody>` +
      fund.map((f) => `<tr>
        <td><b>${esc(f.coin)}</b></td>
        <td class="num">${fmt(f.available, 4)}</td>
        <td class="num dim">${fmt(f.frozen, 4)}</td>
        <td class="num">${fmt(f.balance, 4)}</td>
      </tr>`).join('') + '</tbody>'
    : '<tbody><tr><td class="empty">资金账户暂无余额</td></tr></tbody>';
}

/* ---------- 平仓历史 ---------- */
function renderCloses() {
  const kw = ($('#closesFilter').value || '').trim().toUpperCase();
  const list = state.closes.filter((p) => !kw || String(p.symbol).includes(kw));
  $('#closesCount').textContent = `(${list.length})`;
  const head = `<thead><tr><th>平仓时间</th><th>币种</th><th>方向</th><th>数量</th><th>开仓均价</th><th>平仓均价</th><th>毛盈亏</th><th>手续费</th><th>资金费</th><th>净盈亏</th><th>开仓时间</th></tr></thead>`;
  const rows = list.map((p) => {
    const fee = -(Number(p.openFeeTotal || 0) + Number(p.closeFeeTotal || 0));
    return `<tr>
      <td>${t(p.updatedTime)}</td>
      <td><b>${esc(sym(p.symbol))}</b></td>
      <td class="${p.posSide === 'long' ? 'pos' : 'neg'}">${SIDE[p.posSide] || '–'}</td>
      <td class="num">${fmt(p.closeTotalPos, 3)}</td>
      <td class="num">${fmt(p.openPriceAvg, p.openPriceAvg > 100 ? 2 : 4)}</td>
      <td class="num">${fmt(p.closePriceAvg, p.closePriceAvg > 100 ? 2 : 4)}</td>
      <td class="num ${cls(p.cumRealisedPnl)}">${pnl(p.cumRealisedPnl)}</td>
      <td class="num dim">${fmt(fee)}</td>
      <td class="num ${cls(p.totalFunding)}">${pnl(p.totalFunding)}</td>
      <td class="num ${cls(p.netProfit)}"><b>${pnl(p.netProfit)}</b></td>
      <td class="dim">${t(p.createdTime)}</td>
    </tr>`;
  }).join('');
  $('#closesTable').innerHTML = head + `<tbody>${rows || '<tr><td colspan="11" class="empty">无匹配记录</td></tr>'}</tbody>`;
}

/* ---------- 成交明细 ---------- */
function renderFills() {
  const kw = ($('#fillsFilter').value || '').trim().toUpperCase();
  const list = state.fills.filter((f) => !kw || String(f.symbol).includes(kw));
  $('#fillsCount').textContent = `(${list.length})`;
  const head = `<thead><tr><th>时间</th><th>币种</th><th>类别</th><th>方向</th><th>成交价</th><th>数量</th><th>成交额</th><th>手续费</th><th>平仓盈亏</th></tr></thead>`;
  const rows = list.map((f) => {
    const fee = Array.isArray(f.feeDetail) ? f.feeDetail.reduce((s, x) => s + Number(x.fee || 0), 0) : 0;
    const spot = f.category === 'SPOT';
    return `<tr>
      <td>${t(f.createdTime)}</td>
      <td><b>${esc(spot ? f.symbol : sym(f.symbol))}</b>${spot ? '<span class="tag spot">现货</span>' : ''}</td>
      <td class="dim">${esc(f.orderType)}</td>
      <td class="${(f.side === 'buy' || String(f.tradeSide).includes('open')) ? 'pos' : 'neg'}">${TRADE_SIDE[f.tradeSide] || TRADE_SIDE[f.side] || esc(f.side)}</td>
      <td class="num">${fmt(f.execPrice, f.execPrice > 100 ? 2 : 4)}</td>
      <td class="num">${fmt(f.execQty, 4)}</td>
      <td class="num dim">${fmt(f.execValue)}</td>
      <td class="num dim">${fmt(fee, 4)}</td>
      <td class="num ${cls(f.execPnl)}">${Number(f.execPnl) ? pnl(f.execPnl) : '–'}</td>
    </tr>`;
  }).join('');
  $('#fillsTable').innerHTML = head + `<tbody>${rows || '<tr><td colspan="9" class="empty">无匹配记录</td></tr>'}</tbody>`;
}

/* ---------- 历史委托 ---------- */
function renderOrders() {
  const kw = ($('#ordersFilter').value || '').trim().toUpperCase();
  const list = state.orders.filter((o) => !kw || String(o.symbol).includes(kw));
  $('#ordersCount').textContent = `(${list.length})`;
  const head = `<thead><tr><th>时间</th><th>币种</th><th>方向</th><th>类型</th><th>委托价</th><th>委托量</th><th>成交量</th><th>成交均价</th><th>状态</th><th>委托量(USD)</th></tr></thead>`;
  const rows = list.map((o) => `<tr>
    <td>${t(o.createdTime)}</td>
    <td><b>${esc(sym(o.symbol))}</b></td>
    <td class="${(o.side === 'buy' || String(o.tradeSide).includes('open')) ? 'pos' : 'neg'}">${o.posSide && SIDE[o.posSide] ? `${TRADE_SIDE[o.tradeSide] || (o.side === 'buy' ? '买' : '卖')}` : (o.side === 'buy' ? '买入' : '卖出')}</td>
    <td class="dim">${esc(o.orderType)}${o.timeInForce === 'post_only' ? '·PO' : ''}</td>
    <td class="num">${Number(o.price) > 0 ? fmt(o.price, o.price > 100 ? 2 : 4) : '市价'}</td>
    <td class="num">${fmt(o.qty, 4)}</td>
    <td class="num">${fmt(o.cumExecQty, 4)}</td>
    <td class="num">${Number(o.avgPrice) > 0 ? fmt(o.avgPrice, o.avgPrice > 100 ? 2 : 4) : '–'}</td>
    <td class="dim">${ORDER_STATUS[o.orderStatus] || esc(o.orderStatus)}${o.cancelReason ? `<span class="tag">${esc(o.cancelReason)}</span>` : ''}</td>
    <td class="num dim">${fmt(o.cumExecValue)}</td>
  </tr>`).join('');
  $('#ordersTable').innerHTML = head + `<tbody>${rows || '<tr><td colspan="10" class="empty">无匹配记录</td></tr>'}</tbody>`;
}

/* ---------- CSV 导出 ---------- */
function exportCSV(kind) {
  let rows = [];
  if (kind === 'positions') {
    rows = [['币种', '方向', '杠杆', '数量', '开仓均价', '标记价', '保证金', '浮动盈亏', '收益率%', '强平价', '开仓时间']]
      .concat((state.data.positions || []).map((p) => [p.symbol, SIDE[p.posSide], p.leverage, p.total, p.avgPrice, p.markPrice, p.positionBalance, p.unrealisedPnl, p.profitRate && (p.profitRate * 100).toFixed(2), p.liquidationPrice, tFull(p.createdTime)]));
  } else if (kind === 'closes') {
    rows = [['平仓时间', '币种', '方向', '数量', '开仓均价', '平仓均价', '毛盈亏', '净盈亏', '资金费', '开仓时间']]
      .concat(state.closes.map((p) => [tFull(p.updatedTime), p.symbol, SIDE[p.posSide], p.closeTotalPos, p.openPriceAvg, p.closePriceAvg, p.cumRealisedPnl, p.netProfit, p.totalFunding, tFull(p.createdTime)]));
  } else if (kind === 'fills') {
    rows = [['时间', '币种', '类别', '方向', '成交价', '数量', '成交额', '手续费', '平仓盈亏']]
      .concat(state.fills.map((f) => {
        const fee = Array.isArray(f.feeDetail) ? f.feeDetail.reduce((s, x) => s + Number(x.fee || 0), 0) : 0;
        return [tFull(f.createdTime), f.symbol, f.category, TRADE_SIDE[f.tradeSide] || f.side, f.execPrice, f.execQty, f.execValue, fee, f.execPnl];
      }));
  } else if (kind === 'orders') {
    rows = [['时间', '币种', '方向', '类型', '委托价', '委托量', '成交量', '成交均价', '状态']]
      .concat(state.orders.map((o) => [tFull(o.createdTime), o.symbol, o.side, o.orderType, o.price, o.qty, o.cumExecQty, o.avgPrice, ORDER_STATUS[o.orderStatus] || o.orderStatus]));
  }
  const csv = '\ufeff' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `bitget-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- 渲染总入口 ---------- */
function renderAll() {
  const d = state.data;
  $('#syncTime').textContent = new Date(d.meta.generatedAtMs).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', ...TZ, hour: '2-digit', minute: '2-digit' });
  renderOverview();
  renderPositions();
  renderCloses();
  renderFills();
  renderOrders();
}

/* ---------- 事件 ---------- */
$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b === btn));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
  window.scrollTo({ top: 0 });
});
document.addEventListener('click', (e) => {
  const goto = e.target.closest('[data-goto]');
  if (goto) { e.preventDefault(); $(`#tabs button[data-tab="${goto.dataset.goto}"]`).click(); }
  const csv = e.target.closest('[data-csv]');
  if (csv) exportCSV(csv.dataset.csv);
});
['closes', 'fills', 'orders'].forEach((k) => {
  $(`#${k}Filter`).addEventListener('input', () => ({ closes: renderCloses, fills: renderFills, orders: renderOrders })[k]());
});

/* 仓库链接（部署后可打开） */
if (window.REPO_URL) {
  const a = $('#repoLink');
  a.href = window.REPO_URL; a.hidden = false;
}

load();
setInterval(load, 5 * 60 * 1000); // 每 5 分钟自动刷新
