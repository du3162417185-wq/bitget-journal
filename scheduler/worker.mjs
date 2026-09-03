/**
 * Cloudflare Cron 只负责触发 GitHub Actions，不接触 Bitget 凭据或交易数据。
 * GITHUB_ACTIONS_TOKEN 必须存为 Worker Secret，且只授予本仓库 Actions: write。
 */
const DISPATCH_URL = 'https://api.github.com/repos/du3162417185-wq/bitget-journal/actions/workflows/sync.yml/dispatches';

async function dispatchSync(env, scheduledTime) {
  if (!env.GITHUB_ACTIONS_TOKEN) throw new Error('缺少 GITHUB_ACTIONS_TOKEN Worker Secret');

  const minute = new Date(scheduledTime).getUTCMinutes();
  const persist = minute === 17; // 每小时只提交一次长期归档，其余运行只更新线上快照。
  const response = await fetch(DISPATCH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_ACTIONS_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'bitget-journal-scheduler',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: 'main', inputs: { persist: String(persist) } }),
  });

  if (!response.ok) throw new Error(`GitHub workflow dispatch HTTP ${response.status}`);
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(dispatchSync(env, controller.scheduledTime));
  },
};
