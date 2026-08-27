/* Successful西西弗斯 | 交易日记 — 前端渲染（纯静态，读取 data/data.json + data/reviews.json） */
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
const dFull = (ms) => ms ? new Date(Number(ms)).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', ...TZ }) : '–';
const sym = (s) => String(s || '').replace(/USDT$/, '').replace(/USDC$/, '');
const cny = (usdt) => usdt == null ? null : usdt * 7.2;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nl2br = (s) => esc(s).replace(/\r?\n/g, '<br>');

const SIDE = { long: '多', short: '空' };
const TRADE_SIDE = { open_long: '开多', close_long: '平多', open_short: '开空', close_short: '平空', buy: '买入', sell: '卖出' };
const ORDER_STATUS = { filled: '已成交', canceled: '已撤销', cancelled: '已撤销', new: '待成交', partial: '部分成交', live: '待成交' };
const RANGES = [['30', '近30天'], ['60', '近60天'], ['90', '近90天'], ['all', '交易至今']];

/* 复盘唯一键：与 scripts/fetch.mjs 的 posKey 规则一致 */
const rvKey = (p) => `${p.symbol}|${p.posSide || ''}|${Math.floor(Number(p.updatedTime || p.createdTime || 0) / 1000)}`;

const state = { data: null, reviews: {}, closes: [], fills: [], orders: [], range: 'all', cardRange: 'all' };
let reviewOpener = null;

/* ---------- 数据加载 ---------- */
async function load() {
  const [r, rr] = await Promise.all([
    fetch(`data/data.json?t=${Date.now()}`),
    fetch(`data/reviews.json?t=${Date.now()}`).catch(() => null),
  ]);
  state.data = await r.json();
  try { state.reviews = rr && rr.ok ? await rr.json() : {}; } catch { state.reviews = {}; }
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

/* 时间过滤：days='all' 或天数 */
const rangeCutoff = (days) => days === 'all' ? -Infinity : Date.now() - Number(days) * 864e5;
const inRange = (ms, days) => Number(ms) >= rangeCutoff(days);
function closeStats(days) {
  const list = state.closes.filter((p) => inRange(p.updatedTime, days));
  return { net: list.reduce((s, p) => s + Number(p.netProfit || 0), 0), count: list.length };
}

/* ---------- 总览 ---------- */
function renderOverview() {
  const { stats } = state.data;
  const eq = stats.usdtEquity, c = cny(eq);
  const cs = closeStats(state.cardRange);
  const rangeLabel = RANGES.find((r) => r[0] === state.cardRange)[1];

  const cards = [
    { k: '账户总权益（USDT）', v: fmt(eq), hint: c ? `≈ ¥${fmt(c, 0)} · 1U≈7.2¥估算` : '', hi: true },
    { k: '未实现盈亏', v: pnl(stats.unrealisedPnl ?? NaN), cls: cls(stats.unrealisedPnl), hint: '当前持仓浮动' },
    { k: '净已实现盈亏', v: pnl(cs.net), cls: cls(cs.net), hint: `${rangeLabel} ${cs.count} 笔平仓 · 含费用`,
      select: `<select id="cardRange" class="range-select">${RANGES.map(([v, l]) => `<option value="${v}" ${v === state.cardRange ? 'selected' : ''}>${l}</option>`).join('')}</select>` },
    { k: '胜率', v: stats.winRate == null ? '–' : stats.winRate + '%', hint: '按净盈亏计（全程）' },
    { k: '累计手续费', v: fmt(stats.fees), hint: '全部留档成交（USDT 计价）' },
    { k: '资金费收支', v: pnl(stats.funding), cls: cls(stats.funding), hint: '已平仓位合计（全程）' },
  ];
  $('#cards').innerHTML = cards.map((x) => `
    <div class="stat ${x.hi ? 'hi' : ''}">
      <div class="k">${x.k}${x.select || ''}</div>
      <div class="v ${x.cls || ''}">${x.v}${x.hint ? `<div class="hint">${x.hint}</div>` : ''}</div>
    </div>`).join('');
  $('#cardRange').addEventListener('change', (e) => { state.cardRange = e.target.value; renderOverview(); });
}

/* ---------- 图表时间切换按钮组 ---------- */
function renderTabs(id, cur, onPick) {
  $(`#${id}`).innerHTML = RANGES.map(([v, l]) =>
    `<button class="ctab ${v === cur ? 'on' : ''}" data-v="${v}">${l}</button>`).join('');
  $(`#${id}`).onclick = (e) => { const b = e.target.closest('button'); if (b) onPick(b.dataset.v); };
}

/* ---------- SVG 折线图（hover 十字线 + 气泡 + 加密刻度） ---------- */
function lineChart(el, ptsAll, days) {
  const sorted = [...ptsAll].sort((a, b) => Number(a.t) - Number(b.t));
  const cutoff = rangeCutoff(days);
  const base = days === 'all'
    ? 0
    : sorted.filter((p) => Number(p.t) < cutoff).at(-1)?.cum || 0;
  // 选定区间从 0 起算，使图表终值与同区间盈亏卡片口径一致。
  const pts = sorted.filter((p) => Number(p.t) >= cutoff).map((p) => ({ ...p, cum: Number(p.cum) - Number(base) }));
  if (!pts || pts.length < 2) {
    el.innerHTML = '<div class="placeholder">该区间暂无平仓数据 🌱</div>'; return;
  }
  const W = 720, H = 260, P = { l: 46, r: 14, t: 16, b: 26 };
  const xs = pts.map((p) => p.t), ys = pts.map((p) => p.cum);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(0, ...ys), y1 = Math.max(0, ...ys);
  const sx = (t) => P.l + ((t - x0) / (x1 - x0 || 1)) * (W - P.l - P.r);
  const sy = (v) => H - P.b - ((v - y0) / (y1 - y0 || 1)) * (H - P.t - P.b);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t).toFixed(1)},${sy(p.cum).toFixed(1)}`).join('');
  const area = `${line}L${sx(x1).toFixed(1)},${sy(Math.max(0, y0))}L${sx(x0).toFixed(1)},${sy(Math.max(0, y0))}Z`;
  const last = pts[pts.length - 1], up = last.cum >= 0, col = up ? '#2ebd85' : '#f6465d';

  /* x 轴刻度：5 个均匀时间点 */
  const ticks = Array.from({ length: 5 }, (_, i) => x0 + ((x1 - x0) * i) / 4);
  const tickSvg = ticks.map((tt) =>
    `<line x1="${sx(tt).toFixed(1)}" y1="${P.t}" x2="${sx(tt).toFixed(1)}" y2="${H - P.b}" stroke="#1f2630"/><text x="${sx(tt).toFixed(1)}" y="${H - 8}" fill="#848e9c" font-size="10.5" text-anchor="middle">${dOnly(tt)}</text>`).join('');

  el.innerHTML = `
  <svg viewBox="0 0 ${W} ${H}" role="img" class="chart-svg">
    ${tickSvg}
    <line x1="${P.l}" y1="${sy(0)}" x2="${W - P.r}" y2="${sy(0)}" stroke="#3a434f" stroke-dasharray="4 4"/>
    <path d="${area}" fill="${col}" opacity="0.12"/>
    <path d="${line}" fill="none" stroke="${col}" stroke-width="2"/>
    <circle cx="${sx(last.t).toFixed(1)}" cy="${sy(last.cum).toFixed(1)}" r="3.5" fill="${col}"/>
    <g class="crosshair" visibility="hidden">
      <line class="ch-x" y1="${P.t}" y2="${H - P.b}" stroke="#848e9c" stroke-dasharray="3 3"/>
      <circle class="ch-dot" r="4" fill="${col}" stroke="#0b0e11"/>
    </g>
  </svg>
  <div class="chart-tip" hidden></div>`;

  const svg = $('.chart-svg', el), tip = $('.chart-tip', el), ch = $('.crosshair', el), chX = $('.ch-x', el), chDot = $('.ch-dot', el);
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const t0 = x0 + ((px - P.l) / (W - P.l - P.r)) * (x1 - x0 || 1);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.t - t0) < Math.abs(best.t - t0)) best = p;
    ch.setAttribute('visibility', 'visible');
    chX.setAttribute('x1', sx(best.t)); chX.setAttribute('x2', sx(best.t));
    chDot.setAttribute('cx', sx(best.t)); chDot.setAttribute('cy', sy(best.cum));
    tip.hidden = false;
    tip.innerHTML = `<b>${dFull(best.t)}</b> 累计净盈亏 <b class="${cls(best.cum)}">${pnl(best.cum)}</b> USDT`;
    const tipX = (sx(best.t) / W) * r.width;
    tip.style.left = Math.min(Math.max(tipX - 75, 0), r.width - 160) + 'px';
    tip.style.top = '6px';
  });
  svg.addEventListener('pointerleave', () => { ch.setAttribute('visibility', 'hidden'); tip.hidden = true; });
}

/* ---------- SVG 柱状图（hover 高亮 + 气泡 + 刻度） ---------- */
function barChart(el, daysAll, days) {
  const daysArr = daysAll.filter((d) => inRange(Date.parse(d.d + 'T00:00:00+08:00'), days));
  if (!daysArr.length) { el.innerHTML = '<div class="placeholder">该区间暂无数据</div>'; return; }
  const W = 720, H = 260, P = { l: 46, r: 14, t: 16, b: 26 };
  const maxAbs = Math.max(...daysArr.map((d) => Math.abs(d.pnl)), 1);
  const n = daysArr.length, step = (W - P.l - P.r) / n;
  const bw = Math.max(0.5, Math.min(28, step * 0.78));
  const y0 = H / 2, half = H / 2 - P.t - 8;
  const bx = (i) => P.l + i * step + (step - bw) / 2;

  const tickN = Math.min(5, n);
  const tickIdx = [...new Set(Array.from({ length: tickN }, (_, i) => Math.round((i * (n - 1)) / Math.max(1, tickN - 1))))];
  const tickSvg = tickIdx.map((i) =>
    `<text x="${(bx(i) + bw / 2).toFixed(1)}" y="${H - 8}" fill="#848e9c" font-size="10.5" text-anchor="middle">${daysArr[i].d.slice(5).replace('-', '/')}</text>`).join('');

  el.innerHTML = `
  <svg viewBox="0 0 ${W} ${H}" role="img" class="chart-svg">
    ${tickSvg}
    <line x1="${P.l}" y1="${y0}" x2="${W - P.r}" y2="${y0}" stroke="#3a434f"/>
    <text x="${P.l - 6}" y="${P.t + 4}" fill="#2ebd85" font-size="10.5" text-anchor="end">+${fmt(maxAbs, 0)}</text>
    <text x="${P.l - 6}" y="${H - P.b}" fill="#f6465d" font-size="10.5" text-anchor="end">-${fmt(maxAbs, 0)}</text>
    ${daysArr.map((d, i) => {
      const h = (Math.abs(d.pnl) / maxAbs) * half;
      const y = d.pnl >= 0 ? y0 - h : y0;
      return `<rect class="bar" data-i="${i}" x="${bx(i).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="2" fill="${d.pnl >= 0 ? '#2ebd85' : '#f6465d'}" opacity="0.85"/>`;
    }).join('')}
  </svg>
  <div class="chart-tip" hidden></div>`;

  const tip = $('.chart-tip', el), svg = $('.chart-svg', el);
  $$('.bar', el).forEach((r) => {
    r.addEventListener('pointerenter', () => {
      const d = daysArr[+r.dataset.i];
      $$('.bar', el).forEach((x) => x.setAttribute('opacity', '0.35'));
      r.setAttribute('opacity', '1');
      tip.hidden = false;
      tip.innerHTML = `<b>${d.d}</b> 当日净盈亏 <b class="${cls(d.pnl)}">${pnl(d.pnl)}</b> USDT`;
      const rr = svg.getBoundingClientRect();
      tip.style.left = Math.min(Math.max((+r.getAttribute('x') / W) * rr.width - 40, 0), rr.width - 170) + 'px';
      tip.style.top = '6px';
    });
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; $$('.bar', el).forEach((x) => x.setAttribute('opacity', '0.85')); });
}

function renderCharts() {
  renderTabs('curveTabs', state.range, (v) => { state.range = v; renderCharts(); });
  renderTabs('dailyTabs', state.range, (v) => { state.range = v; renderCharts(); });
  lineChart($('#curveChart'), state.data.stats.curve || [], state.range);
  barChart($('#dailyChart'), (state.data.stats.daily || []), state.range);
}

/* ---------- 复盘弹层 ---------- */
function openReview(key) {
  const p = state.closes.find((x) => rvKey(x) === key);
  const rv = state.reviews[key];
  if (!p || !rv) return;
  const src = p.importSource === 'csv' ? '（导入）' : p.importSource === 'gap-synth' ? '（归集）' : '';
  $('#rvSym').textContent = `${sym(p.symbol)} ${SIDE[p.posSide] || ''}${src}`;
  $('#rvMeta').textContent = `${dFull(p.createdTime)} 开仓 · ${dFull(p.updatedTime)} 平仓 · 净盈亏 ${pnl(Number(p.netProfit))} USDT · 复盘写于 ${dFull(rv.time)}`;
  $('#rvBody').innerHTML = nl2br(rv.text);
  $('#reviewModal').hidden = false;
  reviewOpener = document.activeElement;
  $('#rvClose').focus();
}
function bindReviewModal() {
  const close = () => { $('#reviewModal').hidden = true; reviewOpener?.focus?.(); };
  $('#rvClose').onclick = close;
  $('#reviewModal').addEventListener('click', (e) => { if (e.target.id === 'reviewModal') close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#reviewModal').hidden) close(); });
}
const rvBadge = (p) => state.reviews[rvKey(p)]
  ? `<button class="rv-btn" data-rv="${esc(rvKey(p))}" title="查看作者复盘">📝</button>` : '<span class="dim">–</span>';

/* ---------- 总览·最近平仓（含开仓时间 + 复盘） ---------- */
function renderRecentCloses() {
  const head = `<thead><tr><th>平仓时间</th><th>开仓时间</th><th>币种</th><th>方向</th><th>数量</th><th>开仓均价</th><th>平仓均价</th><th>净盈亏(USDT)</th><th>复盘</th></tr></thead>`;
  const rows = state.closes.slice(0, 10).map((p) => `
    <tr>
      <td>${t(p.updatedTime)}</td>
      <td class="dim">${t(p.createdTime)}</td>
      <td><b>${esc(sym(p.symbol))}</b><span class="tag">${p.category === 'SPOT' ? '现货' : '合约'}</span></td>
      <td class="${p.posSide === 'long' ? 'pos' : 'neg'}">${SIDE[p.posSide] || '–'}</td>
      <td class="num">${fmt(p.closeTotalPos, 3)}</td>
      <td class="num">${p.openPriceAvg ? fmt(p.openPriceAvg, p.openPriceAvg > 100 ? 2 : 4) : '–'}</td>
      <td class="num">${fmt(p.closePriceAvg, p.closePriceAvg > 100 ? 2 : 4)}</td>
      <td class="num ${cls(p.netProfit)}">${pnl(p.netProfit)}</td>
      <td>${rvBadge(p)}</td>
    </tr>`).join('');
  $('#recentCloses').innerHTML = head + `<tbody>${rows || '<tr><td colspan="9" class="empty">暂无平仓记录</td></tr>'}</tbody>`;
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

  const assets = [...(d.accountAssets?.assets || [])].sort((a, b) => Number(b.usdValue || 0) - Number(a.usdValue || 0));
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

/* ---------- 平仓历史（含复盘列） ---------- */
function renderCloses() {
  const kw = ($('#closesFilter').value || '').trim().toUpperCase();
  const list = state.closes.filter((p) => !kw || String(p.symbol).includes(kw));
  $('#closesCount').textContent = `(${list.length})`;
  const head = `<thead><tr><th>平仓时间</th><th>币种</th><th>方向</th><th>数量</th><th>开仓均价</th><th>平仓均价</th><th>毛盈亏</th><th>手续费</th><th>资金费</th><th>净盈亏</th><th>开仓时间</th><th>复盘</th></tr></thead>`;
  const rows = list.map((p) => {
    const fee = -(Number(p.openFeeTotal || 0) + Number(p.closeFeeTotal || 0));
    const srcTag = p.importSource === 'csv' ? '<span class="tag">导入</span>'
      : p.importSource === 'gap-synth' ? '<span class="tag">归集</span>' : '';
    return `<tr>
      <td>${t(p.updatedTime)}</td>
      <td><b>${esc(sym(p.symbol))}</b>${srcTag}</td>
      <td class="${p.posSide === 'long' ? 'pos' : 'neg'}">${SIDE[p.posSide] || '–'}</td>
      <td class="num">${fmt(p.closeTotalPos, 3)}</td>
      <td class="num">${p.openPriceAvg ? fmt(p.openPriceAvg, p.openPriceAvg > 100 ? 2 : 4) : '–'}</td>
      <td class="num">${fmt(p.closePriceAvg, p.closePriceAvg > 100 ? 2 : 4)}</td>
      <td class="num ${cls(p.cumRealisedPnl)}">${pnl(p.cumRealisedPnl)}</td>
      <td class="num dim">${fmt(fee)}</td>
      <td class="num ${cls(p.totalFunding)}">${pnl(p.totalFunding)}</td>
      <td class="num ${cls(p.netProfit)}"><b>${pnl(p.netProfit)}</b></td>
      <td class="dim">${t(p.createdTime)}</td>
      <td>${rvBadge(p)}</td>
    </tr>`;
  }).join('');
  $('#closesTable').innerHTML = head + `<tbody>${rows || '<tr><td colspan="12" class="empty">无匹配记录</td></tr>'}</tbody>`;
}

/* ---------- 成交明细 ---------- */
function renderFills() {
  const kw = ($('#fillsFilter').value || '').trim().toUpperCase();
  const list = state.fills.filter((f) => !kw || String(f.symbol).includes(kw));
  $('#fillsCount').textContent = `(${list.length})`;
  const head = `<thead><tr><th>时间</th><th>币种</th><th>类别</th><th>方向</th><th>成交价</th><th>数量</th><th>成交额</th><th>手续费</th><th>平仓盈亏</th></tr></thead>`;
  const rows = list.map((f) => {
    const fee = Array.isArray(f.feeDetail)
      ? f.feeDetail.reduce((s, x) => s + Number(x.fee || 0), 0)
      : Number(f.fee || 0);
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

/* ---------- 充提记录 ---------- */
function renderTransfers() {
  const list = [...(state.data.transfers || [])].sort((a, b) => Number(b.time) - Number(a.time));
  $('#transfersCount').textContent = `(${list.length})`;
  const head = `<thead><tr><th>时间</th><th>类型</th><th>账户</th><th>币种</th><th>数量</th><th>状态</th><th>交易ID</th></tr></thead>`;
  const rows = list.map((x) => {
    const isWithdraw = /withdraw/i.test(x.type);
    const tx = x.txid ? `<a href="https://etherscan.io/tx/${esc(x.txid)}" target="_blank" rel="noopener" title="${esc(x.txid)}">${esc(x.txid.slice(0, 10))}…</a>` : '–';
    return `<tr>
      <td>${t(x.time)}</td>
      <td class="${isWithdraw ? 'neg' : 'pos'}">${isWithdraw ? '提现' : '充值'}</td>
      <td class="dim">${esc(x.account || '')}</td>
      <td><b>${esc(x.coin)}</b></td>
      <td class="num">${fmt(x.amount, 4)}</td>
      <td class="dim">${esc(x.status || '')}</td>
      <td class="num">${tx}</td>
    </tr>`;
  }).join('');
  $('#transfersTable').innerHTML = head + `<tbody>${rows || '<tr><td colspan="7" class="empty">暂无记录</td></tr>'}</tbody>`;
}

/* ---------- CSV 导出 ---------- */
function exportCSV(kind) {
  let rows = [];
  if (kind === 'positions') {
    rows = [['币种', '方向', '杠杆', '数量', '开仓均价', '标记价', '保证金', '浮动盈亏', '收益率%', '强平价', '开仓时间']]
      .concat((state.data.positions || []).map((p) => [p.symbol, SIDE[p.posSide], p.leverage, p.total, p.avgPrice, p.markPrice, p.positionBalance, p.unrealisedPnl, p.profitRate && (p.profitRate * 100).toFixed(2), p.liquidationPrice, tFull(p.createdTime)]));
  } else if (kind === 'closes') {
    rows = [['平仓时间', '币种', '方向', '数量', '开仓均价', '平仓均价', '毛盈亏', '净盈亏', '资金费', '开仓时间', '作者复盘']]
      .concat(state.closes.map((p) => [tFull(p.updatedTime), p.symbol, SIDE[p.posSide], p.closeTotalPos, p.openPriceAvg, p.closePriceAvg, p.cumRealisedPnl, p.netProfit, p.totalFunding, tFull(p.createdTime), state.reviews[rvKey(p)]?.text || '']));
  } else if (kind === 'fills') {
    rows = [['时间', '币种', '类别', '方向', '成交价', '数量', '成交额', '手续费', '平仓盈亏']]
      .concat(state.fills.map((f) => {
        const fee = Array.isArray(f.feeDetail) ? f.feeDetail.reduce((s, x) => s + Number(x.fee || 0), 0) : Number(f.fee || 0);
        return [tFull(f.createdTime), f.symbol, f.category, TRADE_SIDE[f.tradeSide] || f.side, f.execPrice, f.execQty, f.execValue, fee, f.execPnl];
      }));
  } else if (kind === 'orders') {
    rows = [['时间', '币种', '方向', '类型', '委托价', '委托量', '成交量', '成交均价', '状态']]
      .concat(state.orders.map((o) => [tFull(o.createdTime), o.symbol, o.side, o.orderType, o.price, o.qty, o.cumExecQty, o.avgPrice, ORDER_STATUS[o.orderStatus] || o.orderStatus]));
  } else if (kind === 'transfers') {
    rows = [['时间', '类型', '账户', '币种', '数量', '状态', '交易ID']]
      .concat((state.data.transfers || []).map((x) => [tFull(x.time), x.type, x.account, x.coin, x.amount, x.status, x.txid]));
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
  renderCharts();
  renderRecentCloses();
  renderPositions();
  renderCloses();
  renderFills();
  renderOrders();
  renderTransfers();
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
  const rv = e.target.closest('[data-rv]');
  if (rv) openReview(rv.dataset.rv);
});
['closes', 'fills', 'orders'].forEach((k) => {
  $(`#${k}Filter`).addEventListener('input', () => ({ closes: renderCloses, fills: renderFills, orders: renderOrders })[k]());
});
bindReviewModal();

if (window.REPO_URL) {
  const a = $('#repoLink');
  a.href = window.REPO_URL; a.hidden = false;
}

load();
setInterval(load, 5 * 60 * 1000);
