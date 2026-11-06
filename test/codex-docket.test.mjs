// Codex sessions in Docket, end to end on a throwaway Docket (its own ports, state and company list in a temp
// folder) whose Codex is the stand-in in fixtures/fake-codex.mjs and whose Grok is fixtures/fake-acp-agent.mjs.
// Company t1 uses Codex (by default) and Grok; company t2 uses Grok only. Covers the sign-in, a chat with a
// permission question and Docket's tools, End and pickup with memory, an app restart, usage under t1, a Codex
// session messaging a Grok one with no approval, and ask_desk and propose_to_desk (and their old names) into a Codex desk.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
// Ports the computer says are free, not fixed ones: other copies of Docket on this computer run this file at the same
// time, and a run that stops "its" runner by a fixed port would stop another run's, cutting off its turns (#582).
const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer().once('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});
const PORT = await freePort(), RUNNER_PORT = await freePort();
const URL_ = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-260-'));
const STATE = path.join(tmp, 'state.json');
const CODEX_HOME = path.join(tmp, 'codex-home');
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
const events = async (id, client = 't1') => (await api(`/api/sessions/${id}/events?client=${client}`)).events || [];
const texts = async (id, client) => (await events(id, client)).filter((e) => e.k === 'text').map((e) => e.text);
const said = (id) => events(id).then((evs) => evs.filter((e) => e.k === 'user' || e.k === 'text').map((e) => (e.k === 'user' ? '> ' : '') + e.text));
const reply = (id, start, client) => waitFor(`a reply starting "${start}"`, async () => (await texts(id, client)).find((t) => t.startsWith(start)));
const end = (id, client = 't1') => api(`/api/sessions/${id}/end?client=${client}`, {});
const stopped = (id) => waitFor('the session to stop', async () => !(await api(`/api/sessions/${id}/events?client=t1`)).session);
const runnerPid = () => fetch(`http://127.0.0.1:${RUNNER_PORT}/health`).then((r) => r.json()).then((h) => h.pid).catch(() => null);
// Answers the newest open card of a kind in a session: a permission question (allow) or a crossing (send).
async function approve(id, client, kind) {
  const ev = await waitFor(`a ${kind} card`, async () => (await events(id, client)).find((e) => e.k === kind && e.state === 'pending'));
  await api(`/api/sessions/${id}/${kind}?client=${client}`, kind === 'cross' ? { crossId: ev.id, send: true } : { reqId: ev.id, allow: true });
  return ev;
}

async function startDocket() {
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_CLIENTS: path.join(tmp, 'clients.json'),
      PORTAL_REPORT_DEBOUNCE: '{"quietMs":0,"maxMs":0}', PORTAL_STATE: STATE, PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: path.join(tmp, 'data'),
      PORTAL_CODEX_EXE: path.join(HERE, 'fixtures', 'fake-codex.mjs'), PORTAL_GROK_EXE: path.join(HERE, 'fixtures', 'fake-acp-agent.mjs'),
      CODEX_HOME: path.join(tmp, 'shared-codex') }, // the Codex home of sessions run outside Docket: not this computer's own
  });
  await waitFor('the test Docket to start', () => api('/api/clients?quick=1'), 30000);
}
async function stopDocket() {
  await sleep(500); // Docket saves its state 200 ms after a change
  const pid = await runnerPid();
  server.kill();
  if (pid) try { process.kill(pid); } catch {}
  await waitFor('Docket to stop', async () => !(await runnerPid()) && !(await api('/api/clients?quick=1').catch(() => null)));
}

before(async () => {
  const t1 = { id: 't1', name: 'T1', home: path.join(tmp, 'claude-1'), folder: path.join(tmp, 'work-1'), grokHome: path.join(tmp, 'grok-1'), codexHome: CODEX_HOME, defaultEngine: 'codex' };
  const t2 = { id: 't2', name: 'T2', home: path.join(tmp, 'claude-2'), folder: path.join(tmp, 'work-2'), grokHome: path.join(tmp, 'grok-2'), defaultEngine: 'grok', brandsOff: ['claude'] };
  for (const d of [t1.home, t1.folder, t1.grokHome, t2.home, t2.folder, t2.grokHome]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'clients.json'), JSON.stringify([t1, t2]));
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

test('a company signs in to Codex in its own Codex home, with a link and a separate code', async () => {
  // Only Codex's sign-in is checked: the other brands' checks would run the real claude, and the stand-in Grok.
  const codexOf = () => api('/api/clients/t1/auth-check?engine=codex', {});
  assert.equal((await codexOf()).signedIn, false);
  const link = await api('/api/clients/t1/login?engine=codex', {});
  assert.deepEqual(link, { url: 'https://auth.openai.com/codex/device', auto: true, code: 'AB12-CD3EF' });
  const done = await api('/api/clients/t1/login-code?engine=codex', {});
  assert.equal(done.loggedIn, true);
  assert.ok(fs.existsSync(path.join(CODEX_HOME, 'auth.json')), 'the sign-in is saved in the company\'s Codex home');
  assert.equal((await codexOf()).signedIn, true);
});

test('a Codex session chats, asks permission, calls Docket\'s tools, and messages a Grok session with no approval', async () => {
  const grok = (await api('/api/sessions', { client: 't1', text: 'hello grok', engine: 'grok', settings: { permissionMode: 'default' } })).id;
  await reply(grok, 'got: hello grok');
  const id = (await api('/api/sessions', { client: 't1', text: 'CALL rename_session {"title":"Codex test","asked_by_user":true}', settings: { permissionMode: 'default' } })).id;
  const s = (await api(`/api/sessions/${id}/events?client=t1`)).session;
  assert.equal(s.engine, 'codex', 'Codex is the company\'s default brand');
  const card = await approve(id, 't1', 'permission');
  assert.equal(card.tool, 'mcp__portal__rename_session');
  assert.match(await reply(id, 'called rename_session'), /called rename_session: .*Codex test/);

  await api(`/api/sessions/${id}/send?client=t1`, { text: `CALL send_to_session ${JSON.stringify({ id: grok, message: 'ping from codex' })}` });
  await reply(id, 'called send_to_session');
  assert.ok(!(await events(id)).some((e) => e.k === 'permission' && e.state === 'pending' && e.tool === 'mcp__portal__send_to_session'), 'no approval card for messaging in the company');
  await reply(grok, 'got: ping from codex');
  // The Grok session is not the Codex session's child, but its finished turn reports to the sender.
  await waitFor('the report to the sender', async () => (await events(id)).some((e) => e.k === 'child-report' && e.childId === grok && e.sent));
  await end(grok);
  await end(id);
});

test('a Codex session stopped with End keeps its chat and, picked up again, Codex remembers it', async () => {
  const id = (await api('/api/sessions', { client: 't1', text: 'alpha' })).id;
  assert.equal(await reply(id, 'echo:'), 'echo: [rules] alpha | remembers: nothing');
  await end(id);
  await stopped(id);
  assert.deepEqual((await said(id)).filter((t) => t !== 'Hello'), ['> alpha', 'echo: [rules] alpha | remembers: nothing'], 'the chat shows after End');
  await api(`/api/sessions/${id}/send?client=t1`, { text: 'beta' });
  assert.equal(await reply(id, 'echo: [rules] beta'), 'echo: [rules] beta | remembers: alpha', 'Codex picked up its own conversation');
  await end(id);
});

test('after a Docket restart a Codex session shows its chat and remembers; its usage counts under its company', async () => {
  const id = (await api('/api/sessions', { client: 't1', text: 'gamma' })).id;
  await reply(id, 'echo: [rules] gamma');
  await stopDocket();
  assert.ok(JSON.parse(fs.readFileSync(STATE, 'utf8')).sessions[id].codexConversation, 'Docket keeps Codex\'s id for the conversation');
  await startDocket();
  assert.ok((await said(id)).includes('> gamma'), 'the chat shows after a restart');
  await api(`/api/sessions/${id}/send?client=t1`, { text: 'delta' });
  assert.equal(await reply(id, 'echo: [rules] delta'), 'echo: [rules] delta | remembers: gamma');
  const rows = await waitFor('the usage rows', async () => {
    const r = (await api('/api/usage/report')).rows.filter((x) => x.SessionId === id);
    return r.length ? r : null;
  });
  assert.equal(rows[0].Brand, 'codex');
  assert.equal(rows[0].Client, 't1');
  assert.equal(rows[0].Gone, '');
  await end(id);
});

test('ask_desk into a Codex desk is answered by a read-only Codex session; propose_to_desk starts on Codex', async () => {
  const from = (await api('/api/sessions', { client: 't2', text: 'hi', settings: { permissionMode: 'default' } })).id;
  await reply(from, 'got: hi', 't2');
  await api(`/api/sessions/${from}/send?client=t2`, { text: `CALL portal__ask_desk ${JSON.stringify({ desk: 'T1', question: 'pricing sheet' })}` });
  await approve(from, 't2', 'permission');
  await approve(from, 't2', 'cross');
  const answer = await reply(from, 'called portal__ask_desk', 't2');
  assert.match(answer, /<desk-report from="T1">\nsearched: /, 'the Codex question session searched T1\'s past sessions through Docket');
  const asked = await waitFor('the question session in T1\'s records', async () =>
    Object.entries(JSON.parse(fs.readFileSync(STATE, 'utf8')).sessions).find(([, r]) => r.client === 't1' && /^Question from T2/.test(r.title || '') && r.codexIds));
  assert.equal(asked[1].engine, 'codex');

  await api(`/api/sessions/${from}/send?client=t2`, { text: `CALL portal__propose_to_desk ${JSON.stringify({ desk: 'T1', title: 'Handed work', brief: 'epsilon' })}` });
  await approve(from, 't2', 'permission');
  await reply(from, 'called portal__propose_to_desk', 't2');
  const card = (await api('/api/sessions?client=t1')).inbox.find((x) => x.title === 'Handed work');
  const child = await api(`/api/inbox/${card.id}/start?client=t1`, {});
  assert.equal(child.engine, 'codex');
  assert.equal(await reply(child.id, 'echo:'), 'echo: [rules] epsilon | remembers: nothing');
  await end(child.id);

  // The names from before the rename still work, with company in place of desk, but are left out of the tool list.
  const token = fs.readFileSync(path.join(tmp, 'data', 'tool-token'), 'utf8').trim();
  const names = (await (await fetch(`${URL_}/api/tools?session=${from}`, { headers: { 'x-docket-token': token } })).json()).map((t) => t.name);
  assert.ok(names.includes('ask_desk') && names.includes('propose_to_desk'), 'the new names are listed');
  assert.ok(!names.includes('ask_company') && !names.includes('propose_to_company'), 'the old names are not');
  await api(`/api/sessions/${from}/send?client=t2`, { text: `CALL portal__ask_company ${JSON.stringify({ company: 'T1', question: 'pricing sheet' })}` });
  await approve(from, 't2', 'permission');
  assert.match(await reply(from, 'called portal__ask_company', 't2'), /<desk-report from="T1">/, 'the old ask_company still asks');
  await api(`/api/sessions/${from}/send?client=t2`, { text: `CALL portal__propose_to_company ${JSON.stringify({ company: 'T1', title: 'Old name work', brief: 'zeta' })}` });
  await approve(from, 't2', 'permission');
  await reply(from, 'called portal__propose_to_company', 't2');
  assert.ok((await api('/api/sessions?client=t1')).inbox.some((x) => x.title === 'Old name work'), 'the old propose_to_company still hands over');
  await end(from, 't2');
});
