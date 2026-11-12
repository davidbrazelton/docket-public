// A turn answering the user whose only outcome was starting a child session (start_session, user_asked) is not
// marked unread: the parent's row shows the ring for the working child instead (#777). A plain reply still is.
// Runs a throwaway Docket (its own ports, state and company list in a temp folder) whose Grok is the stand-in agent
// in test-fixtures/fake-acp-agent.mjs, which calls Docket's tools when told to.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePorts, stopTree, TEST_DOCKET_ENV } from './free-port.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const [PORT, RUNNER_PORT] = await freePorts(2);
const URL_ = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-777-'));
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
// The person sends a message; returns the session once that turn is over.
async function say(id, text, expect) {
  await idle(id);
  const before = (await texts(id)).length;
  await api(`/api/sessions/${id}/send?client=t1`, { text });
  await waitFor(`the reply in ${id}`, async () => (await texts(id)).slice(before).find((t) => t.startsWith(expect)));
  await idle(id);
  return (await view(id)).session;
}

before(async () => {
  const c = { id: 't1', name: 'T1', home: path.join(tmp, 'claude-home'), folder: path.join(tmp, 'work'), grokHome: path.join(tmp, 'grok-home'), defaultEngine: 'grok' };
  for (const d of [c.home, c.folder, c.grokHome]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'clients.json'), JSON.stringify([c]));
  fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify({ sessions: {}, updates: { minutes: 0 } }));
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, ...TEST_DOCKET_ENV, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_CLIENTS: path.join(tmp, 'clients.json'),
      PORTAL_REPORT_DEBOUNCE: '{"quietMs":0,"maxMs":0}', PORTAL_STATE: path.join(tmp, 'state.json'), PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: path.join(tmp, 'data'),
      PORTAL_GROK_EXE: path.join(HERE, '..', 'test-fixtures', 'fake-acp-agent.mjs') },
  });
  await waitFor('the test Docket to start', () => api('/api/clients?quick=1'), 30000);
});

after(async () => {
  const runner = await fetch(`http://127.0.0.1:${RUNNER_PORT}/health`).then((r) => r.json()).catch(() => null);
  server?.kill();
  if (runner?.pid) stopTree(runner.pid);
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 });
});

test('a turn that only started a working child shows its ring, not the orange dot (#777)', async () => {
  const parent = (await api('/api/sessions', { client: 't1', text: 'hello parent', engine: 'grok', settings: { permissionMode: 'bypassPermissions' } })).id;
  await waitFor('the parent to answer', async () => (await texts(parent)).some((t) => t.startsWith('got: hello parent')));
  await idle(parent);
  assert.equal((await view(parent)).session.unread, true, 'a plain reply to the person turns orange, as before');
  await api(`/api/sessions/${parent}/seen?client=t1`, { why: 'test' });

  const args = { title: 'Kid', prompt: 'SLOW 6000\ndo the kid work', initiation: 'user_asked' };
  const s = await say(parent, `CALL portal__start_session ${JSON.stringify(args)}`, 'called portal__start_session: Started session');
  assert.equal(s.unread, false, 'not marked unread: the work is in the child');
  assert.equal(s.kids.working, 1, 'its row shows the ring for the working child');
  assert.equal(s.kidNews, false, 'no halo: no report came in');
  assert.ok((await texts(parent)).some((t) => t.startsWith('called portal__start_session: Started session')), 'the reply stays in its chat');

  // The child finishes: its report wakes the parent, and that turn turns orange as any report turn without report_quiet.
  await waitFor('the kid report in the parent', async () => (await texts(parent)).some((t) => t.includes('"Kid"') && t.includes('finished a turn')), 30000);
  await idle(parent);
  assert.equal((await view(parent)).session.unread, true);
});
