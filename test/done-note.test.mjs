// A parent's "checked and agree" to a child that already said it is ready to close goes into the child's chat as a
// note and runs no turn (#755); to a child whose last turn did not say so, it starts a turn as before. Runs a
// throwaway Docket (its own ports, state and company list in a temp folder) whose Grok is the stand-in agent in
// fixtures/fake-acp-agent.mjs, which calls Docket's tools when told to.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePorts } from './free-port.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const [PORT, RUNNER_PORT] = await freePorts(2);
const URL_ = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-755-'));
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
const events = async (id) => (await api(`/api/sessions/${id}/events?client=t1`)).events;
const texts = async (id) => (await events(id)).filter((e) => e.k === 'text').map((e) => e.text);
const turns = async (id) => (await events(id)).filter((e) => e.k === 'result').length;
const idle = (id) => waitFor(`${id} to be idle`, async () => (await api(`/api/sessions/${id}/events?client=t1`)).session.status === 'idle');
// One turn of a session calling a portal tool; returns the tool's answer.
async function call(id, tool, args) {
  await idle(id);
  const before = (await texts(id)).length;
  await api(`/api/sessions/${id}/send?client=t1`, { text: `CALL portal__${tool} ${JSON.stringify(args)}` });
  const said = await waitFor(`${tool} from ${id}`, async () => (await texts(id)).slice(before).find((t) => t.startsWith(`called portal__${tool}:`)));
  await idle(id);
  return said.slice(`called portal__${tool}: `.length).replace(/ \[end of reply\]$/, '');
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

test('agree-done to a child already marked done is a note, no turn; otherwise a turn', async () => {
  const parent = (await api('/api/sessions', { client: 't1', text: 'hello parent', engine: 'grok', settings: { permissionMode: 'bypassPermissions' } })).id;
  await waitFor('the parent to answer', async () => (await texts(parent)).some((t) => t.startsWith('got: hello parent')));
  const kid = (await api('/api/sessions', { client: 't1', parentId: parent, title: 'Kid', text: 'do the kid work', engine: 'grok', settings: { permissionMode: 'bypassPermissions' } })).id;
  await waitFor('the kid to answer', async () => (await texts(kid)).some((t) => t.startsWith('got: do the kid work')));

  // The kid says it is ready to close: its turn is marked done.
  assert.match(await call(kid, 'mark_turn', { label: 'done' }), /will say "done"/);
  const before = await turns(kid);
  const sent = await call(parent, 'send_to_session', { id: kid, message: 'Checked and agree the work is done.', done: true });
  assert.match(sent, /^Delivered as a note in its chat, not a new turn/);
  await sleep(1500);
  const ev = await events(kid);
  assert.ok(ev.some((e) => e.k === 'note' && e.text.includes('Checked and agree the work is done.')), 'the note is in the kid chat');
  assert.ok(!ev.some((e) => e.k === 'user' && e.text === 'Checked and agree the work is done.'), 'not sent as a message');
  assert.equal(await turns(kid), before, 'no turn ran');

  // A turn that is not marked done: the same message starts a turn, as before.
  await api(`/api/sessions/${kid}/send?client=t1`, { text: 'one more thing' });
  await waitFor('the kid to answer', async () => (await texts(kid)).some((t) => t.startsWith('got: one more thing')));
  await idle(kid);
  assert.equal(await call(parent, 'send_to_session', { id: kid, message: 'Checked and agree, again.', done: true }), 'Sent.');
  await waitFor('the agree message to run a turn', async () => (await texts(kid)).some((t) => t.startsWith('got: Checked and agree, again.')));
});
