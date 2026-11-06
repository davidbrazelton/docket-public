// Sessions of one company message each other with no approval, whatever brand each runs on. Runs a
// throwaway Docket (its own ports, state and company list in a temp folder) whose Grok is the stand-in agent
// in fixtures/fake-acp-agent.mjs, and drives Grok sessions that call Docket's tools the way Grok does.
// Grok sessions here run in the "Ask before acting" mode, so any approval step would show as a permission card.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-248-'));
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
const events = (id, client = 't1') => api(`/api/sessions/${id}/events?client=${client}`);
const texts = async (id, client) => (await events(id, client)).events.filter((e) => e.k === 'text').map((e) => e.text);
const start = (text, client = 't1') => api('/api/sessions', { client, text, engine: 'grok', settings: { permissionMode: 'default' } });
// One turn of a session calling a portal tool; returns the tool's answer.
async function call(id, tool, args) {
  const before = (await texts(id)).length;
  await api(`/api/sessions/${id}/send?client=t1`, { text: `CALL portal__${tool} ${JSON.stringify(args)}` });
  const said = await waitFor(`${tool} from ${id}`, async () => (await texts(id)).slice(before).find((t) => t.startsWith(`called portal__${tool}:`)));
  return said.slice(`called portal__${tool}: `.length).replace(/ \[end of reply\]$/, '');
}
const noCards = async (id, client) => assert.deepEqual((await events(id, client)).events.filter((e) => e.k === 'permission'), [], `no approval asked in ${id}`);

before(async () => {
  const company = (id) => ({ id, name: id.toUpperCase(), home: path.join(tmp, id, 'claude-home'), folder: path.join(tmp, id, 'work'), grokHome: path.join(tmp, id, 'grok-home'), defaultEngine: 'grok' });
  const clients = [company('t1'), company('t2')];
  for (const c of clients) for (const d of [c.home, c.folder, c.grokHome]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'clients.json'), JSON.stringify(clients));
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

test('Grok sessions of one company start, message, report to and read each other with no approval', async () => {
  const parent = await start('hello parent');
  await waitFor('the parent to answer', async () => (await texts(parent.id)).some((t) => t.startsWith('got: hello parent')));

  // A Grok child under the parent (started from the page, the same path as start_session; start_session itself
  // is not a messaging tool, so in this mode it asks, on Claude too): its finished turn comes back to the parent
  // as a session report.
  const kid = (await api('/api/sessions', { client: 't1', parentId: parent.id, title: 'Kid', text: 'do the kid work', engine: 'grok', settings: { permissionMode: 'default' } })).id;
  await waitFor('the kid to answer', async () => (await texts(kid)).some((t) => t.startsWith('got: do the kid work')));
  const report = await waitFor('the session report in the parent', async () => (await texts(parent.id)).find((t) => t.includes('<session-report>') || t.includes('finished a turn')));
  assert.match(report, /"Kid" \(id [\w-]+\) finished a turn\. Its latest reply begins: got: do the kid work/);
  assert.match(report, /portal__get_session_report/, 'tool names in the report are the ones Grok calls');
  assert.doesNotMatch(report, /mcp__portal__/);

  // To a running Grok session: delivered, marked as from a session, with the sender named.
  assert.equal(await call(parent.id, 'send_to_session', { id: kid, message: 'ping-1' }), 'Sent.');
  const got1 = await waitFor('ping-1 in the kid', async () => (await texts(kid)).find((t) => t.startsWith('got: ping-1')));
  assert.match(got1, new RegExp(`\\(Sent by the session "hello parent" in the portal, id ${parent.id}\\.\\)`));
  assert.equal((await events(kid)).events.find((e) => e.k === 'user' && e.text === 'ping-1')?.from, 'session');

  // Its status and latest reply, read by another session.
  assert.match(await call(parent.id, 'get_session_report', { id: kid }), /^Title: Kid\nStatus: \w+/);
  assert.match(await call(parent.id, 'list_sessions', {}), new RegExp(kid));

  // To a stopped Grok session: picked up again, on Grok, and answers.
  await api(`/api/sessions/${kid}/end?client=t1`, {});
  assert.match(await call(parent.id, 'get_session_report', { id: kid }), /^Title: Kid\nStatus: not running/);
  assert.equal(await call(parent.id, 'send_to_session', { id: kid, message: 'ping-2' }), 'Sent.');
  await waitFor('ping-2 in the kid', async () => (await texts(kid)).some((t) => t.startsWith('got: ping-2')));
  assert.equal((await events(kid)).session.engine, 'grok');

  // The kid writes back to its parent.
  await api(`/api/sessions/${kid}/send?client=t1`, { text: `CALL portal__send_to_session ${JSON.stringify({ id: parent.id, message: 'pong' })}` });
  await waitFor('pong in the parent', async () => (await texts(parent.id)).some((t) => t.startsWith('got: pong')));

  await noCards(parent.id);
  await noCards(kid);
});

test('a session of another company is still out of reach', async () => {
  const mine = await start('mine');
  const theirs = await start('theirs', 't2');
  await waitFor('both to answer', async () => (await texts(mine.id)).length && (await texts(theirs.id, 't2')).length);
  assert.match(await call(mine.id, 'send_to_session', { id: theirs.id, message: 'xyz-cross' }), /belongs to another desk/);
  assert.match(await call(mine.id, 'get_session_report', { id: theirs.id }), /No session with that id/);
  assert.ok(!(await texts(theirs.id, 't2')).some((t) => t.includes('xyz-cross')), 'nothing reached the other company');
});
