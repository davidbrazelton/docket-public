// Anonymous usage stats (#848): what is counted and sent, that off (the switch or DOCKET_NO_USAGE) keeps and sends
// nothing, that the counter keeps only the fields it knows, and that README.md lists every field. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { USAGE_URL, FIELDS, COUNTS, usageOn, offByEnv, usageRecord, count, totals, payload, sendDue, send, platformName, dayOf, SEND_EVERY_MS } from '../usage.mjs';
import { cleanPing, cleanInstall } from '../usage-worker/src/clean.js';

const T0 = Date.parse('2026-11-11T10:00:00Z');
const env = {};

test('counts keep only known keys, per UTC day, and a new day keeps the old one to send', () => {
  const state = {};
  assert.equal(count(state, 'sessions.claude', { env, now: T0 }), true);
  count(state, 'sessions.claude', { env, now: T0 });
  count(state, 'gears.opus', { env, now: T0 });
  assert.equal(count(state, 'secret.thing', { env, now: T0 }), false);
  assert.deepEqual(state.usage.counts, { 'sessions.claude': 2, 'gears.opus': 1 });
  assert.match(state.usage.id, /^[0-9a-f-]{36}$/);
  assert.equal(state.usage.firstSeen, '2026-11-11');
  count(state, 'plans', { env, now: T0 + 86400000 });
  assert.deepEqual(state.usage.last, { day: '2026-11-11', counts: { 'sessions.claude': 2, 'gears.opus': 1 } });
  assert.deepEqual(state.usage.counts, { plans: 1 });
  assert.equal(state.usage.firstSeen, '2026-11-11');
});

test('off by the switch or DOCKET_NO_USAGE: nothing counted, nothing due', () => {
  for (const v of ['1', 'true', 'yes']) assert.equal(offByEnv({ DOCKET_NO_USAGE: v }), true);
  for (const v of ['', '0', 'false', 'off', undefined]) assert.equal(offByEnv({ DOCKET_NO_USAGE: v }), false);
  const s = { usage: { off: true, noticeDone: true } };
  assert.equal(usageOn(s, env), false);
  assert.equal(count(s, 'plans', { env, now: T0 }), false);
  assert.equal(sendDue(s, { env, now: T0 }), false);
  const e = { usage: { noticeDone: true } };
  assert.equal(sendDue(e, { env, now: T0 }), true);
  assert.equal(sendDue(e, { env: { DOCKET_NO_USAGE: '1' }, now: T0 }), false);
  assert.equal(count(e, 'plans', { env: { DOCKET_NO_USAGE: '1' }, now: T0 }), false);
});

test('nothing is sent until the window listing every field is answered, then every few hours', () => {
  assert.equal(sendDue({}, { env, now: T0 }), false);
  assert.equal(sendDue({ usage: { noticeAt: T0 - 86400000 } }, { env, now: T0 }), false);
  assert.equal(sendDue({ usage: { noticeDone: true, sentAt: T0 - 1000 } }, { env, now: T0 }), false);
  assert.equal(sendDue({ usage: { noticeDone: true, sentAt: T0 - SEND_EVERY_MS } }, { env, now: T0 }), true);
  assert.equal(sendDue({ usage: { noticeDone: true, sentAt: T0 - 1000, last: { day: 'x', counts: {} } } }, { env, now: T0 }), true);
});

test('the report carries counts and totals only, never a name or path, and the counter keeps it whole', () => {
  const state = { pageSettings: { theme: 'dark' }, updates: { minutes: 0 }, remoteControl: { on: true } };
  const u = usageRecord(state, T0);
  for (const k of ['sessions.claude', 'sessions.grok', 'children', 'shiftSessions', 'plans', 'ask', 'handoff', 'pages.usage', 'pages.plans', 'gears.sonnet']) count(state, k, { env, now: T0 });
  const clients = [{ name: 'Acme Roofing', home: 'C:/Users/bob/acme', engine: 'claude' }, { name: 'Initech', grokHome: '/Users/bob/g', engine: 'grok', remote: { url: 'x' } }];
  const t = totals({ clients, brandOf: (c) => c.engine, groups: 4, schedules: 2, signinDesks: 1, state });
  const body = payload({ u, day: u.day, counts: u.counts, version: '1.191.0', platform: platformName('win32'), totals: t });
  const text = JSON.stringify(body);
  for (const secret of ['Acme', 'Initech', 'Users', 'bob']) assert.ok(!text.includes(secret), secret);
  assert.deepEqual(Object.keys(body).filter((k) => k !== 'v').sort(), FIELDS.map(([k]) => k).sort());
  assert.deepEqual(body.desks, { total: 2, claude: 1, codex: 0, grok: 1 });
  assert.equal(body.theme, 'dark'); assert.equal(body.updateMode, 'off'); assert.equal(body.remoteControl, true);
  const row = cleanPing(body, T0);
  assert.equal(row.install_id, u.id); assert.equal(row.platform, 'windows'); assert.equal(row.sessions_claude, 1); assert.equal(row.sessions_grok, 1);
  assert.equal(row.desks, 2); assert.equal(row.groups_count, 4); assert.equal(row.remote_control, 1); assert.equal(row.gears, '{"sonnet":1}');
  assert.equal(row.pages_usage, 1); assert.equal(row.signin_desks, 1);
});

test('the counter refuses anything it does not know, and caps numbers', () => {
  const ok = { v: 1, id: '12345678-1234-1234-1234-123456789abc', version: '1.0.0', platform: 'mac', firstSeen: '2026-11-10', day: '2026-11-11' };
  assert.ok(cleanPing(ok, T0));
  for (const bad of [{ ...ok, v: 2 }, { ...ok, id: 'C:/Users/bob' }, { ...ok, platform: 'Acme' }, { ...ok, version: 'Acme Roofing' }, { ...ok, day: '2026-10-01' }, { ...ok, firstSeen: '2026-11-12' }, null, 'x'])
    assert.equal(cleanPing(bad, T0), null);
  const row = cleanPing({ ...ok, plans: 1e9, ask: -3, children: 'Acme', theme: 'Acme', updateMode: 'x', gears: { opus: 2, acme: 5 }, extra: 'Acme' }, T0);
  assert.equal(row.plans, 100000); assert.equal(row.ask, 0); assert.equal(row.children, 0); assert.equal(row.theme, 'system'); assert.equal(row.update_mode, 'auto');
  assert.equal(row.gears, '{"opus":2}'); assert.ok(!JSON.stringify(row).includes('Acme'));
  assert.deepEqual(cleanInstall({ platform: 'windows' }), { platform: 'windows' });
  assert.equal(cleanInstall({ platform: 'Acme' }), null);
});

test('a send that fails or hangs is quiet', async () => {
  assert.equal(await send('http://x', {}, { fetch: async () => { throw new Error('down'); } }), false);
  assert.equal(await send('http://x', {}, { fetch: async () => ({ ok: false }) }), false);
  assert.equal(await send('http://x', {}, { fetch: async () => ({ ok: true }) }), true);
});

test('README.md lists every field and how to turn it off; the installers send to the same counter', () => {
  for (const readme of ['README.md', 'publish/README.md']) {
    const text = fs.readFileSync(new URL('../' + readme, import.meta.url), 'utf8');
    const section = text.slice(text.indexOf('## Usage stats'));
    assert.ok(text.includes('## Usage stats'), readme);
    for (const [k] of FIELDS) assert.ok(section.includes('`' + k + '`'), `${readme} lists ${k}`);
    assert.ok(section.includes('DOCKET_NO_USAGE'), readme);
  }
  for (const f of ['install-windows.ps1', 'install-mac.sh']) {
    const text = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.ok(text.includes(USAGE_URL + '/v1/install'), f);
    assert.ok(text.includes('DOCKET_NO_USAGE'), f);
  }
  assert.ok(COUNTS.every((k) => /^[a-z.A-Z]+$/.test(k)));
  assert.equal(dayOf(T0), '2026-11-11');
});
