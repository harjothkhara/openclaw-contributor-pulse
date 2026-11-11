const $ = selector => document.querySelector(selector);
const cacheKey = 'openclaw-pulse-v1';
const excluded = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
// OpenClaw Foundation staff and core maintainers listed at openclaw.org/people
// on 2026-11-10, plus founder/steward @steipete.
const knownMaintainers = new Set([
  'steipete', 'vincentkoc', 'obviyus', 'joshavant', 'jalehman',
  'patrick-erichsen', 'vyctorbrzezowski',
  'eleqtrizit', 'amknight', 'altaywtf', 'solvely-colin', 'drobison00',
  'efpiva', 'galiniliev', 'giodl73-repo', 'iwhatsskill', 'jacobtomlinson',
  'jesse-merhi', 'kevinslin', 'lanzhi-lee', 'mcaxtr', 'mbelinky',
  'brokemac79', 'hxy91819', 'pash-openai', 'spectorian', 'omarshahine',
  'osolmaz', 'pgondhi987', 'sallyom', 'sjf', 'scoootscooob',
  'shanselman', 'takhoffman', 'vacinc', 'sliverp', 'momothemage'
]);
let lastRequest = 0;

function status(message, error = false) {
  $('#status').textContent = message;
  $('#status').classList.toggle('error', error);
}

function weekStart(now) {
  const date = new Date(now);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  date.setHours(0, 0, 0, 0);
  return date;
}

function nextDay(day) {
  const date = new Date(day);
  date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

async function search(start, end, page) {
  const delay = 6500 - (Date.now() - lastRequest);
  if (lastRequest && delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  const q = `repo:openclaw/openclaw is:pr is:merged merged:${start.toISOString()}..${end.toISOString()}`;
  const url = new URL('https://api.github.com/search/issues');
  url.search = new URLSearchParams({ q, per_page: '100', page: String(page), sort: 'updated', order: 'desc' });
  lastRequest = Date.now();
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (response.status === 403 || response.status === 429) throw new Error('GitHub’s API rate limit was reached. Try again later.');
  if (!response.ok) throw new Error(`GitHub search failed (${response.status}).`);
  const data = await response.json();
  if (data.incomplete_results) throw new Error('GitHub returned incomplete results. Try again later.');
  return data;
}

async function collectRange(start, end, found) {
  const first = await search(start, end, 1);
  if (first.total_count > 1000) {
    if (end - start < 3600000) throw new Error('Too many PRs in one hour for a complete GitHub Search result.');
    const middle = new Date((start.getTime() + end.getTime()) / 2);
    await collectRange(start, middle, found);
    await collectRange(middle, end, found);
    return;
  }
  for (const pr of first.items) found.set(pr.id, pr);
  status(`Checking merges… ${found.size} PRs loaded`);
  for (let page = 2; page <= Math.ceil(first.total_count / 100); page++) {
    const data = await search(start, end, page);
    for (const pr of data.items) found.set(pr.id, pr);
    status(`Checking merges… ${found.size} PRs loaded`);
  }
}

async function loadWeek(start, now) {
  const found = new Map();
  for (let day = new Date(start); day < now; day = nextDay(day)) {
    await collectRange(day, new Date(Math.min(nextDay(day).getTime(), now.getTime())), found);
  }
  return [...found.values()].filter(pr => {
    const merged = pr.pull_request?.merged_at;
    return merged && new Date(merged) >= start && new Date(merged) <= now;
  });
}

const labels = pr => (pr.labels || []).map(label => label.name);
const priority = pr => ['P0', 'P1', 'P2', 'P3'].find(p => labels(pr).some(label => label.toUpperCase() === p)) || 'Unlabeled';
const rating = pr => labels(pr).find(label => /^rating\s*:/i.test(label)) || 'Unlabeled';

function type(pr) {
  const names = labels(pr).map(name => name.toLowerCase());
  if (names.some(name => /^(bug|type:\s*bug|kind\/bug)$/.test(name))) return 'Bug';
  if (names.some(name => /^(feature|enhancement|type:\s*feature)$/.test(name))) return 'Feature';
  const prefix = pr.title.match(/^(fix|feat|docs|test|refactor|chore|improve)(?:\([^)]*\))?:/i)?.[1]?.toLowerCase();
  if (prefix) return ({ fix: 'Likely bug fix', feat: 'Likely feature', docs: 'Docs', test: 'Tests', refactor: 'Refactor', chore: 'Maintenance', improve: 'Improvement' })[prefix];
  if (names.includes('docs') || names.includes('documentation')) return 'Docs';
  return 'Unlabeled';
}

const areaRules = [
  ['iOS', /\bios\b|iphone|ipad|swiftui/i],
  ['Android', /\bandroid\b|\bkotlin\b/i],
  ['macOS / desktop', /\bmacos\b|\bdesktop\b|\bmenu bar\b|\bmenubar\b|\belectron\b/i],
  ['Web / UI', /\bweb\b|\bui\b|\bfrontend\b|\bbrowser\b|\bdashboard\b/i],
  ['Gateway', /\bgateway\b|\bserver\b|\bstreaming\b/i],
  ['Channels', /\btelegram\b|\bdiscord\b|\bslack\b|\bwhatsapp\b|\bchannel\b/i],
  ['Agents', /\bagents?\b|\bskills?\b/i],
  ['CLI', /\bcli\b|\bterminal\b|\btui\b/i],
  ['Docs', /\bdocs?\b|\bdocumentation\b/i],
  ['CI / release', /\bci\b|\brelease\b|\bworkflow\b|\bbuild\b/i]
];
function areas(pr) {
  const relevantLabels = labels(pr).filter(label => !/^(docs|documentation|scripts|agents)$/i.test(label));
  const text = `${pr.title} ${relevantLabels.join(' ')}`;
  const hits = areaRules.filter(([, re]) => re.test(text)).map(([name]) => name);
  return hits.length ? hits : ['Other / core'];
}

function element(parent, tag, content, className) {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  parent.append(node);
  return node;
}
function chip(parent, value) { element(parent, 'span', value, `chip ${/^P[0-3](\b| ·)/.test(value) ? value.slice(0, 2).toLowerCase() : ''}`); }
function frequencies(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function contributorCard(group, index, start) {
  const card = document.createElement('details');
  card.className = 'contributor';
  card.open = index < 3;
  const summary = document.createElement('summary');
  element(summary, 'span', `#${index + 1}`, 'rank');
  const avatar = element(summary, 'img', '', 'avatar');
  avatar.src = group.user.avatar_url;
  avatar.alt = '';
  avatar.loading = 'lazy';
  const person = element(summary, 'div', '', 'person');
  element(person, 'strong', `@${group.user.login}`);
  element(person, 'small', frequencies(group.prs.flatMap(areas)).slice(0, 2).map(([name]) => name).join(' · '));
  const total = element(summary, 'div', '', 'total');
  element(total, 'strong', String(group.prs.length));
  element(total, 'small', group.prs.length === 1 ? 'merged PR' : 'merged PRs');
  element(summary, 'span', '⌄', 'chevron');
  card.append(summary);
  const details = element(card, 'div', '', 'details');
  const row = element(details, 'div', '', 'detail-row');
  const priorities = element(row, 'div', '', 'detail-block');
  element(priorities, 'h3', 'Priority');
  const priorityChips = element(priorities, 'div', '', 'chips');
  for (const [name, count] of frequencies(group.prs.map(priority))) chip(priorityChips, `${name} · ${count}`);
  const areaBlock = element(row, 'div', '', 'detail-block');
  element(areaBlock, 'h3', 'Areas touched');
  const areaChips = element(areaBlock, 'div', '', 'chips');
  for (const [name, count] of frequencies(group.prs.flatMap(areas)).slice(0, 5)) chip(areaChips, `${name} · ${count}`);
  const links = element(details, 'div', '', 'pr-links');
  for (const pr of group.prs.slice(0, 8)) {
    const item = element(links, 'div', '', 'pr-item');
    const link = element(item, 'a', `#${pr.number} ${pr.title}`);
    link.href = pr.html_url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const tags = element(item, 'div', '', 'pr-labels');
    [priority(pr), type(pr), rating(pr), ...areas(pr).slice(0, 2)].forEach(value => chip(tags, value));
  }
  const q = `repo:openclaw/openclaw is:pr is:merged author:${group.user.login} merged:>=${start.toISOString()}`;
  const more = element(details, 'a', 'View all this week on GitHub ↗', 'more-link');
  more.href = `https://github.com/search?q=${encodeURIComponent(q)}&type=pullrequests`;
  more.target = '_blank';
  more.rel = 'noopener noreferrer';
  return card;
}

function render(prs, start, checkedAt) {
  const isMaintainer = pr => excluded.has(pr.author_association) || knownMaintainers.has(pr.user?.login?.toLowerCase());
  const maintainerCount = prs.filter(isMaintainer).length;
  const external = prs.filter(pr => pr.user && !isMaintainer(pr) && pr.user.type !== 'Bot' && !/\[bot\]$/i.test(pr.user.login));
  const grouped = new Map();
  for (const pr of external) {
    const key = pr.user.login.toLowerCase();
    if (!grouped.has(key)) grouped.set(key, { user: pr.user, prs: [] });
    grouped.get(key).prs.push(pr);
  }
  const ranked = [...grouped.values()].sort((a, b) => b.prs.length - a.prs.length || a.user.login.localeCompare(b.user.login));
  $('#external-count').textContent = external.length.toLocaleString();
  $('#contributor-count').textContent = ranked.length.toLocaleString();
  $('#maintainer-count').textContent = maintainerCount.toLocaleString();
  $('#checked-at').textContent = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(checkedAt));
  const q = `repo:openclaw/openclaw is:pr is:merged merged:>=${start.toISOString()}`;
  $('#all-prs-link').href = `https://github.com/search?q=${encodeURIComponent(q)}&type=pullrequests`;
  $('#leaderboard').replaceChildren();
  if (!ranked.length) element($('#leaderboard'), 'p', 'No external merged PRs yet this week.', 'empty');
  else ranked.forEach((group, index) => $('#leaderboard').append(contributorCard(group, index, start)));
  $('#results').hidden = false;
}

async function refresh(force = false) {
  const now = new Date();
  const start = weekStart(now);
  $('#week-label').textContent = `Week of ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(start)} · your time zone`;
  $('#refresh').disabled = true;
  try {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch { /* Storage is optional. */ }
    if (!force && cached?.start === start.toISOString() && Date.now() - cached.checkedAt < 20 * 60000) {
      render(cached.prs, start, cached.checkedAt);
      status('Showing a recent snapshot. Refresh for the latest merges.');
      return;
    }
    status('Checking this week’s OpenClaw merges…');
    const prs = await loadWeek(start, now);
    const checkedAt = Date.now();
    render(prs, start, checkedAt);
    try { localStorage.setItem(cacheKey, JSON.stringify({ start: start.toISOString(), checkedAt, prs })); } catch { /* Storage is optional. */ }
    status(`Complete: ${prs.length.toLocaleString()} merged PRs checked across the week.`);
  } catch (error) {
    status(error.message || 'Could not load GitHub data.', true);
  } finally {
    $('#refresh').disabled = false;
  }
}

$('#refresh').addEventListener('click', () => refresh(true));
refresh();
