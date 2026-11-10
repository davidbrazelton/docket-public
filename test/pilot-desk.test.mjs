// The autopilot's own desk (#875), on a throwaway Docket (its own ports, state and desk list in a temp folder) whose
// Grok is the stand-in agent in test-fixtures/fake-acp-agent.mjs. The first time the switch goes on Docket makes the
// Autopilot desk and starts the pilot there; Save pilot refuses a session of any other desk; what waits on the
// autopilot's desk stays with the person while the rest is answered as the rules say; and a desk bound in Settings
// is used instead of making a second one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePorts, stopTree } from './free-port.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const [PORT, RUNNER_PORT, REMOTE_PORT] = await freePorts(3);
const URL_ = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-875-'));
const DATA = path.join(tmp, 'data'), CLIENTS = path.join(tmp, 'clients.json');
let server;

const api = async (p, body) => {
  const r = await fetch(URL_ + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
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
const events = async (id, desk) => (await api(`/api/sessions/${id}/events?client=${desk}`)).json.events;
const texts = async (id, desk) => (await events(id, desk)).filter((e) => e.k === 'text').map((e) => e.text);
// A pilot tool, called the way a session's tools reach Docket.
async function pilotTool(session, name, args = {}) {
  const r = await fetch(URL_ + '/api/tools/call', { method: 'POST', headers: { 'content-type': 'application/json', 'x-docket-token': fs.readFileSync(path.join(DATA, 'tool-token'), 'utf8').trim() },
    body: JSON.stringify({ session, name, args }) });
  const j = await r.json();
  return { error: !!j.isError, text: (j.content || []).map((c) => c.text).join('\n') || j.error || '' };
}
const start = async (desk, text, settings = {}) => (await api('/api/sessions', { client: desk, text, engine: 'grok', settings })).json;
const desks = () => JSON.parse(fs.readFileSync(CLIENTS, 'utf8'));

before(async () => {
  const c = { id: 't1', name: 'T1', home: path.join(tmp, 't1', 'claude-home'), folder: path.join(tmp, 't1', 'work'), grokHome: path.join(tmp, 't1', 'grok-home'), defaultEngine: 'grok' };
  for (const d of [c.home, c.folder, c.grokHome]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(CLIENTS, JSON.stringify([c]));
  fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify({ sessions: {}, updates: { minutes: 0 } }));
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_REMOTE_PORT: String(REMOTE_PORT), PORTAL_CLIENTS: CLIENTS,
      PORTAL_STATE: path.join(tmp, 'state.json'), PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: DATA,
      PORTAL_GROK_EXE: path.join(HERE, '..', 'test-fixtures', 'fake-acp-agent.mjs') },
  });
  await waitFor('the test Docket to start', async () => (await api('/api/clients?quick=1')).status === 200, 30000);
});

after(async () => {
  const runner = await fetch(`http://127.0.0.1:${RUNNER_PORT}/health`).then((r) => r.json()).catch(() => null);
  server?.kill();
  if (runner?.pid) stopTree(runner.pid);
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 });
});

test("the pilot is its own desk: made on first enable, the only desk a pilot can come from, and unanswerable by its own pilot", async () => {
  const work = await start('t1', 'hello', { permissionMode: 'bypassPermissions' });
  await waitFor('the work session to answer', async () => (await texts(work.id, 't1')).length);

  // Before the first enable there is no autopilot desk, so no session can be saved as the pilot.
  let v = (await api('/api/pilot')).json;
  assert.equal(v.on, false);
  assert.equal(v.pilotDesk, null);
  assert.deepEqual(v.sessions, []);
  let r = await api('/api/pilot', { session: work.id });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /no desk yet/);

  // The first enable makes the Autopilot desk, filled in as Add a desk does, and starts a Grok pilot there.
  r = await api('/api/pilot', { on: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  v = r.json;
  assert.equal(v.note, '');
  assert.equal(v.on, true);
  assert.equal(v.pilotDesk.name, 'Autopilot');
  const ap = desks().find((d) => d.id === v.pilotDesk.id);
  assert.deepEqual({ name: ap.name, home: ap.home, grokHome: ap.grokHome, folder: ap.folder, defaultEngine: ap.defaultEngine },
    { name: 'Autopilot', home: path.join(tmp, 'Autopilot', 'claude-home'), grokHome: path.join(tmp, 'grok_home', 'Autopilot'), folder: path.join(tmp, 'Autopilot'), defaultEngine: 'grok' });
  for (const d of [ap.home, ap.grokHome, ap.folder]) assert.ok(fs.existsSync(d), d);
  assert.deepEqual(fs.readdirSync(ap.home), [], 'its Claude home is made empty');
  assert.ok(v.session, 'a pilot session is set');
  assert.equal(v.desk, ap.id, 'the pilot session is on the Autopilot desk');
  assert.ok(v.flying);
  const pilot = v.session;
  assert.deepEqual(v.sessions.map((s) => [s.id, s.desk, s.brand]), [[pilot, 'Autopilot', 'grok']], 'Settings offers only sessions of the autopilot desk');
  await waitFor('the pilot to answer its brief', async () => (await texts(pilot, ap.id)).some((t) => /autopilot/.test(t)));
  // The rules stay one file on this computer.
  assert.deepEqual(fs.readdirSync(DATA).filter((f) => /rules/.test(f)), ['pilot-rules.json']);

  // Saving a session of another desk as the pilot is refused, with the reason, and the pilot stays as it was.
  r = await api('/api/pilot', { session: work.id });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /on the desk T1/);
  assert.match(r.json.error, /autopilot's own desk, Autopilot/);
  assert.equal((await api('/api/pilot')).json.session, pilot);

  // Something waits on each desk: a permission prompt on T1, and one on the Autopilot desk.
  const onT1 = await start('t1', 'CALL other__thing {}', { permissionMode: 'default' });
  const onAp = await start(ap.id, 'CALL other__thing {}', { permissionMode: 'default' });
  const waiting = await waitFor('both prompts to wait', async () => {
    const w = (await api('/api/pilot')).json.waiting.filter((i) => i.kind === 'permission');
    return w.length === 2 && w;
  });
  const t1Item = waiting.find((i) => i.desk === 'T1'), apItem = waiting.find((i) => i.desk === 'Autopilot');
  assert.equal(t1Item.may, 'allow');
  assert.equal(apItem.may, 'ask');
  assert.match(apItem.why, /autopilot's own desk/);

  // The pilot sees both, may not answer its own desk's, and still answers T1's as the rules allow.
  const pending = await pilotTool(pilot, 'pilot_pending', { all: true });
  assert.equal(pending.error, false, pending.text);
  assert.ok(pending.text.includes(t1Item.id) && pending.text.includes(apItem.id), pending.text);
  const own = await pilotTool(pilot, 'pilot_answer', { id: apItem.id, answer: 'allow' });
  assert.equal(own.error, true);
  assert.match(own.text, /autopilot's own desk: it stays with the person/);
  const deny = await pilotTool(pilot, 'pilot_answer', { id: apItem.id, answer: 'deny' });
  assert.equal(deny.error, true, 'not even a decline');
  const ok = await pilotTool(pilot, 'pilot_answer', { id: t1Item.id, answer: 'allow' });
  assert.equal(ok.error, false, ok.text);
  assert.match(ok.text, /answered by pilot/);
  const card = (await events(onT1.id, 't1')).find((e) => e.k === 'permission');
  assert.equal(card.by, 'pilot', 'the page shows answered by pilot');
  assert.ok((await api('/api/pilot')).json.waiting.some((i) => i.id === apItem.id), "the autopilot desk's prompt still waits on the person");
  const log = (await api('/api/pilot')).json.log;
  assert.ok(log.some((l) => l.id === apItem.id && !l.ok), 'the refusal is in the log');

  // With the switch off, the pilot tools refuse every call.
  await api('/api/pilot', { on: false });
  for (const [name, args] of [['pilot_pending', {}], ['pilot_answer', { id: apItem.id, answer: 'allow' }]]) {
    const off = await pilotTool(pilot, name, args);
    assert.equal(off.error, true);
    assert.match(off.text, /switched off/);
  }

  // Binding an existing desk instead: the pilot of the old desk is no longer the pilot, a session of the bound desk
  // can be saved, turning on starts the pilot there, and no second desk is made.
  r = await api('/api/pilot', { desk: 't1' });
  assert.equal(r.status, 200);
  assert.equal(r.json.pilotDesk.id, 't1');
  assert.equal(r.json.session, null);
  assert.match((await pilotTool(pilot, 'pilot_pending')).text, /No tool named pilot_pending|no longer the pilot/, 'the old pilot loses its tools');
  r = await api('/api/pilot', { session: work.id });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.session, work.id);
  await api('/api/pilot', { session: null });
  r = await api('/api/pilot', { on: true });
  assert.equal(r.status, 200);
  assert.equal(desks().length, 2, 'no second autopilot desk');
  assert.equal(r.json.desk, 't1');
  assert.notEqual(r.json.session, work.id, 'a working session is never made the pilot by itself');
  assert.equal(r.json.sessions.find((s) => s.id === r.json.session)?.brand, 'grok');
  // Its own desk's prompt (T1 now) stays with the person; the Autopilot desk's is now answerable by the rules.
  const now = (await api('/api/pilot')).json.waiting.find((i) => i.id === apItem.id);
  assert.equal(now.may, 'allow');
});
