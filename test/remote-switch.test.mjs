// The Remote Desks master switch, on a throwaway Docket (its own ports, state and company list in a temp folder)
// whose Grok is the stand-in agent in test-fixtures/fake-acp-agent.mjs. Hidden by default: the page's remote requests answer
// 404, open pages are told it is off and remote control does not run. A session calls remote_desks to show it; every
// restart hides it again, and neither the restart nor hiding changes the saved remote setup.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePorts, stopTree, TEST_DOCKET_ENV } from './free-port.mjs';
import net from 'node:net';
import WebSocket from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const [PORT, RUNNER_PORT, REMOTE_PORT] = await freePorts(3);
const URL_ = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-494-'));
const STATE = path.join(tmp, 'state.json');
let server;
// A computer already set up for Remote Desks: remote control on for desk t1, and one remote desk added.
const SETUP = {
  remoteControl: { on: true, desk: 't1', secret: 'JBSWY3DPEHPK3PXP' },
  remoteDesks: [{ id: 'rabc123', name: 'Other PC', address: 'https://10.255.255.1:4402', pin: 'AB:CD:EF:01:23:45:67:89', cert: '' }],
};
const setupKept = () => { const st = JSON.parse(fs.readFileSync(STATE, 'utf8')); assert.deepEqual({ remoteControl: st.remoteControl, remoteDesks: st.remoteDesks }, SETUP, 'the remote setup is kept'); assert.equal(st.remoteFeatures, undefined, 'the switch is never saved'); };
const hostListening = () => new Promise((resolve) => { const c = net.connect(REMOTE_PORT, '127.0.0.1'); c.on('connect', () => { c.destroy(); resolve(true); }); c.on('error', () => resolve(false)); });
const remoteRowsShown = async () => (await api('/api/clients?quick=1')).json.some((c) => c.remote);

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
const texts = async (id) => (await api(`/api/sessions/${id}/events?client=t1`)).json.events.filter((e) => e.k === 'text').map((e) => e.text);
async function call(id, tool, args) {
  const before = (await texts(id)).length;
  await api(`/api/sessions/${id}/send?client=t1`, { text: `CALL portal__${tool} ${JSON.stringify(args)}` });
  return waitFor(`${tool} from ${id}`, async () => (await texts(id)).slice(before).find((t) => t.startsWith(`called portal__${tool}:`)));
}
// What an open page is told about the switch: the first remote-features message on a new connection.
const pageHears = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`, { origin: `http://localhost:${PORT}` });
  const msgs = [];
  ws.on('message', (d) => { const m = JSON.parse(d); msgs.push(m); });
  ws.on('error', reject);
  ws.on('open', () => resolve({ ws, msgs, next: (on) => waitFor(`remote-features ${on}`, async () => msgs.find((m) => m.t === 'remote-features' && m.on === on)) }));
});
const refused = async () => {
  for (const p of ['/api/remote-control', '/api/remote-desks']) assert.equal((await api(p)).status, 404, `${p} is hidden`);
  assert.equal((await api('/api/remote-control/authenticator', {})).status, 404);
  assert.equal((await api('/api/remote-desks', { name: 'x', address: '10.0.0.1:4402', check: 'x' })).status, 404);
};
function startDocket() {
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, ...TEST_DOCKET_ENV, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_REMOTE_PORT: String(REMOTE_PORT), PORTAL_CLIENTS: path.join(tmp, 'clients.json'),
      PORTAL_STATE: STATE, PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: path.join(tmp, 'data'),
      PORTAL_GROK_EXE: path.join(HERE, '..', 'test-fixtures', 'fake-acp-agent.mjs') },
  });
  return waitFor('the test Docket to start', async () => (await api('/api/clients?quick=1')).status === 200, 30000);
}
async function stopDocket() {
  const exited = new Promise((r) => server.once('exit', r));
  server.kill();
  await exited;
}

before(async () => {
  const c = { id: 't1', name: 'T1', home: path.join(tmp, 't1', 'claude-home'), folder: path.join(tmp, 't1', 'work'), grokHome: path.join(tmp, 't1', 'grok-home'), defaultEngine: 'grok' };
  for (const d of [c.home, c.folder, c.grokHome]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'clients.json'), JSON.stringify([c]));
  fs.writeFileSync(STATE, JSON.stringify({ sessions: {}, updates: { minutes: 0 }, ...SETUP }));
  await startDocket();
});

after(async () => {
  const runner = await fetch(`http://127.0.0.1:${RUNNER_PORT}/health`).then((r) => r.json()).catch(() => null);
  server?.kill();
  if (runner?.pid) stopTree(runner.pid);
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 });
});

test('hidden at every start; a session shows it until the next restart; the remote setup is never changed', async () => {
  // Hidden at start, even with remote control set up and on: 404s, no remote rows, no remote host, a page told it is off.
  await refused();
  assert.equal(await remoteRowsShown(), false);
  assert.equal(await hostListening(), false, 'remote control does not run while hidden');
  const page = await pageHears();
  await page.next(false);

  // A session asked to show the options calls remote_desks: the open page is told at once, and the setup comes back as it was.
  const s = (await api('/api/sessions', { client: 't1', text: 'hello', engine: 'grok', settings: { permissionMode: 'bypassPermissions' } })).json;
  await waitFor('the session to answer', async () => (await texts(s.id)).length);
  assert.match(await call(s.id, 'remote_desks', { on: true }), /shown on this computer now/);
  await page.next(true);
  page.ws.close();
  const rc = (await api('/api/remote-control')).json;
  assert.equal(rc.on, true);
  assert.equal(rc.desk, 't1');
  assert.equal(rc.authenticator, true);
  assert.deepEqual((await api('/api/remote-desks')).json.map((d) => d.name), ['Other PC']);
  assert.equal(await remoteRowsShown(), true);
  await waitFor('remote control to run', hostListening);
  setupKept();

  // A restart hides it again, and the setup is untouched.
  await stopDocket();
  await startDocket();
  await refused();
  assert.equal(await remoteRowsShown(), false);
  assert.equal(await hostListening(), false);
  const again = await pageHears();
  await again.next(false);
  again.ws.close();
  setupKept();

  // Shown, then hidden by a session: refused at once and remote control stopped, the setup still kept.
  const s2 = (await api('/api/sessions', { client: 't1', text: 'hello again', engine: 'grok', settings: { permissionMode: 'bypassPermissions' } })).json;
  await waitFor('the second session to answer', async () => (await texts(s2.id)).length);
  await call(s2.id, 'remote_desks', { on: true });
  await waitFor('remote control to run again', hostListening);
  assert.match(await call(s2.id, 'remote_desks', { on: false }), /hidden on this computer now/);
  await refused();
  await waitFor('remote control to stop', async () => !(await hostListening()));
  await sleep(400); // past the usual save delay, in case anything were saved
  setupKept();
});

test('Alt+click on ☰ > About shows and hides it with no AI, and a restart hides it again', async () => {
  const page = await pageHears();
  await page.next(false);
  assert.deepEqual((await api('/api/remote-features', { on: true })).json, { on: true });
  await page.next(true);
  page.ws.close();
  assert.equal((await api('/api/remote-control')).status, 200);
  await waitFor('remote control to run', hostListening);
  assert.deepEqual((await api('/api/remote-features', { on: false })).json, { on: false });
  await refused();
  await waitFor('remote control to stop', async () => !(await hostListening()));
  await api('/api/remote-features', { on: true });
  await stopDocket();
  await startDocket();
  await refused();
  setupKept();
});

test('Docket\'s own restarts keep it shown (#772): the note left for the next start shows it, once; an old note does not', async () => {
  const note = path.join(tmp, 'data', 'remote-shown');
  await stopDocket();
  fs.mkdirSync(path.dirname(note), { recursive: true });
  fs.writeFileSync(note, String(Date.now()));
  await startDocket();
  await waitFor('Remote Desks shown after the restart', async () => (await api('/api/remote-control')).status === 200);
  await waitFor('remote control to run after the restart', hostListening);
  assert.equal(fs.existsSync(note), false, 'the note is read once');
  await stopDocket(); // a plain stop, as when the computer restarts: hidden at the next start
  await startDocket();
  await refused();
  fs.writeFileSync(note, String(Date.now() - 60 * 60e3));
  await stopDocket();
  await startDocket();
  await refused();
  assert.equal(fs.existsSync(note), false);
  setupKept();
});

test('connecting to a computer that does not answer says so within seconds, not after the 2-minute wait for Allow (#772)', async () => {
  await api('/api/remote-features', { on: true });
  const t0 = Date.now();
  const r = await api('/api/remote-desks/rabc123/connect', { code: '123456' });
  assert.equal(r.status, 502);
  assert.match(r.json.error, /Remote Desks may be hidden there/);
  assert.ok(Date.now() - t0 < 15000, `answered in ${Date.now() - t0} ms`);
  await api('/api/remote-features', { on: false });
});
