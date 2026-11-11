// Builds data.json: every openclaw/openclaw PR merged in the last 8 days, in the
// same slim shape app.js caches. The page uses it so a first visit needs only a
// small search for merges newer than the snapshot. 8 days covers "this week"
// (Monday 00:00 local) for a viewer in any time zone while the snapshot is fresh.
//
// Usage: GITHUB_TOKEN=... node scripts/build-data.mjs <output-path>
import fs from 'node:fs';

const windowMs = 8 * 86400000;
const dayMs = 86400000;
// Authenticated search allows 30 requests per minute.
const spacingMs = 2100;
const token = process.env.GITHUB_TOKEN;
const output = process.argv[2];
if (!token || !output) {
  console.error('Usage: GITHUB_TOKEN=... node scripts/build-data.mjs <output-path>');
  process.exit(2);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let lastRequest = 0;

async function search(start, end, page) {
  const q = `repo:openclaw/openclaw is:pr is:merged merged:${start.toISOString()}..${end.toISOString()}`;
  const url = new URL('https://api.github.com/search/issues');
  url.search = new URLSearchParams({ q, per_page: '100', page: String(page), sort: 'created', order: 'asc' });
  for (let attempt = 0; attempt < 3; attempt++) {
    const delay = spacingMs - (Date.now() - lastRequest);
    if (delay > 0) await sleep(delay);
    lastRequest = Date.now();
    const response = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }
    });
    if (response.status === 403 || response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      const wait = retryAfter > 0 ? retryAfter * 1000 : reset > 0 ? Math.max(0, reset * 1000 - Date.now()) + 1000 : 60000;
      console.warn(`Rate limited; waiting ${Math.ceil(wait / 1000)}s`);
      await sleep(Math.min(wait, 120000));
      continue;
    }
    if (!response.ok) throw new Error(`GitHub search failed (${response.status}): ${await response.text()}`);
    const data = await response.json();
    if (data.incomplete_results) throw new Error(`GitHub returned incomplete results for ${q} page ${page}`);
    return data;
  }
  throw new Error(`GitHub search stayed rate limited for ${q} page ${page}`);
}

// Same shape as slim() in app.js; the page deduplicates by id.
function slim(pr) {
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    html_url: pr.html_url,
    author_association: pr.author_association,
    pull_request: { merged_at: pr.pull_request?.merged_at },
    user: pr.user && { login: pr.user.login, avatar_url: pr.user.avatar_url, type: pr.user.type },
    labels: (pr.labels || []).map(label => ({ name: label.name }))
  };
}

// GitHub search returns at most 1,000 results per query, so split busy ranges.
async function collectRange(start, end, found) {
  const first = await search(start, end, 1);
  if (first.total_count > 1000) {
    if (end - start < 3600000) throw new Error('Too many PRs in one hour for a complete GitHub Search result.');
    const middle = new Date((start.getTime() + end.getTime()) / 2);
    await collectRange(start, middle, found);
    await collectRange(middle, end, found);
    return;
  }
  for (const pr of first.items) found.set(pr.id, slim(pr));
  for (let page = 2; page <= Math.ceil(first.total_count / 100); page++) {
    for (const pr of (await search(start, end, page)).items) found.set(pr.id, slim(pr));
  }
}

const generatedAt = new Date();
const from = new Date(generatedAt.getTime() - windowMs);
const found = new Map();
for (let start = from; start < generatedAt; start = new Date(start.getTime() + dayMs)) {
  await collectRange(start, new Date(Math.min(start.getTime() + dayMs, generatedAt.getTime())), found);
}
const prs = [...found.values()].sort((a, b) => a.pull_request.merged_at.localeCompare(b.pull_request.merged_at));
fs.writeFileSync(output, JSON.stringify({ from: from.toISOString(), generatedAt: generatedAt.toISOString(), prs }));
console.log(`Wrote ${prs.length} PRs merged since ${from.toISOString()} to ${output} (${Math.round(fs.statSync(output).size / 1024)} KB)`);
