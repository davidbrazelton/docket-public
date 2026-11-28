// What Claude Code's hooks do shows in the session's chat (#1207): a prompt a UserPromptSubmit hook blocked is an
// error there and puts the row in the problem state, a tool call a PreToolUse hook denied says so on its step, and a
// hook that failed is a Hook line. Runs a throwaway Docket (its own ports, state and company list in a temp folder)
// whose Claude Code is the stand-in in test-fixtures/fake-claude-hooks.mjs, which sends what the real one sends.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePorts, stopTree, TEST_DOCKET_ENV } from './free-port.mjs';
import { promptBlock, refusal, hookResponseNote } from '../hook-notes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const [PORT, RUNNER_PORT] = await freePorts(2);
const URL_ = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-1207-'));
let server;

const api = async (p, body) => {
  const r = await fetch(URL_ + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, fn, ms = 30000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > until) throw new Error('Timed out waiting for ' + what);
    await sleep(150);
  }
}
const view = (id) => api(`/api/sessions/${id}/events?client=t1`);
const idle = (id) => waitFor(`${id} to be idle`, async () => (await view(id)).session.status === 'idle');

before(async () => {
  const c = { id: 't1', name: 'T1', home: path.join(tmp, 'claude-home'), folder: path.join(tmp, 'work') };
  for (const d of [c.home, c.folder]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'clients.json'), JSON.stringify([c]));
  fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify({ sessions: {}, updates: { minutes: 0 } }));
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, ...TEST_DOCKET_ENV, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_CLIENTS: path.join(tmp, 'clients.json'),
      PORTAL_STATE: path.join(tmp, 'state.json'), PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: path.join(tmp, 'data'),
      PORTAL_CLAUDE_SDK_EXE: path.join(ROOT, 'test-fixtures', 'fake-claude-hooks.mjs') },
  });
  await waitFor('the test Docket to start', () => api('/api/clients?quick=1'));
});

after(async () => {
  const runner = await fetch(`http://127.0.0.1:${RUNNER_PORT}/health`).then((r) => r.json()).catch(() => null);
  server?.kill();
  if (runner?.pid) stopTree(runner.pid);
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 });
});

test('a blocked prompt, a denied tool call and a failed hook reach the chat', async () => {
  const id = (await api('/api/sessions', { client: 't1', text: 'hello', settings: { permissionMode: 'bypassPermissions' } })).id;
  await waitFor('the first reply', async () => (await view(id)).events.some((e) => e.k === 'text' && e.text.startsWith('got: hello')));
  await idle(id);
  // The SessionStart hook that failed: a Hook line, and the row is not a problem for it.
  let v = await view(id);
  assert.ok(v.events.some((e) => e.k === 'hook' && /SessionStart:startup hook failed \(exit code 1\): SessionStart check failed: proxy not reachable/.test(e.text)), 'the failed hook is in the chat');
  assert.ok(!v.session.lastError, 'a failed SessionStart hook is not a problem on the row');

  // A prompt the hook blocks: an error naming the hook event and its reason, and the row shows the problem.
  await api(`/api/sessions/${id}/send?client=t1`, { text: 'please work on BLOCKME' });
  v = await waitFor('the blocked prompt error', async () => { const x = await view(id); return x.events.some((e) => e.k === 'error') && x.session.status === 'idle' ? x : null; });
  const err = v.events.find((e) => e.k === 'error');
  assert.match(err.text, /^A UserPromptSubmit hook blocked this message: Prompts naming project BLOCKME are not allowed by policy XYZ-12\n/);
  assert.match(v.session.lastError?.text || '', /UserPromptSubmit hook blocked this message: Prompts naming project BLOCKME/, 'the row is in the problem state');
  assert.equal(v.events.filter((e) => e.k === 'error').length, 1, 'one error, not repeated by the turn end');
  assert.ok(!v.events.some((e) => e.k === 'hook' && /UserPromptSubmit/.test(e.text)), 'no second Hook line for the same block');
  assert.equal(v.events.findLast((e) => e.k === 'result').error, true, 'its Done line says Stopped');

  // A turn that gets through clears the problem; a tool call a hook denies says so on its step.
  await api(`/api/sessions/${id}/send?client=t1`, { text: 'run DENYTOOL' });
  v = await waitFor('the denied tool call', async () => { const x = await view(id); return x.events.some((e) => e.k === 'text' && /hook turned it down/.test(e.text)) && x.session.status === 'idle' ? x : null; });
  const step = v.events.find((e) => e.k === 'tool' && e.name === 'Bash');
  assert.equal(step.status, 'error');
  assert.deepEqual(step.refused, { source: 'hook', reason: 'Bash is off by company policy', tag: 'Stopped by a hook: Bash is off by company policy' });
  const note = v.events.find((e) => e.k === 'refused');
  assert.equal(note?.id, `refused-${step.id}`, 'a line in the chat for it, under the step');
  assert.equal(note.tag, 'Stopped by a hook: Bash is off by company policy');
  assert.equal(v.events.findLast((e) => e.k === 'result').refused, 1, 'its Done line counts it');
  assert.ok(!v.session.lastError, 'a turn that got through clears the problem');

  // A step the Auto mode check turns down (#1235): its tag, one line in the chat, and the Done line's count.
  await api(`/api/sessions/${id}/send?client=t1`, { text: 'run AUTODENY' });
  v = await waitFor('the refused tool call', async () => { const x = await view(id); return x.events.some((e) => e.k === 'text' && /Auto mode turned that down/.test(e.text)) && x.session.status === 'idle' ? x : null; });
  const auto = v.events.findLast((e) => e.k === 'tool' && e.name === 'Bash');
  assert.equal(auto.refused?.tag, 'Turned down by Auto mode: Interfere With Workloads');
  assert.equal(v.events.filter((e) => e.k === 'refused' && e.id === `refused-${auto.id}`).length, 1, 'one line in the chat for the step');
  assert.equal(v.events.find((e) => e.id === `refused-${auto.id}`).step, 'Bash kill 4410');
  assert.equal(v.events.findLast((e) => e.k === 'result').refused, 1);
});

test("a session starts with Docket's Auto mode rules and its named portal tools (#1262)", async () => {
  // The desk's own allow list has no "$defaults": the user dropped the built-ins, so Docket's allow list leaves it out too.
  const own = path.join(tmp, 'claude-home', 'settings.json');
  fs.writeFileSync(own, JSON.stringify({ autoMode: { allow: ['my own rule'] } }));
  const id = (await api('/api/sessions', { client: 't1', text: 'SHOWARGS', settings: { permissionMode: 'auto' } })).id;
  const said = await waitFor('the args', async () => (await view(id)).events.find((e) => e.k === 'text' && e.text.startsWith('args: '))?.text);
  fs.rmSync(own);
  const { settings, allowedTools } = JSON.parse(said.slice(6));
  const auto = JSON.parse(settings).autoMode;
  assert.ok(!auto.allow.includes('$defaults'), 'the user dropped the built-in allow rules');
  assert.ok(auto.allow.some((r) => r.includes('git worktree remove (no --force)')));
  assert.equal(auto.environment[0], '$defaults');
  const tools = allowedTools.split(',');
  for (const t of ['close_session', 'propose_to_desk', 'plan_create', 'recycle', 'mark_turn']) assert.ok(tools.includes(`mcp__portal__${t}`), t);
  for (const t of ['start_session', 'screen_shot', 'mouse_click', 'key_type', 'create_schedule']) assert.ok(!tools.includes(`mcp__portal__${t}`), t);
  assert.ok(!tools.some((t) => t.endsWith('*')), 'never a wildcard');
});

test('the page shows a Hook line and a step stopped by a hook', () => {
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(page, /case 'hook': return `<div class="err bx k-warn"><span class="pill">Hook<\/span> \$\{esc\(ev\.text\)\}/);
  assert.match(page, /ev\.refused \? `<span class="refused-tag" title="\$\{esc\(ev\.refused\.reason\)\}">\$\{esc\(ev\.refused\.tag\)\}/);
  assert.match(page, /if \(m\.ev\.refused\) ev\.refused = m\.ev\.refused;/, 'a live step result carries it');
});

test('hook-notes reads what Claude Code sends', () => {
  // A block by a JSON decision has the same informational message, sometimes without the outcome.
  const b = promptBlock({ type: 'system', subtype: 'informational', content: 'UserPromptSubmit operation blocked by hook:\n[guard]: No secrets in prompts\n\nOriginal prompt: x' });
  assert.equal(b.reason, 'No secrets in prompts');
  assert.equal(promptBlock({ type: 'system', subtype: 'informational', content: 'Something else' }), null);
  assert.equal(refusal('Error: PreToolUse:Edit hook error: No edits here', true).reason, 'No edits here');
  assert.equal(refusal('PreToolUse:Bash hook error: x', false), null, 'only an error result');
  assert.equal(refusal('Permission denied', true, { permission_decision: { decision: 'reject', source: 'hook', reason: 'Not on Fridays' } }).reason, 'Not on Fridays');
  assert.equal(refusal('Permission denied', true), null, 'a command that failed on a file is not a refusal');
  const stop = hookResponseNote({ type: 'system', subtype: 'hook_response', hook_event: 'Stop', hook_name: 'Stop', exit_code: 2, outcome: 'error', stderr: 'Run the tests first' });
  assert.equal(stop.text, 'A Stop hook kept Claude working instead of ending the turn: Run the tests first');
  assert.equal(hookResponseNote({ type: 'system', subtype: 'hook_response', hook_event: 'PreToolUse', exit_code: 2, outcome: 'error', stderr: 'no' }), null, 'the step shows it');
  assert.equal(hookResponseNote({ type: 'system', subtype: 'hook_response', hook_event: 'PostToolUse', outcome: 'success' }), null);
});
