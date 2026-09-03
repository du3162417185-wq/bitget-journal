#!/usr/bin/env node
/** 项目静态自检：不联网、不改数据。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const readJson = (file) => JSON.parse(read(file));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const posKey = (p) => `${p.symbol}|${p.posSide || ''}|${Math.floor(Number(p.updatedTime || p.createdTime || 0) / 1000)}`;

const data = readJson('data/data.json');
const version = readJson('data/version.json');
const reviews = readJson('data/reviews.json');
const html = read('index.html');
const app = read('app.js');
const syncWorkflow = read('.github/workflows/sync.yml');
const deployWorkflow = read('.github/workflows/deploy.yml');
const scheduler = read('scheduler/worker.mjs');

assert(data?.meta?.generatedAtMs, 'data.json 缺少 meta.generatedAtMs');
assert(Number(version?.generatedAtMs) === Number(data.meta.generatedAtMs), 'version.json 与 data.json 版本不一致');
assert(version?.generatedAt === data.meta.generatedAt, 'version.json 与 data.json 生成时间不一致');
assert(Array.isArray(data.historyPositions), 'data.json 缺少 historyPositions');
assert(Array.isArray(data.stats?.curve), 'data.json 缺少 stats.curve');
assert(Array.isArray(data.stats?.daily), 'data.json 缺少 stats.daily');
assert(Array.isArray(data.stats?.events), 'data.json 缺少 stats.events');
assert(data.stats?.accounting?.method === 'fill-exec-pnl', '统计尚未切换到逐笔成交口径');
assert(Array.isArray(data.financialRecords), 'data.json 缺少 financialRecords');
const publicFinancialKeys = new Set(['id', 'type', 'symbol', 'coin', 'amount', 'ts']);
for (const record of data.financialRecords) {
  assert(/(?:SETTLE_FEE|FUNDING).*USER_(?:IN|OUT)$/i.test(String(record.type || '')), `混入非资金费流水：${record.type}`);
  assert(Object.keys(record).every((key) => publicFinancialKeys.has(key)), `资金费流水含多余公开字段：${Object.keys(record).join(',')}`);
}
assert(reviews && typeof reviews === 'object' && !Array.isArray(reviews), 'reviews.json 顶层必须是对象');

const positions = new Map();
for (const position of data.historyPositions) {
  const key = posKey(position);
  assert(!positions.has(key), `平仓唯一键重复：${key}`);
  positions.set(key, position);
}

for (const [key, review] of Object.entries(reviews)) {
  assert(positions.has(key), `复盘找不到对应平仓：${key}`);
  assert(typeof review.text === 'string' && review.text.trim(), `复盘正文为空：${key}`);
  assert(review.text.length <= 5000, `复盘超过 5000 字：${key}`);
  assert(Number.isFinite(Number(review.time)), `复盘时间不合法：${key}`);
}

for (const days of [30, 60, 90]) {
  const cutoff = Date.now() - days * 864e5;
  const intervalNet = data.stats.events
    .filter((e) => Number(e.t) >= cutoff)
    .reduce((sum, e) => sum + Number(e.net || 0), 0);
  const before = data.stats.curve.filter((p) => Number(p.t) < cutoff).at(-1)?.cum || 0;
  const last = data.stats.curve.filter((p) => Number(p.t) >= cutoff).at(-1)?.cum;
  const chartNet = last == null ? 0 : Number(last) - Number(before);
  assert(Math.abs(intervalNet - chartNet) < 0.2, `${days} 天逐笔曲线与盈亏卡片口径不一致：${chartNet} / ${intervalNet}`);
}

const june3Start = Date.parse('2026-06-03T00:00:00+08:00');
const june4Start = Date.parse('2026-06-04T00:00:00+08:00');
const june3ClosePnl = data.fills
  .filter((f) => f.category !== 'SPOT' && Number(f.createdTime) >= june3Start && Number(f.createdTime) < june4Start)
  .reduce((sum, f) => sum + Number(f.execPnl || 0), 0);
const june3Daily = Number(data.stats.daily.find((d) => d.d === '2026-06-03')?.pnl || 0);
assert(june3ClosePnl > 300 && june3ClosePnl < 400, `6月3日逐笔平仓毛盈亏异常：${june3ClosePnl}`);
assert(june3Daily > 300 && june3Daily < 400, `6月3日每日逐笔净盈亏仍疑似整仓归集：${june3Daily}`);

for (const id of ['cards', 'curveChart', 'dailyChart', 'recentCloses', 'closesTable', 'reviewModal', 'rvSym', 'rvMeta', 'rvBody']) {
  assert(html.includes(`id="${id}"`), `index.html 缺少 #${id}`);
}
for (const token of ['data/reviews.json', 'data/version.json', 'renderCharts()', 'renderRecentCloses()', 'bindReviewModal()', 'setInterval(checkForUpdate, 60 * 1000)']) {
  assert(app.includes(token), `app.js 缺少关键逻辑：${token}`);
}
assert(!app.includes('setInterval(load, 5 * 60 * 1000)'), 'app.js 仍在无条件重复下载完整数据');

/* 自动化安全边界：外部调度器只能触发固定工作流，Bitget 凭据只留在 GitHub Secrets。 */
assert(syncWorkflow.includes("inputs.persist == true"), 'sync.yml 缺少快速刷新/长期归档分流');
assert(syncWorkflow.includes('persist-credentials: false'), 'sync.yml checkout 仍持久保存仓库令牌');
assert(syncWorkflow.includes('npm ci --ignore-scripts'), 'sync.yml 依赖安装未禁用生命周期脚本');
assert(!scheduler.match(/BITGET_(?:KEY|SECRET|PASSPHRASE)/), 'Cloudflare 调度器不得接触 Bitget 凭据');
assert(scheduler.includes('/actions/workflows/sync.yml/dispatches'), '调度器未锁定 sync.yml');
assert(scheduler.includes("ref: 'main'"), '调度器未锁定 main 分支');
assert(scheduler.includes('env.GITHUB_ACTIONS_TOKEN'), '调度器缺少 Worker Secret 读取');
for (const [name, workflow] of [['sync.yml', syncWorkflow], ['deploy.yml', deployWorkflow]]) {
  const uses = [...workflow.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((m) => m[1]);
  assert(uses.length > 0, `${name} 没有可验证的 Action 引用`);
  assert(uses.every((ref) => /@[0-9a-f]{40}$/.test(ref)), `${name} 存在未固定到完整 SHA 的 Action`);
}

const testReviews = Object.values(reviews).filter((review) => /【?测试\d*】?/i.test(review.text));
assert(testReviews.length === 0, `仍有 ${testReviews.length} 条测试复盘，请上线前清理`);

/* 用假的网络层验证调度输入；不联网、不读取真实凭据。 */
const originalFetch = globalThis.fetch;
const dispatchCalls = [];
try {
  globalThis.fetch = async (url, options) => {
    dispatchCalls.push({ url, options, body: JSON.parse(options.body) });
    return { ok: true, status: 204 };
  };
  const worker = (await import('../scheduler/worker.mjs')).default;
  for (const iso of ['2026-09-04T01:17:00Z', '2026-09-04T01:22:00Z']) {
    let pending;
    worker.scheduled(
      { scheduledTime: Date.parse(iso) },
      { GITHUB_ACTIONS_TOKEN: 'test-token-not-a-secret' },
      { waitUntil: (promise) => { pending = promise; } },
    );
    await pending;
  }
} finally {
  globalThis.fetch = originalFetch;
}
assert(dispatchCalls.length === 2, 'Cloudflare 调度器未按预期发起两次测试触发');
assert(dispatchCalls[0].body.inputs.persist === 'true', '每小时 17 分触发未持久化归档');
assert(dispatchCalls[1].body.inputs.persist === 'false', '普通 5 分钟触发不应提交归档');
assert(dispatchCalls.every((call) => call.body.ref === 'main'), '调度器触发了非 main 分支');

console.log([
  '[verify] 通过',
  `平仓 ${data.historyPositions.length} 笔`,
  `曲线 ${data.stats.curve.length} 点`,
  `每日 ${data.stats.daily.length} 天`,
  `逐笔平/减仓 ${data.stats.closesCount} 次`,
  `作者复盘 ${Object.keys(reviews).length} 条`,
].join(' · '));
