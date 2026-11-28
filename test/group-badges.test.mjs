// Tests for group header count badges and for schedules counting once in the waiting total (#1256). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const slice = (from, to) => { const a = page.indexOf(from), b = page.indexOf(to, a); assert.ok(a > 0 && b > a, `${from} in index.html has moved`); return page.slice(a, b); };

const inBackground = (s) => s.live && s.status === 'idle' && (s.runningTasks > 0 || s.background);
const needsYou = (s) => s.live ? (s.status === 'requires_action' || (s.unread && s.status === 'idle')) : !!s.waiting;
const { groupKinds, groupBadges } = new Function('needsYou', 'inBackground', 'signingIn',
  slice('const GROUP_KINDS', 'const dotTip') + '\nreturn { groupKinds, groupBadges };')(needsYou, inBackground, (s) => !!s.signin);

test('each row counts as one of four kinds', () => {
  const n = groupKinds([
    { live: true, status: 'running' }, { live: true, status: 'idle', runningTasks: 1 },
    { live: true, status: 'idle', unread: true }, { live: false, waiting: true }, { live: true, status: 'idle', lastError: { text: 'x' } },
    { live: true, status: 'idle' }, { live: true, status: 'idle', resting: true },
    { live: false }, { live: false, midReply: true },
  ]);
  assert.deepEqual(n, { w: 2, n: 3, i: 2, e: 2 });
});

test('badges come in order, leave out zero kinds and are named on hover', () => {
  const html = groupBadges({ w: 2, n: 7, i: 0, e: 4 });
  assert.match(html, /title="2 working, 7 waiting on you, 4 done"/);
  assert.deepEqual([...html.matchAll(/class="badge (g\w)"/g)].map((m) => m[1]), ['gw', 'gn', 'ge']);
  assert.equal(groupBadges({ w: 0, n: 0, i: 0, e: 0 }), '');
});

test('the header has no "(n)" after the name', () => {
  assert.match(page, /<span class="gname">\$\{esc\(name\)\}<\/span>\$\{groupCostHtml\(gid, name\)\}\$\{groupBadges\(n\)\}/);
});

test('the group cost is the amount alone, and nothing when nothing was spent', () => {
  const body = slice('function groupCostHtml', '// Seconds as');
  assert.ok(!body.includes('class="per"'));
  assert.match(body, /if \(!n\) return '';/);
});

test('a schedule adds one to the waiting count, as its newest run', () => {
  const runTime = (s) => Date.parse(s.runAt || '') || +new Date(s.createdAt || 0);
  const S = { live: {}, inbox: {}, history: { a: [] } };
  for (let i = 1; i <= 21; i++) S.history.a.push({ id: `r${i}`, scheduleId: 'daily', runAt: `2026-11-${String(i).padStart(2, '0')}T06:00:00Z`, waiting: true });
  S.history.a.push({ id: 'x', waiting: true }, { id: 'y', waiting: false }, { id: 'z', waiting: true, archived: true });
  const waitingCount = new Function('S', 'needsYou', 'runTime', slice('function waitingCount', '// The desks with a button') + '\nreturn waitingCount;')(S, needsYou, runTime);
  assert.equal(waitingCount('a'), 2);
  S.history.a[20].waiting = false; // the newest run was read: the schedule no longer counts
  assert.equal(waitingCount('a'), 1);
  S.live.r21 = { id: 'r21', client: 'a', scheduleId: 'daily', runAt: '2026-11-21T06:00:00Z', live: true, status: 'idle', unread: true };
  assert.equal(waitingCount('a'), 2, 'a live newest run counts by needsYou');
});
