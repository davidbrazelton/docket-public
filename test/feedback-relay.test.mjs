// The feedback relay (#1035, relay/feedback/relay.mjs): it files a suggestion as a labelled GitHub Issue, holds the
// limits nobody can get round from a computer (3 a day per address, 3 per install ID, 30 from everyone), passes
// GitHub's refusals back without claiming success, and counts only what went. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handle, cleanRequest, issueFor, ipKey, utcDay, PER_SENDER, PER_DAY, MAX_MESSAGE, LABEL } from '../relay/feedback/relay.mjs';

const memStore = () => { const m = new Map(); return { m, get: async (k) => (m.has(k) ? String(m.get(k)) : null), set: async (k, n) => { m.set(k, n); } }; };
const now = new Date('2026-11-14T12:00:00Z');
const TOKEN = 'test-token-not-real';
// A pretend GitHub that files every Issue, numbering them, and keeps what it was sent.
function github() {
  const got = [];
  const f = async (url, opt) => { got.push({ url, opt, body: JSON.parse(opt.body) }); return { status: 201, json: async () => ({ number: got.length, html_url: `https://github.com/o/r/issues/${got.length}` }) }; };
  return { got, f };
}
const send = (store, f, { ip = '203.0.113.5', install = '0a1b2c3d', message = 'Let me pin a session', at = now } = {}) =>
  handle({ method: 'POST', body: { install, message, name: 'Dana', details: '| Field | Value |\n|---|---|\n| install | ' + install + ' |' }, ip, store, token: TOKEN, repo: 'o/r', fetch: f, now: at });

test('a suggestion is filed as an Issue labelled suggestion, with the token, and says its number', async () => {
  const store = memStore(), gh = github();
  const r = await send(store, gh.f);
  assert.equal(r.status, 201); assert.equal(r.body.ok, true); assert.equal(r.body.number, 1); assert.equal(r.body.left, 2);
  const { url, opt, body } = gh.got[0];
  assert.equal(url, 'https://api.github.com/repos/o/r/issues'); assert.equal(opt.method, 'POST');
  assert.equal(opt.headers.authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(body.labels, [LABEL]); assert.equal(LABEL, 'suggestion');
  assert.equal(body.title, 'Suggestion: Let me pin a session');
  assert.match(body.body, /^Let me pin a session\n\n— Dana\n\n\| Field \| Value \|/);
  assert.match(body.body, /\| install \| 0a1b2c3d \|/);
  assert.ok(!JSON.stringify(r.body).includes('github.com'), 'the private repo\'s address is not handed back');
});

test('the 4th send in a day from one address is refused with the reason, whatever install ID it carries', async () => {
  const store = memStore(), gh = github();
  for (let i = 0; i < PER_SENDER; i++) assert.equal((await send(store, gh.f, { install: `0000000${i}` })).status, 201, `send ${i + 1}`);
  const r = await send(store, gh.f, { install: '0000000f' });
  assert.equal(r.status, 429); assert.equal(r.body.ok, false); assert.equal(r.body.kind, 'sender');
  assert.match(r.body.message, /3 suggestions have already come from this network today/);
  assert.equal(gh.got.length, PER_SENDER, 'GitHub was not asked');
  assert.equal((await send(store, gh.f, { ip: '198.51.100.7', install: '0000000e' })).status, 201, 'another address still sends');
  assert.equal((await send(store, gh.f, { install: '0000000d', at: new Date('2026-11-15T00:00:01Z') })).status, 201, 'the next UTC day starts again');
});

test('the 4th send in a day from one install ID is refused, whatever address it comes from', async () => {
  const store = memStore(), gh = github();
  for (let i = 0; i < PER_SENDER; i++) assert.equal((await send(store, gh.f, { ip: `192.0.2.${i}` })).status, 201);
  const r = await send(store, gh.f, { ip: '192.0.2.99' });
  assert.equal(r.status, 429); assert.equal(r.body.kind, 'install'); assert.match(r.body.message, /This Docket has already sent 3 suggestions today/);
});

test('after 30 from everyone in a day, nobody else is taken until the next day', async () => {
  const store = memStore(), gh = github();
  for (let i = 0; i < PER_DAY; i++) assert.equal((await send(store, gh.f, { ip: `10.0.${i}.1`, install: (0x10000000 + i).toString(16) })).status, 201, `send ${i + 1}`);
  const r = await send(store, gh.f, { ip: '10.9.9.9', install: 'ffffffff' });
  assert.equal(r.status, 429); assert.equal(r.body.kind, 'total'); assert.match(r.body.message, /30 suggestions from everyone today/);
  assert.equal(gh.got.length, PER_DAY);
  assert.equal((await send(store, gh.f, { ip: '10.9.9.9', install: 'ffffffff', at: new Date('2026-11-15T08:00:00Z') })).status, 201);
});

test('GitHub refusals (401, 404, 422) are passed back with their code, never as sent, and do not use up a send', async () => {
  for (const code of [401, 404, 422]) {
    const store = memStore();
    const r = await send(store, async () => ({ status: code, json: async () => ({ message: 'Bad credentials' }) }));
    assert.equal(r.status, 502, code); assert.equal(r.body.ok, false); assert.equal(r.body.kind, 'refused'); assert.equal(r.body.code, code);
    assert.match(r.body.message, new RegExp(`error ${code}`)); assert.match(r.body.message, /GitHub said: "Bad credentials"/);
    assert.ok([...store.m.values()].every((n) => n === 0), 'the count was given back');
  }
  const ok200 = await send(memStore(), async () => ({ status: 200, json: async () => ({}) }));
  assert.equal(ok200.body.ok, false, 'only 201 Created counts as filed');
});

test('when GitHub cannot be reached, it says so and the send is not counted', async () => {
  const store = memStore();
  const r = await send(store, async () => { const e = new TypeError('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; });
  assert.equal(r.status, 502); assert.equal(r.body.kind, 'unreachable'); assert.match(r.body.message, /could not reach GitHub \(ENOTFOUND\)/);
  assert.ok([...store.m.values()].every((n) => n === 0));
});

test('empty, too long or malformed reports are refused before anything is counted or sent', async () => {
  const store = memStore(), gh = github();
  for (const message of ['', '   ', 'x'.repeat(MAX_MESSAGE + 1)]) {
    const r = await send(store, gh.f, { message });
    assert.equal(r.status, 400); assert.equal(r.body.kind, 'invalid');
  }
  assert.match(cleanRequest({ message: 'hi', install: 'C:\\Users' }).error, /install ID/);
  assert.match(cleanRequest(null).error, /not a report/);
  assert.equal((await handle({ method: 'GET', store, token: TOKEN, repo: 'o/r' })).status, 405);
  assert.equal((await handle({ method: 'POST', body: { message: 'hi', install: '0a1b2c3d' }, store, token: '', repo: 'o/r' })).status, 503, 'no token set: nothing goes');
  assert.equal(gh.got.length, 0); assert.equal(store.m.size, 0);
});

test('addresses are never stored as they are, and mentions do not ping anyone in the repo', () => {
  const k = ipKey('203.0.113.5', '2026-11-14');
  assert.match(k, /^[0-9a-f]{24}$/); assert.notEqual(k, ipKey('203.0.113.5', '2026-11-15'));
  assert.equal(utcDay(now), '2026-11-14');
  assert.equal(issueFor({ message: 'ask @someone about it\n@other too', name: '', details: '' }).body.split('\n\n')[0], 'ask someone about it\nother too');
});

test('the relay holds no token in its code: it reads it from the host', () => {
  for (const f of ['../relay/feedback/relay.mjs', '../relay/feedback/netlify/functions/feedback.mjs']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(!/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/.test(src), `a GitHub token is in ${f}`);
  }
  assert.match(fs.readFileSync(new URL('../relay/feedback/netlify/functions/feedback.mjs', import.meta.url), 'utf8'), /process\.env\.FEEDBACK_GITHUB_TOKEN/);
});
