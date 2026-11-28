// A hook that forbids Bypass permissions (#1209): when a hook blocks a session in that mode, its chat gets a card that
// offers Auto, the desk is marked so the page makes Auto the desk's default for new sessions, and a session in another
// mode, or one switched to Auto, is never nudged. Runs a throwaway Docket (its own ports, state and company list in a
// temp folder) whose Claude Code is the stand-in in test-fixtures/fake-claude-hooks.mjs: its NOBYPASS hook blocks a
// prompt only while the session is in Bypass permissions, as a company hook reading permission_mode does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePorts, stopTree, TEST_DOCKET_ENV } from './free-port.mjs';
import { bypassBlocked } from '../hook-notes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const [PORT, RUNNER_PORT] = await freePorts(2);
const URL_ = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-1209-'));
let server;

const api = async (p, body) => {
  const r = await fetch(URL_ + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, fn, ms = 30000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > until) throw new Error('Timed out waiting for ' + what);
    await sleep(150);
  }
}
const view = (id) => api(`/api/sessions/${id}/events?client=t1`);
const idle = (id) => waitFor(`${id} to be idle`, async () => (await view(id)).session.status === 'idle');
const deskMark = async () => (await api('/api/clients?quick=1')).find((c) => c.id === 't1').bypassBlockedAt;
async function start(mode) {
  const id = (await api('/api/sessions', { client: 't1', text: 'hello', settings: { permissionMode: mode } })).id;
  await waitFor('the first reply', async () => (await view(id)).events.some((e) => e.k === 'text' && e.text.startsWith('got: hello')));
  await idle(id);
  return id;
}

before(async () => {
  const c = { id: 't1', name: 'T1', home: path.join(tmp, 'claude-home'), folder: path.join(tmp, 'work') };
  for (const d of [c.home, c.folder]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'clients.json'), JSON.stringify([c]));
  fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify({ sessions: {}, updates: { minutes: 0 } }));
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, ...TEST_DOCKET_ENV, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_CLIENTS: path.join(tmp, 'clients.json'),
      PORTAL_STATE: path.join(tmp, 'state.json'), PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: path.join(tmp, 'data'),
      PORTAL_CLAUDE_SDK_EXE: path.join(ROOT, 'test-fixtures', 'fake-claude-hooks.mjs') },
  });
  await waitFor('the test Docket to start', () => api('/api/clients?quick=1'));
});

after(async () => {
  const runner = await fetch(`http://127.0.0.1:${RUNNER_PORT}/health`).then((r) => r.json()).catch(() => null);
  server?.kill();
  if (runner?.pid) stopTree(runner.pid);
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 });
});

test('a hook block in Bypass permissions offers Auto and marks the desk; in Auto it gets through', async () => {
  // A session in another mode the same hook does not block, and a block for another reason there is not nudged.
  const other = await start('acceptEdits');
  await api(`/api/sessions/${other}/send?client=t1`, { text: 'NOBYPASS one' });
  await waitFor('the reply in Accept edits', async () => (await view(other)).events.some((e) => e.k === 'text' && e.text.startsWith('got: NOBYPASS one')));
  await idle(other);
  await api(`/api/sessions/${other}/send?client=t1`, { text: 'BLOCKME' });
  let v = await waitFor('the other block', async () => { const x = await view(other); return x.events.some((e) => e.k === 'error') && x.session.status === 'idle' ? x : null; });
  assert.ok(!v.events.some((e) => e.k === 'bypass'), 'no nudge outside Bypass permissions');
  assert.equal(await deskMark(), 0, 'the desk is not marked');

  // In Bypass permissions: the block's error, then one card offering Auto, and the desk is marked.
  const id = await start('bypassPermissions');
  await api(`/api/sessions/${id}/send?client=t1`, { text: 'NOBYPASS two' });
  v = await waitFor('the bypass block', async () => { const x = await view(id); return x.events.some((e) => e.k === 'bypass') && x.session.status === 'idle' ? x : null; });
  assert.match(v.events.find((e) => e.k === 'error').text, /^A UserPromptSubmit hook blocked this message: Bypass permissions mode is not allowed by policy XYZ-7/);
  assert.equal(v.events.filter((e) => e.k === 'bypass').length, 1);
  assert.ok(v.events.findIndex((e) => e.k === 'bypass') > v.events.findIndex((e) => e.k === 'error'), 'the card comes after the error');
  const mark = await deskMark();
  assert.ok(mark > 0, 'the desk is marked for the page');
  assert.equal(v.session.settings.permissionMode, 'bypassPermissions', 'Docket does not change the session by itself');
  assert.equal((await view(other)).session.settings.permissionMode, 'acceptEdits', 'nor any other session');

  // Switched to Auto (what the card's button does), the same message gets through and nothing new is offered.
  const r = await api(`/api/sessions/${id}/settings?client=t1`, { permissionMode: 'auto' });
  assert.equal(r.settings.permissionMode, 'auto');
  await api(`/api/sessions/${id}/send?client=t1`, { text: 'NOBYPASS three' });
  v = await waitFor('the reply in Auto', async () => { const x = await view(id); return x.events.some((e) => e.k === 'text' && e.text.startsWith('got: NOBYPASS three')) && x.session.status === 'idle' ? x : null; });
  assert.equal(v.events.filter((e) => e.k === 'bypass').length, 1, 'no second card');
  assert.ok(!v.session.lastError, 'the turn that got through clears the problem');
  assert.equal(await deskMark(), mark);

  // Sessions started with no mode given (as Docket starts children, autopilot runs and schedules) start in Auto on the
  // marked desk, in Bypass again once the person keeps Bypass from the card, and in Auto once they pick Auto (#1220).
  const modeOfNew = async () => {
    const n = (await api('/api/sessions', { client: 't1', text: 'hello' })).id;
    return (await view(n)).session.settings.permissionMode;
  };
  assert.equal(await modeOfNew(), 'auto');
  assert.deepEqual(await api('/api/clients/bypass-keep', { client: 't1', keep: true }), { ok: true });
  assert.equal((await api('/api/clients?quick=1')).find((c) => c.id === 't1').bypassKept, true, 'the page sees the Keep');
  assert.equal(await modeOfNew(), 'bypassPermissions');
  await api('/api/clients/bypass-keep', { client: 't1', keep: false });
  assert.equal(await modeOfNew(), 'auto');
});

// The page's part, read out of index.html between its markers: what a desk's mark does to its default.
const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const from = page.indexOf("// ---------- a desk's defaults for new sessions"), to = page.indexOf("// end of a desk's defaults");
assert.ok(from > 0 && to > from, "the desk defaults part of index.html has moved or lost its markers");
function pageWith(saved = {}) {
  const kept = new Map(Object.entries(saved).map(([k, v]) => [k, JSON.stringify(v)])), told = [], posts = [];
  const store = { get: (k, d) => (kept.has(k) ? JSON.parse(kept.get(k)) : d), set: (k, v) => kept.set(k, JSON.stringify(v)) };
  const S = { client: 'd1', clients: [{ id: 'd1', name: 'Acme' }, { id: 'd2', name: 'Other' }] };
  const api = async (p, body) => { posts.push([p, body]); return {}; };
  const fns = new Function('store', 'S', 'renderComposerBar', 'tell', 'api', page.slice(from, to) + '\nreturn { deskDefaults, bypassFlip, bypassKeep, bypassFlips };')(store, S, () => {}, (t) => told.push(t), api);
  return { ...fns, store, told, posts };
}

test("the desk's default goes from Bypass to Auto once per block, only on that desk, and can be kept", () => {
  const p = pageWith();
  p.bypassFlips([{ id: 'd1', bypassBlockedAt: 100 }, { id: 'd2', bypassBlockedAt: 0 }]);
  assert.equal(p.deskDefaults('d1').permissionMode, 'auto', 'the blocked desk starts new sessions in Auto');
  assert.equal(p.deskDefaults('d2').permissionMode, 'bypassPermissions', 'another desk is left alone');
  assert.equal(p.store.get('bypassFlipped@d1'), true, 'the card says Docket did it');
  assert.equal(p.told.length, 1);
  assert.match(p.told[0], /new sessions on Acme now start in Auto/);
  p.bypassFlip('d1', 100);
  assert.equal(p.told.length, 1, 'the same block is not applied twice');

  // Keep Bypass: back to Bypass, and a later block leaves it.
  p.bypassKeep('d1');
  assert.equal(p.deskDefaults('d1').permissionMode, 'bypassPermissions');
  assert.equal(p.store.get('bypassFlipped@d1'), false);
  assert.deepEqual(p.posts, [['/api/clients/bypass-keep', { client: 'd1', keep: true }]], 'the server is told, for the sessions it starts');
  p.bypassFlip('d1', 200);
  assert.equal(p.deskDefaults('d1').permissionMode, 'bypassPermissions', 'the person chose Bypass');

  // A desk whose default is already another mode keeps it, along with its other defaults.
  const q = pageWith({ 'defaults:d1': { permissionMode: 'acceptEdits', model: 'opus', effort: 'high' } });
  q.bypassFlip('d1', 100);
  assert.deepEqual(q.deskDefaults('d1'), { permissionMode: 'acceptEdits', model: 'opus', effort: 'high' });
  const w = pageWith({ 'defaults:d1': { permissionMode: 'bypassPermissions', model: 'opus', effort: 'high', modelPicked: true } });
  w.bypassFlip('d1', 100);
  assert.deepEqual(w.deskDefaults('d1'), { permissionMode: 'auto', model: 'opus', effort: 'high', modelPicked: true }, 'only the mode changes');

  // A Keep chosen before the server learned of them (#1220) is told to it once the desk list shows it does not know.
  const k = pageWith({ 'bypassKept@d1': true });
  k.bypassFlips([{ id: 'd1', bypassBlockedAt: 100, bypassKept: false }, { id: 'd2', bypassBlockedAt: 0 }]);
  assert.deepEqual(k.posts, [['/api/clients/bypass-keep', { client: 'd1', keep: true }]]);
  k.posts.length = 0;
  k.bypassFlips([{ id: 'd1', bypassBlockedAt: 100, bypassKept: true }]);
  assert.deepEqual(k.posts, []);
});

test('the page shows the card and listens for the mark', () => {
  assert.match(page, /case 'bypass': \{/);
  assert.match(page, /data-bypass-auto\$\{tip\('bypass-auto'\)\}>Switch this session to Auto</);
  assert.match(page, /await changeSetting\('permissionMode', 'auto'\)/, "the card's button switches the open session");
  assert.match(page, /m\.t === 'bypass-blocked'\) \{\s+bypassFlip\(m\.client, m\.at\);/);
  assert.match(page, /bypassFlips\(full\);/, 'a page opened later catches up from the desk list');
});

test('bypassBlocked: a blocked prompt in Bypass permissions, or a denied step that names the mode', () => {
  assert.equal(bypassBlocked({ mode: 'bypassPermissions', prompt: true }), true);
  assert.equal(bypassBlocked({ mode: 'auto', prompt: true }), false);
  assert.equal(bypassBlocked({ engine: 'codex', mode: 'bypassPermissions', prompt: true }), false, 'Claude Code hooks only');
  assert.equal(bypassBlocked({ mode: 'bypassPermissions', reason: 'Bash is off by company policy' }), false, 'a step turned down for itself');
  assert.equal(bypassBlocked({ mode: 'bypassPermissions', reason: 'Not allowed in bypassPermissions mode' }), true);
  assert.equal(bypassBlocked({ mode: 'bypassPermissions', reason: 'Do not run with --dangerously-skip-permissions' }), true);
});
