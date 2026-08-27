#!/usr/bin/env node
/**
 * 作者复盘本地工具。
 *
 * 启动时先同步远端 main，保证编辑器能看到最新平仓；保存时再次同步、校验交易键，
 * 然后只提交 data/reviews.json。任何脏工作区、rebase 冲突或推送失败都会明确报错，
 * 不再吞掉错误继续执行。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8931;
const PROXY = 'http://127.0.0.1:7897';
const MAX_REVIEW_LENGTH = 5000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const GIT_CONFIG = ['-c', `http.proxy=${PROXY}`, '-c', `https.proxy=${PROXY}`];
const git = (args, options = {}) => execFileSync('git', [...GIT_CONFIG, ...args], {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: 'pipe',
  timeout: 45_000,
  ...options,
});

const json = (res, status, body) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
};

const errorText = (error) => {
  const detail = error?.stderr || error?.stdout || error?.message || String(error);
  return String(detail).replace(/\s+/g, ' ').trim().slice(0, 300);
};

const posKey = (p) => `${p.symbol}|${p.posSide || ''}|${Math.floor(Number(p.updatedTime || p.createdTime || 0) / 1000)}`;

function assertMainBranch() {
  const branch = git(['branch', '--show-current']).trim();
  if (branch !== 'main') throw new Error(`当前分支是 ${branch || '游离 HEAD'}，请切回 main 后重试`);
}

function assertCleanWorktree() {
  const dirty = git(['status', '--porcelain', '--untracked-files=all']).trim();
  if (dirty) {
    const files = dirty.split(/\r?\n/).slice(0, 5).join('；');
    throw new Error(`项目存在未提交改动，已停止自动同步：${files}`);
  }
}

function abortRebaseIfNeeded() {
  if (!fs.existsSync(path.join(ROOT, '.git', 'rebase-merge')) && !fs.existsSync(path.join(ROOT, '.git', 'rebase-apply'))) return;
  try { git(['rebase', '--abort']); } catch { /* 保留原始错误 */ }
}

function pullLatest() {
  assertMainBranch();
  assertCleanWorktree();
  try {
    // rebase 中 ours=远端基线、theirs=正在重放的本地提交；点评冲突时保留作者刚写的版本。
    git(['pull', '--rebase', '-X', 'theirs', 'origin', 'main']);
  } catch (error) {
    abortRebaseIfNeeded();
    throw new Error(`同步 GitHub 最新数据失败：${errorText(error)}`);
  }
}

function readJson(relativePath, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8')); }
  catch { return fallback; }
}

function currentPosition(key) {
  const data = readJson(path.join('data', 'data.json'), { historyPositions: [] });
  return (data.historyPositions || []).find((p) => posKey(p) === key);
}

function syncInfo(message) {
  const data = readJson(path.join('data', 'data.json'), {});
  return {
    ok: true,
    message,
    generatedAtMs: data.meta?.generatedAtMs || null,
    closes: data.historyPositions?.length || 0,
  };
}

function refreshFromRemote() {
  pullLatest();
  return syncInfo('已同步 GitHub 最新交易数据');
}

function saveReview({ key, text, symbol }) {
  if (!key || typeof text !== 'string' || text.length > MAX_REVIEW_LENGTH) throw new Error('参数不合法');

  pullLatest();
  const position = currentPosition(key);
  if (!position) throw new Error('这笔平仓已不在最新数据中，请刷新页面后重新选择');

  const file = path.join(ROOT, 'data', 'reviews.json');
  const reviews = readJson(path.join('data', 'reviews.json'), {});
  const cleanText = text.trim();
  const before = reviews[key]?.text || '';

  if (cleanText === before) return syncInfo('内容没有变化，无需提交');

  if (cleanText) {
    reviews[key] = { text: cleanText, time: Date.now(), symbol: symbol || position.symbol };
  } else {
    delete reviews[key];
  }
  fs.writeFileSync(file, `${JSON.stringify(reviews, null, 2)}\n`);

  const action = cleanText ? '作者复盘' : '删除复盘';
  try {
    git(['add', '--', 'data/reviews.json']);
    git(['commit', '-m', `${action}：${position.symbol}`]);
    try {
      git(['push', 'origin', 'HEAD:main']);
    } catch {
      // 处理保存期间恰逢定时同步提交的竞态；只重试一次。
      try {
        git(['pull', '--rebase', '-X', 'theirs', 'origin', 'main']);
      } catch (error) {
        abortRebaseIfNeeded();
        throw error;
      }
      git(['push', 'origin', 'HEAD:main']);
    }
  } catch (error) {
    throw new Error(`点评已保存在本地，但 GitHub 推送失败：${errorText(error)}`);
  }

  return syncInfo(cleanText ? '已推送，线上约 1–2 分钟后更新' : '复盘已删除并推送');
}

function isTrustedLocalRequest(req) {
  const host = String(req.headers.host || '').toLowerCase();
  const origin = String(req.headers.origin || '').toLowerCase();
  const validHost = host === `127.0.0.1:${PORT}` || host === `localhost:${PORT}`;
  const validOrigin = !origin || origin === `http://127.0.0.1:${PORT}` || origin === `http://localhost:${PORT}`;
  return validHost && validOrigin;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 20_000) reject(new Error('请求内容过大'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith('/api/')) {
    if (!isTrustedLocalRequest(req)) { json(res, 403, { ok: false, message: '仅允许本机编辑器访问' }); return; }
    if (req.method !== 'POST') { json(res, 405, { ok: false, message: 'Method Not Allowed' }); return; }

    try {
      if (url.pathname === '/api/refresh') {
        json(res, 200, refreshFromRemote());
        return;
      }
      if (url.pathname === '/api/save') {
        const body = JSON.parse(await readBody(req));
        json(res, 200, saveReview(body));
        return;
      }
      json(res, 404, { ok: false, message: '接口不存在' });
    } catch (error) {
      json(res, 409, { ok: false, message: errorText(error) });
    }
    return;
  }

  let file = null;
  if (url.pathname === '/' || url.pathname === '/admin.html') file = path.join(ROOT, 'admin.html');
  else if (url.pathname === '/data/data.json') file = path.join(ROOT, 'data', 'data.json');
  else if (url.pathname === '/data/reviews.json') file = path.join(ROOT, 'data', 'reviews.json');
  else { res.writeHead(404).end('404'); return; }

  try {
    const buf = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'",
    });
    res.end(buf);
  } catch { res.writeHead(404).end('404'); }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`点评工具已启动：http://localhost:${PORT}/admin.html  （Ctrl+C 退出）`);
  try {
    const info = refreshFromRemote();
    console.log(`[点评] ${info.message}，共 ${info.closes} 笔平仓`);
  } catch (error) {
    console.warn(`[点评] 启动同步未完成：${errorText(error)}`);
    console.warn('[点评] 编辑器仍会打开；处理提示后可点击页面上的“同步最新交易”。');
  }
  if (process.env.REVIEW_NO_OPEN !== '1') {
    const command = process.env.ComSpec || 'cmd.exe';
    const open = spawn(command, ['/c', 'start', '', `http://localhost:${PORT}/admin.html`], { detached: true, stdio: 'ignore' });
    open.unref();
  }
});
