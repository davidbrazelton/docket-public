// The autopilot on a remote desk tab (#975), on a throwaway Docket (its own ports, state and desk list in a temp folder)
// that plays both computers: it adds its own remote control address as a remote desk, as in remote-desks-multi.test.mjs.
// Desks t1 and t2 are added for remote use, t3 is not. The tabs show the autopilot as the computer with the desk says,
// engaging one engages it there, its Autopilot tab and Suggest | Answer go through the connection, and a change there
// reaches the tabs here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePorts, stopTree, TEST_DOCKET_ENV } from './free-port.mjs';
import { codeAt, stepOf } from '../remote.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const [PORT, RUNNER_PORT, REMOTE_PORT] = await freePorts(3);
const URL_ = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-975-'));
const STATE = path.join(tmp, 'state.json');
const SECRET = 'JBSWY3DPEHPK3PXP';
let server, rd;

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
const api = async (p, body) => {
  const r = await fetch(URL_ + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
let codeStep = 0;
const nextCode = () => codeAt(SECRET, codeStep = Math.max(codeStep + 1, stepOf() - 1));
const tab = (d) => `${rd.id}-${d}`;
const view = async () => (await api('/api/pilot')).json;
// What the computer with the desk has engaged: its own desks' ids (the same Docket here, so its own view).
const engagedThere = async () => Object.fromEntries(Object.entries((await view()).engaged).filter(([id]) => !id.startsWith(rd.id)));

before(async () => {
  const desks = ['t1', 't2', 't3'].map((id) => ({ id, name: id.toUpperCase(), home: path.join(tmp, id, 'claude-home'), folder: path.join(tmp, id, 'work'), grokHome: path.join(tmp, id, 'grok-home'), defaultEngine: 'grok' }));
  for (const c of desks) for (const d of [c.home, c.folder, c.grokHome]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'clients.json'), JSON.stringify(desks));
  fs.writeFileSync(STATE, JSON.stringify({ sessions: {}, updates: { minutes: 0 }, remoteControl: { on: true, desks: ['t1', 't2'], secret: SECRET } }));
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, ...TEST_DOCKET_ENV, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_REMOTE_PORT: String(REMOTE_PORT),
      PORTAL_CLIENTS: path.join(tmp, 'clients.json'), PORTAL_STATE: STATE, PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: path.join(tmp, 'data'),
      FAKE_ACP_SIGNED_IN: '1', PORTAL_GROK_EXE: path.join(HERE, '..', 'test-fixtures', 'fake-acp-agent.mjs') },
  });
  await waitFor('the test Docket to start', async () => (await api('/api/clients?quick=1')).status === 200, 30000);
  await api('/api/remote-features', { on: true });
  // It adds itself as a remote desk and connects: a tab for t1 and one for t2.
  const check = (await api('/api/remote-control')).json.check;
  rd = (await api('/api/remote-desks', { name: 'Desk PC', address: `127.0.0.1:${REMOTE_PORT}`, check })).json;
  const connect = api(`/api/remote-desks/${rd.id}/connect`, { code: nextCode() });
  const ask = await waitFor('the Allow card', async () => (await api('/api/remote-control')).json.asks[0]);
  await api('/api/remote-control/answer', { id: ask.id, allow: true });
  assert.equal((await connect).json.connected, true);
});

after(async () => {
  const runner = await fetch(`http://127.0.0.1:${RUNNER_PORT}/health`).then((r) => r.json()).catch(() => null);
  server?.kill();
  if (runner?.pid) stopTree(runner.pid);
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 });
});

test('not enabled there: the tabs show no autopilot, and engaging one says why', async () => {
  const v = await waitFor('the tabs to hear from there', async () => { const x = await view(); return x.desks.some((d) => d.id === tab('t1')) && x; });
  assert.deepEqual(v.remoteOn, {}, 'no tab has it enabled');
  const row = v.desks.find((d) => d.id === tab('t1'));
  assert.ok(row, 'the tab is listed, so the drop-down can say it is off there');
  assert.equal(row.on, false);
  const r = await api('/api/pilot', { engage: { desk: tab('t1'), on: true } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /not enabled on/);
});

test('enabled there: each tab shows it, engaging a tab engages that desk there, and its Autopilot tab comes through', async () => {
  assert.equal((await api('/api/pilot', { on: true })).status, 200);
  const v = await waitFor('the tabs to hear it is enabled', async () => { const x = await view(); return x.remoteOn[tab('t1')] && x.remoteOn[tab('t2')] && x; });
  assert.ok(!v.remoteOn[tab('t3')], 'never a desk that computer did not add');
  assert.deepEqual(v.desks.filter((d) => d.remote).map((d) => [d.id, d.name, d.remote, d.on, d.signedIn, d.engaged]),
    [[tab('t1'), 'T1', 'Desk PC', true, true, false], [tab('t2'), 'T2', 'Desk PC', true, true, false]]);

  // Engage on the t2 tab: engaged on t2 there, and shown on its tab here.
  const r = await api('/api/pilot', { engage: { desk: tab('t2'), on: true } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok((await engagedThere()).t2, 'engaged on t2 on the computer with the desk');
  assert.ok(r.json.engaged[tab('t2')], 'and shown on its tab in the answer');
  assert.ok(!r.json.engaged[tab('t1')], 'not on the other tab');
  assert.equal(r.json.desks.find((d) => d.id === tab('t2')).engaged, true);

  // Its Autopilot tab, through the connection, under the tab's id.
  const t = await api(`/api/pilot/desk?client=${tab('t2')}`);
  assert.equal(t.status, 200);
  assert.equal(t.json.desk.id, tab('t2'));
  assert.equal(t.json.engaged, true);
  assert.ok(Array.isArray(t.json.kinds) && t.json.kinds.length);
  // Suggest | Answer for a kind goes to that desk there.
  const k = t.json.kinds[0];
  const set = await api('/api/pilot/kind', { desk: tab('t2'), kind: k.kind, level: k.level === 'suggest' ? 'suggest' : k.level });
  assert.equal(set.status, 200, JSON.stringify(set.json));

  // Disengage from the tab.
  assert.equal((await api('/api/pilot', { engage: { desk: tab('t2'), on: false } })).status, 200);
  assert.ok(!(await engagedThere()).t2);
  assert.ok(!(await view()).engaged[tab('t2')]);
});

test('a change on the computer with the desk reaches its tab here', async () => {
  assert.equal((await api('/api/pilot', { engage: { desk: 't1', on: true } })).status, 200); // engaged there, on its own page
  await waitFor('the t1 tab to show it engaged', async () => (await view()).engaged[tab('t1')]);
  await api('/api/pilot', { engage: { desk: 't1', on: false } });
  await waitFor('the t1 tab to show it off', async () => !(await view()).engaged[tab('t1')]);
});

test('a desk that computer did not add is refused there', async () => {
  const r = await api('/api/pilot', { engage: { desk: tab('t3'), on: true } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /added for remote use/);
  assert.ok(!(await engagedThere()).t3);
  assert.equal((await api(`/api/pilot/desk?client=${tab('t3')}`)).status, 403);
});

test('disconnected, the tabs show no autopilot', async () => {
  await api(`/api/remote-desks/${rd.id}/disconnect`, {});
  const v = await view();
  assert.deepEqual(Object.keys(v.remoteOn).filter((id) => id.startsWith(rd.id)), []);
  assert.ok(!v.desks.some((d) => d.remote));
});
