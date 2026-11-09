// A parent may start a child on a lower gear for a brief it has worked out (#801). The child stays on that gear
// (it never picks or raises its own), each of its reports names the gear so the parent checks it harder, and only
// the parent raises it. Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parentHeldGear, belowTop } from '../gears.mjs';
import { shiftUpFor } from '../shift-up.mjs';
import { reportIsNews, lowGearNote } from '../reports.mjs';
import { freePorts } from './free-port.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const shift = { model: 'shift' };

test('a child is held on a lower gear only when its parent chose it and it is below the top', () => {
  assert.equal(parentHeldGear({ settings: shift, brand: 'claude', gear: 'claude-sonnet-5-5', gearBy: 'parent' }).key, 'sonnet');
  assert.equal(parentHeldGear({ settings: shift, brand: 'grok', gear: 'grok-4.7-build-fast', gearBy: 'parent' }).key, 'fast');
  assert.equal(parentHeldGear({ settings: shift, brand: 'claude', gear: 'claude-opus-5-5', gearBy: 'parent' }), null, 'on its top gear: nothing to hold');
  assert.equal(parentHeldGear({ settings: shift, brand: 'claude', gear: 'claude-sonnet-5-5' }), null, 'a gear it inherited or shifted to itself');
  assert.equal(parentHeldGear({ settings: { model: 'claude-sonnet-5-5' }, brand: 'claude', gear: 'claude-sonnet-5-5', gearBy: 'parent' }), null, 'a model the user chose');
  assert.equal(parentHeldGear({ settings: shift, brand: 'claude', gear: 'nonsense', gearBy: 'parent' }), null);
  assert.equal(belowTop('claude', 'haiku'), true);
  assert.equal(belowTop('claude', 'claude-sonnet-5-5'), true);
  assert.equal(belowTop('claude', 'opus'), false);
  assert.equal(belowTop('codex', 'astra'), false);
  assert.equal(belowTop('claude', 'nonsense'), false);
});

test('Docket does not raise a held child before an edit or commit, but still before it coordinates a plan', () => {
  const at = { settings: shift, brand: 'claude', gear: 'claude-sonnet-5-5' };
  assert.equal(shiftUpFor({ ...at, tool: 'Edit', input: {}, held: true }), null);
  assert.equal(shiftUpFor({ ...at, tool: 'Bash', input: { command: 'git commit -m x' }, held: true }), null);
  assert.equal(shiftUpFor({ ...at, tool: 'mcp__portal__plan_create', input: {}, held: true }).to.key, 'opus');
  assert.equal(shiftUpFor({ ...at, tool: 'Edit', input: {} }).to.key, 'opus', 'not held: raised as before');
});

test('a held child\'s report is never news, and says which gear it ran on and how to resend', () => {
  for (const cause of ['ack', 'agreed', 'quiet']) assert.equal(reportIsNews({ cause, lowGear: true }), false, cause);
  assert.equal(reportIsNews({ cause: 'quiet' }), true);
  const note = lowGearNote('Sonnet 5.5', 'opus');
  assert.match(note, /ran on Sonnet 5\.5, the lower gear you chose/);
  assert.match(note, /diff, test output or files/);
  assert.match(note, /send_to_session and gear set to opus/);
  assert.equal(lowGearNote('', 'opus'), '');
});

test('the rules say when a lower start gear fits and what the parent then does', () => {
  const rules = fs.readFileSync(path.join(ROOT, 'prompts', 'sessions.md'), 'utf8');
  assert.match(rules, /fully worked out the brief/);
  assert.match(rules, /Open-ended work \(investigating, designing, debugging an unknown cause\) starts on your gear/);
  assert.match(rules, /never picks or raises its own/);
  assert.match(rules, /`gear` = top gear/);
  const held = fs.readFileSync(path.join(ROOT, 'prompts', 'optional', 'parent-gear.md'), 'utf8');
  assert.match(held, /Stay on \{start\}/);
  assert.match(held, /Only your parent raises you/);
});

// ---------- in a throwaway Docket, with the stand-in Grok agent (fixtures/fake-acp-agent.mjs) ----------
const [PORT, RUNNER_PORT] = await freePorts(2);
const URL_ = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-801-'));
let server;
const api = async (p, body) => {
  const r = await fetch(URL_ + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, fn, ms = 20000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > until) throw new Error('Timed out waiting for ' + what);
    await sleep(150);
  }
}
const view = (id) => api(`/api/sessions/${id}/events?client=t1`);
const texts = async (id) => (await view(id)).events.filter((e) => e.k === 'text').map((e) => e.text);
const idle = (id) => waitFor(`${id} to be idle`, async () => (await view(id)).session.status === 'idle');
async function say(id, text, expect) {
  await idle(id);
  const n = (await texts(id)).length;
  await api(`/api/sessions/${id}/send?client=t1`, { text });
  const reply = await waitFor(`the reply in ${id}`, async () => (await texts(id)).slice(n).find((t) => t.startsWith(expect)));
  await idle(id);
  return reply;
}

before(async () => {
  const c = { id: 't1', name: 'T1', home: path.join(tmp, 'claude-home'), folder: path.join(tmp, 'work'), grokHome: path.join(tmp, 'grok-home'), defaultEngine: 'grok' };
  for (const d of [c.home, c.folder, c.grokHome]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'clients.json'), JSON.stringify([c]));
  fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify({ sessions: {}, updates: { minutes: 0 } }));
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_CLIENTS: path.join(tmp, 'clients.json'),
      PORTAL_REPORT_DEBOUNCE: '{"quietMs":0,"maxMs":0}', PORTAL_STATE: path.join(tmp, 'state.json'), PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: path.join(tmp, 'data'),
      PORTAL_GROK_EXE: path.join(HERE, 'fixtures', 'fake-acp-agent.mjs') },
  });
  await waitFor('the test Docket to start', () => api('/api/clients?quick=1'), 30000);
});

after(async () => {
  const runner = await fetch(`http://127.0.0.1:${RUNNER_PORT}/health`).then((r) => r.json()).catch(() => null);
  server?.kill();
  if (runner?.pid) try { process.kill(runner.pid); } catch {}
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
});

test('a child started on a lower gear stays there and its report names the gear; one on the parent\'s gear does not', async () => {
  const parent = (await api('/api/sessions', { client: 't1', text: 'hello parent', engine: 'grok', settings: { permissionMode: 'bypassPermissions' } })).id;
  await waitFor('the parent to answer', async () => (await texts(parent)).some((t) => t.startsWith('got: hello parent')));

  const low = { title: 'Low kid', prompt: 'CALL portal__shift_gear {"to":"full","reason":"I think I need it"}', initiation: 'user_asked', start_gear: 'fast' };
  const started = await say(parent, `CALL portal__start_session ${JSON.stringify(low)}`, 'called portal__start_session: Started session');
  assert.match(started, /in Shift on Grok 4\.7 Build Fast/);
  assert.match(started, /It stays on Grok 4\.7 Build Fast, the lower gear you chose/);
  assert.match(started, /gear set to full/);

  const report = await waitFor('the low kid report', async () => (await texts(parent)).find((t) => t.includes('"Low kid"') && t.includes('finished a turn')), 30000);
  assert.match(report, /It ran on Grok 4\.7 Build Fast, the lower gear you chose for it/);
  assert.match(report, /send_to_session and gear set to full/);
  assert.match(report, /Not shifted: your parent session chose Grok 4\.7 Build Fast/, 'the child could not raise its own gear');
  await idle(parent);

  const same = { title: 'Same kid', prompt: 'do the kid work', initiation: 'user_asked' };
  const plain = await say(parent, `CALL portal__start_session ${JSON.stringify(same)}`, 'called portal__start_session: Started session');
  assert.doesNotMatch(plain, /lower gear you chose/);
  const report2 = await waitFor('the same-gear kid report', async () => (await texts(parent)).find((t) => t.includes('"Same kid"') && t.includes('finished a turn')), 30000);
  assert.doesNotMatch(report2, /lower gear you chose/);
});
