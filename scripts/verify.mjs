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
const reviews = readJson('data/reviews.json');
const html = read('index.html');
const app = read('app.js');

assert(data?.meta?.generatedAtMs, 'data.json 缺少 meta.generatedAtMs');
assert(Array.isArray(data.historyPositions), 'data.json 缺少 historyPositions');
assert(Array.isArray(data.stats?.curve), 'data.json 缺少 stats.curve');
assert(Array.isArray(data.stats?.daily), 'data.json 缺少 stats.daily');
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
  const intervalNet = data.historyPositions
    .filter((p) => Number(p.updatedTime) >= cutoff)
    .reduce((sum, p) => sum + Number(p.netProfit || 0), 0);
  const before = data.stats.curve.filter((p) => Number(p.t) < cutoff).at(-1)?.cum || 0;
  const last = data.stats.curve.filter((p) => Number(p.t) >= cutoff).at(-1)?.cum;
  const chartNet = last == null ? 0 : Number(last) - Number(before);
  assert(Math.abs(intervalNet - chartNet) < 0.2, `${days} 天曲线与盈亏卡片口径不一致：${chartNet} / ${intervalNet}`);
}

for (const id of ['cards', 'curveChart', 'dailyChart', 'recentCloses', 'closesTable', 'reviewModal', 'rvSym', 'rvMeta', 'rvBody']) {
  assert(html.includes(`id="${id}"`), `index.html 缺少 #${id}`);
}
for (const token of ['data/reviews.json', 'renderCharts()', 'renderRecentCloses()', 'bindReviewModal()']) {
  assert(app.includes(token), `app.js 缺少关键逻辑：${token}`);
}

const testReviews = Object.values(reviews).filter((review) => /【?测试\d*】?/i.test(review.text));
assert(testReviews.length === 0, `仍有 ${testReviews.length} 条测试复盘，请上线前清理`);

console.log([
  '[verify] 通过',
  `平仓 ${data.historyPositions.length} 笔`,
  `曲线 ${data.stats.curve.length} 点`,
  `每日 ${data.stats.daily.length} 天`,
  `作者复盘 ${Object.keys(reviews).length} 条`,
].join(' · '));
