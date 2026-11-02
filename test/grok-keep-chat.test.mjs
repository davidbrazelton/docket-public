// A stopped Grok session keeps its chat and its memory when picked up again. Runs a throwaway Docket (its
// own ports, state and company list in a temp folder) whose Grok is the stand-in agent in fixtures/fake-acp-agent.mjs,
// set to remember its conversations and to offer session/resume, as `grok agent stdio` does (grok 1.0.41).
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-254-'));
const STATE = path.join(tmp, 'state.json');
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
const said = (id) => events(id).then((evs) => evs.filter((e) => e.k === 'user' || e.k === 'text').map((e) => (e.k === 'user' ? '> ' : '') + e.text));
const notes = async (id) => (await events(id)).filter((e) => e.k === 'note').map((e) => e.text);
// A first reply starts "echo: [rules]": Docket's standing rules come at the start of a conversation, and only then.
// One turn: sends text (picking the session up again if it is stopped) and returns the reply's last text.
async function ask(id, text) {
  await api(`/api/sessions/${id}/send?client=t1`, { text });
  return waitFor(`the reply to "${text}"`, async () => (await texts(id)).find((t) => t.startsWith(`echo: ${text} |`) || t.startsWith(`echo: [rules] ${text} |`)));
}
const end = (id) => api(`/api/sessions/${id}/end?client=t1`, {});
const runnerPid = () => fetch(`http://127.0.0.1:${RUNNER_PORT}/health`).then((r) => r.json()).then((h) => h.pid).catch(() => null);

async function startDocket() {
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_CLIENTS: path.join(tmp, 'clients.json'),
      PORTAL_STATE: STATE, PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: path.join(tmp, 'data'),
      PORTAL_GROK_EXE: path.join(HERE, 'fixtures', 'fake-acp-agent.mjs'), FAKE_ACP_MEMORY: path.join(tmp, 'grok-memory'), FAKE_ACP_RESUME: 'resume' },
  });
  await waitFor('the test Docket to start', () => api('/api/clients?quick=1'), 30000);
}
// Docket stops with its runner (as when the computer restarts), so no session is left running.
async function stopDocket() {
  await sleep(500); // Docket saves its state 200 ms after a change
  const pid = await runnerPid();
  server.kill();
  if (pid) try { process.kill(pid); } catch {}
  await waitFor('Docket to stop', async () => !(await runnerPid()) && !(await api('/api/clients?quick=1').catch(() => null)));
}

before(async () => {
  const c = { id: 't1', name: 'T1', home: path.join(tmp, 'claude-home'), folder: path.join(tmp, 'work'), grokHome: path.join(tmp, 'grok-home'), defaultEngine: 'grok' };
  for (const d of [c.home, c.folder, c.grokHome]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'clients.json'), JSON.stringify([c]));
  fs.writeFileSync(STATE, JSON.stringify({ sessions: {}, updates: { minutes: 0 } }));
  await startDocket();
});

after(async () => {
  const pid = await runnerPid();
  server?.kill();
  if (pid) try { process.kill(pid); } catch {}
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
});

test('a Grok session stopped with End shows its chat, and picked up again, Grok remembers it', async () => {
  const id = (await api('/api/sessions', { client: 't1', text: 'alpha', engine: 'grok' })).id;
  await waitFor('the first reply', async () => (await texts(id)).includes('echo: [rules] alpha | remembers: nothing'));
  await end(id);
  await waitFor('the session to stop', async () => !(await api(`/api/sessions/${id}/events?client=t1`)).session);
  assert.deepEqual(await said(id), ['> alpha', 'Hello', 'echo: [rules] alpha | remembers: nothing'], 'the chat shows when opened after End');

  assert.equal(await ask(id, 'beta'), 'echo: beta | remembers: alpha', 'Grok picked up its own conversation');
  assert.deepEqual((await said(id)).filter((t) => !t.startsWith('Hello')), ['> alpha', 'echo: [rules] alpha | remembers: nothing', '> beta', 'echo: beta | remembers: alpha'],
    'the earlier chat shows when picked up again');
  assert.ok(!(await notes(id)).some((n) => /could not pick up/.test(n)));
  await end(id);
});

test('after a Docket restart a Grok session shows its chat and picks up its conversation; an older one says it cannot', async () => {
  const id = (await api('/api/sessions', { client: 't1', text: 'gamma', engine: 'grok' })).id;
  await waitFor('the first reply', async () => (await texts(id)).includes('echo: [rules] gamma | remembers: nothing'));
  const old = (await api('/api/sessions', { client: 't1', text: 'delta', engine: 'grok' })).id;
  await waitFor('the other reply', async () => (await texts(old)).includes('echo: [rules] delta | remembers: nothing'));

  await stopDocket();
  // An older session has no record of Grok's own id for its conversation.
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  assert.ok(state.sessions[id].grokConversation, 'Docket keeps Grok\'s id for the conversation');
  delete state.sessions[old].grokConversation;
  fs.writeFileSync(STATE, JSON.stringify(state));
  await startDocket();

  const before = await said(id);
  assert.deepEqual(before.filter((t) => !t.startsWith('Hello')), ['> gamma', 'echo: [rules] gamma | remembers: nothing'], 'the chat shows after a restart');
  assert.equal(await ask(id, 'epsilon'), 'echo: epsilon | remembers: gamma');
  assert.ok((await said(id)).includes('> gamma'), 'and still shows once picked up again');

  assert.equal(await ask(old, 'zeta'), 'echo: [rules] zeta | remembers: nothing', 'a new conversation, with the rules');
  const shown = await said(old);
  assert.ok(shown.includes('> delta') && shown.includes('echo: [rules] delta | remembers: nothing'), 'its earlier chat still shows');
  const note = /Grok could not pick up its earlier conversation, so this is a new one/;
  assert.ok((await notes(old)).some((n) => note.test(n)), 'it says it is a new conversation');
  await end(old);
  await waitFor('the old session to stop', async () => !(await api(`/api/sessions/${old}/events?client=t1`)).session);
  assert.ok((await notes(old)).some((n) => note.test(n)), 'the note stays in the chat after End');
});
