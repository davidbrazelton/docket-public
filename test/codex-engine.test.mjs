// Tests for engines/codex.mjs, against a stand-in for `codex app-server` (fixtures/fake-codex.mjs). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start, shownItem } from '../engines/codex.mjs';

const AGENT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-codex.mjs');
const memory = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-'));

// Runs one turn and returns the messages, the questions asked, and the start message.
async function turn({ permissionMode = 'default', answer = { behavior: 'allow' }, rules = '', env = {}, allowTools, denyOthers, resume, text = 'hi there' } = {}) {
  const items = [];
  const input = { async *[Symbol.asyncIterator]() { yield { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }; await new Promise(() => {}); } };
  const asked = [];
  const q = start({
    options: { command: process.execPath, args: [AGENT, 'app-server'], cwd: process.cwd(), env: { ...process.env, CODEX_HOME: memory, FAKE_CODEX_MEMORY: memory, ...env },
      permissionMode, rules, allowTools, denyOthers, resume, config: { mcp_servers: { portal: { command: 'x' } } } },
    input,
    canUseTool: async (name, inp, opts) => { asked.push({ name, inp, opts }); return answer; },
  });
  for await (const m of q) { items.push(m); if (m.type === 'result') break; }
  q.close();
  const results = items.filter((m) => m.type === 'user').map((m) => m.message.content[0]);
  return { items, asked, results, init: items[0], end: items.at(-1) };
}

test('streams text, shows the MCP tool and the command it runs, and ends the turn', async () => {
  const { items, asked, results, init, end } = await turn();
  assert.equal(init.type, 'system');
  assert.equal(init.model, 'fake-codex-1');
  assert.match(init.session_id, /^TH-/);
  const deltas = items.filter((m) => m.event?.type === 'content_block_delta').map((m) => m.event.delta.text);
  assert.deepEqual(deltas.slice(0, 2), ['Hel', 'lo']);
  const tools = items.filter((m) => m.type === 'assistant' && m.message.content[0].type === 'tool_use').map((m) => m.message.content[0]);
  assert.deepEqual(tools.map((t) => t.name), ['mcp__portal__present_file', 'Shell']);
  assert.deepEqual(tools[0].input, { paths: ['a.txt'] });
  assert.deepEqual(tools[1].input, { command: 'echo hi' }, 'a command shows as what was asked, not the shell around it');
  assert.deepEqual(asked.map((a) => a.name), ['mcp__portal__present_file', 'Shell']);
  assert.equal(results[0].content, 'picked accept');
  assert.equal(results[1].content, 'hi');
  assert.equal(results[1].is_error, false);
  assert.equal(end.type, 'result');
  assert.equal(end.subtype, 'success');
  assert.equal(end.result, 'echo: hi there | remembers: nothing');
});

test('a denied question refuses the tool; "always" allows it for the session', async () => {
  const denied = await turn({ answer: { behavior: 'deny', message: 'no' } });
  assert.equal(denied.results[0].is_error, true);
  assert.equal(denied.results[1].is_error, true);
  const always = await turn({ answer: { behavior: 'allow', updatedPermissions: [{ codex: 'session' }] } });
  assert.equal(always.results[0].content, 'picked accept session');
});

test('Bypass permissions answers Codex without asking', async () => {
  const { asked, results } = await turn({ permissionMode: 'bypassPermissions' });
  assert.equal(asked.length, 0);
  assert.equal(results[0].content, 'picked accept');
});

test('a tool on allowTools runs without asking; denyOthers refuses the rest without asking', async () => {
  const allowed = await turn({ allowTools: ['mcp__portal__present_file'] });
  assert.deepEqual(allowed.asked.map((a) => a.name), ['Shell']);
  const locked = await turn({ allowTools: ['mcp__portal__present_file'], denyOthers: true });
  assert.equal(locked.asked.length, 0);
  assert.equal(locked.results[0].content, 'picked accept');
  assert.equal(locked.results[1].is_error, true, 'the command was refused');
});

test("Docket's rules go in as Codex's developer instructions, not as a message", async () => {
  const { end } = await turn({ rules: 'RULES-HERE', text: 'with rules' });
  assert.equal(end.result, 'echo: [rules] with rules | remembers: nothing');
});

test('a conversation picked up again remembers; one Codex no longer has starts a new one', async () => {
  const first = await turn({ text: 'PINEAPPLE-47' });
  const again = await turn({ resume: first.init.session_id, text: 'what was it?' });
  assert.equal(again.init.resumed, true);
  assert.equal(again.init.session_id, first.init.session_id);
  assert.equal(again.end.result, 'echo: what was it? | remembers: PINEAPPLE-47');
  const lost = await turn({ resume: 'TH-gone', text: 'hello?' });
  assert.equal(lost.init.resumed, false);
  assert.notEqual(lost.init.session_id, 'TH-gone');
  assert.equal(lost.end.result, 'echo: hello? | remembers: nothing');
});

test('a failed turn ends with an error result', async () => {
  const { end } = await turn({ env: { FAKE_CODEX_FAIL: 'Not logged in' } });
  assert.equal(end.is_error, true);
  assert.equal(end.result, 'Not logged in');
});

// Codex stopping by itself, even with exit code 0, ends the session with an error, never in silence.
test('Codex quitting mid-turn is an error, whatever its exit code', async () => {
  await assert.rejects(turn({ env: { FAKE_CODEX_QUIT: 'turn/start' } }), /codex stopped before it answered \(exit code 0\)/);
});

test('Codex quitting while starting is an error', async () => {
  await assert.rejects(turn({ env: { FAKE_CODEX_QUIT: 'initialize' } }), /codex stopped while starting/);
});

test('Codex items show as the tools the page knows', () => {
  assert.deepEqual(shownItem({ type: 'fileChange', changes: [{ path: 'C:/a.txt' }] }), { name: 'Edit', input: { file_path: 'C:/a.txt' } });
  assert.deepEqual(shownItem({ type: 'mcpToolCall', server: 'playwright', tool: 'browser_navigate', arguments: { url: 'x' } }), { name: 'mcp__playwright__browser_navigate', input: { url: 'x' } });
  assert.equal(shownItem({ type: 'reasoning' }), null);
});
