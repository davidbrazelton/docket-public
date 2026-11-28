// Tests for the new-session draft's group picker: the group picked before starting is the one the session lands in.
// The rule on its own (start-group.mjs), then end to end on a throwaway Docket whose Grok is test-fixtures/fake-acp-agent.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePorts, stopTree, TEST_DOCKET_ENV } from './free-port.mjs';
import { startGroup } from '../start-group.mjs';

const isGroup = (gid) => gid === 'g_1';
test('the group picked is saved; no group at the top level saves nothing; under a parent no group is saved on purpose', () => {
  assert.equal(startGroup({ groupId: 'g_1' }, isGroup), 'g_1');
  assert.equal(startGroup({ groupId: 'g_1', parentId: 'p' }, isGroup), 'g_1');
  assert.equal(startGroup({ groupId: 'g_gone' }, isGroup), undefined, 'a group the desk does not have is left out');
  assert.equal(startGroup({ groupId: '' }, isGroup), undefined);
  assert.equal(startGroup({ groupId: '', parentId: 'p' }, isGroup), '');
  assert.equal(startGroup({ parentId: 'p' }, isGroup), undefined, 'under a parent with nothing picked it follows the parent');
  assert.equal(startGroup({}, isGroup), undefined);
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const [PORT, RUNNER_PORT] = await freePorts(2);
const URL_ = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-512-'));
let server;
const api = async (p, body) => {
  const r = await fetch(URL_ + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, fn, ms = 30000) {
  for (const until = Date.now() + ms; ;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > until) throw new Error('Timed out waiting for ' + what);
    await sleep(150);
  }
}
const runnerPid = () => fetch(`http://127.0.0.1:${RUNNER_PORT}/health`).then((r) => r.json()).then((h) => h.pid).catch(() => null);
const rowOf = async (id) => (await api('/api/sessions?client=t1')).live.find((s) => s.id === id);

before(async () => {
  const t1 = { id: 't1', name: 'T1', home: path.join(tmp, 'claude-1'), folder: path.join(tmp, 'work-1'), grokHome: path.join(tmp, 'grok-1'), defaultEngine: 'grok', brandsOff: ['claude'] };
  for (const d of [t1.home, t1.folder, t1.grokHome]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'clients.json'), JSON.stringify([t1]));
  fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify({ sessions: {}, updates: { minutes: 0 } }));
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, ...TEST_DOCKET_ENV, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_CLIENTS: path.join(tmp, 'clients.json'),
      PORTAL_STATE: path.join(tmp, 'state.json'), PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: path.join(tmp, 'data'),
      PORTAL_GROK_EXE: path.join(HERE, '..', 'test-fixtures', 'fake-acp-agent.mjs') },
  });
  await waitFor('the test Docket to start', () => api('/api/clients?quick=1'));
});

after(async () => {
  const pid = await runnerPid();
  server?.kill();
  if (pid) stopTree(pid);
  await sleep(300);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('a session started in a group lands in it, also under a parent that is in another group', async () => {
  const a = await api('/api/groups', { client: 't1', name: 'Alpha' });
  const b = await api('/api/groups', { client: 't1', name: 'Beta' });
  const top = await api('/api/sessions', { client: 't1', text: 'hello', engine: 'grok', groupId: a.id });
  assert.equal(top.groupId, a.id);
  assert.equal((await rowOf(top.id)).ownGroupId, a.id, 'saved as its own group');
  const follows = await api('/api/sessions', { client: 't1', text: 'kid', engine: 'grok', parentId: top.id });
  assert.equal((await rowOf(follows.id)).groupId, a.id, 'nothing picked: it follows its parent');
  assert.equal((await rowOf(follows.id)).ownGroupId, null);
  const moved = await api('/api/sessions', { client: 't1', text: 'kid 2', engine: 'grok', parentId: top.id, groupId: b.id });
  assert.equal((await rowOf(moved.id)).groupId, b.id, 'the group picked wins over the parent\'s');
  const none = await api('/api/sessions', { client: 't1', text: 'kid 3', engine: 'grok', parentId: top.id, groupId: '' });
  assert.equal((await rowOf(none.id)).groupId, null, 'no group picked on purpose');
  const plain = await api('/api/sessions', { client: 't1', text: 'plain', engine: 'grok', groupId: '' });
  assert.equal((await rowOf(plain.id)).groupId, null);
});
