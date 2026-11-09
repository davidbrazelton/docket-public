// ask_company's question session finds and reads a company's Grok and Codex sessions. Its tools, search_past_sessions
// and read_past_session, read Claude's conversations and every chat Docket keeps for a session another AI runs. Runs a
// throwaway Docket (its own ports, state and company list in a temp folder) whose Grok is the stand-in agent in
// test-fixtures/fake-acp-agent.mjs and whose Codex is test-fixtures/fake-codex.mjs (signed in), and checks the tools' text through /api/past, which gives exactly what they return.
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
const [PORT, RUNNER_PORT] = await freePorts(2);
const URL_ = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-276-'));
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
const texts = async (id) => (await api(`/api/sessions/${id}/events?client=t1`)).events.filter((e) => e.k === 'text').map((e) => e.text);
const runnerPid = () => fetch(`http://127.0.0.1:${RUNNER_PORT}/health`).then((r) => r.json()).then((h) => h.pid).catch(() => null);

before(async () => {
  const c = { id: 't1', name: 'T1', home: path.join(tmp, 'claude-home'), folder: path.join(tmp, 'work'), grokHome: path.join(tmp, 'grok-home'), codexHome: path.join(tmp, 'codex-home'), defaultEngine: 'grok' };
  for (const d of [c.home, c.folder, c.grokHome, c.codexHome]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(c.codexHome, 'auth.json'), '{}');
  fs.writeFileSync(path.join(tmp, 'clients.json'), JSON.stringify([c]));
  fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify({ sessions: {}, updates: { minutes: 0 } }));
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_CLIENTS: path.join(tmp, 'clients.json'),
      PORTAL_REPORT_DEBOUNCE: '{"quietMs":0,"maxMs":0}', PORTAL_STATE: path.join(tmp, 'state.json'), PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: path.join(tmp, 'data'),
      PORTAL_GROK_EXE: path.join(HERE, '..', 'test-fixtures', 'fake-acp-agent.mjs'), PORTAL_CODEX_EXE: path.join(HERE, '..', 'test-fixtures', 'fake-codex.mjs'),
      CODEX_HOME: path.join(tmp, 'shared-codex'), FAKE_ACP_MEMORY: path.join(tmp, 'grok-memory'), FAKE_ACP_RESUME: 'resume' },
  });
  await waitFor('the test Docket to start', () => api('/api/clients?quick=1'), 30000);
});

after(async () => {
  const pid = await runnerPid();
  server?.kill();
  if (pid) stopTree(pid);
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 });
});

test('a company\'s Grok session is found by the words in its chat and read back, after it has stopped', async () => {
  const id = (await api('/api/sessions', { client: 't1', title: 'Grok smoke test', text: 'remember the word KUMQUAT-9', engine: 'grok' })).id;
  await waitFor('the reply', async () => (await texts(id)).some((t) => t.includes('KUMQUAT-9')));
  await api(`/api/sessions/${id}/end?client=t1`, {});
  await waitFor('the session to stop', async () => !(await api(`/api/sessions/${id}/events?client=t1`)).session);

  const found = (await api('/api/past?client=t1&words=kumquat-9')).text;
  assert.match(found, /^1 session\(s\) match:/, found);
  const day = new Date().toISOString().slice(0, 10);
  assert.ok(found.includes(`${id}  ${day}  Grok smoke test`), `listed with its title and date: ${found}`);
  assert.match(found, /KUMQUAT-9/, 'with a snippet of the chat');

  const read = (await api(`/api/past?client=t1&id=${id}`)).text;
  assert.match(read, /^Title: Grok smoke test\nLast active: \d{4}-\d{2}-\d{2}/);
  assert.match(read, /Person: remember the word KUMQUAT-9/, 'the person\'s message');
  assert.match(read, /Reply: echo: \[rules\] remember the word KUMQUAT-9/, 'and the reply');

  assert.equal((await api('/api/past?client=t1&words=no-such-word')).text, 'No past session holds those words.');
  assert.equal((await api('/api/past?client=t1&id=not-a-session')).text, null, 'an unknown id reads nothing');
});

test('a company\'s Codex session is found and read the same way', async () => {
  const id = (await api('/api/sessions', { client: 't1', title: 'Codex smoke test', text: 'remember the word PERSIMMON-4', engine: 'codex' })).id;
  await waitFor('the reply', async () => (await texts(id)).some((t) => t.startsWith('echo:') && t.includes('PERSIMMON-4')));
  await api(`/api/sessions/${id}/end?client=t1`, {});
  await waitFor('the session to stop', async () => !(await api(`/api/sessions/${id}/events?client=t1`)).session);

  const found = (await api('/api/past?client=t1&words=persimmon')).text;
  assert.ok(found.includes(`${id}  ${new Date().toISOString().slice(0, 10)}  Codex smoke test`), found);
  const read = (await api(`/api/past?client=t1&id=${id}`)).text;
  assert.match(read, /^Title: Codex smoke test\n/);
  assert.match(read, /Person: remember the word PERSIMMON-4/);
  assert.match(read, /Reply: echo: \[rules\] remember the word PERSIMMON-4/);
});
