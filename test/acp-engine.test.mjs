// Tests for engines/acp.mjs, against a stand-in agent (test-fixtures/fake-acp-agent.mjs). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from '../engines/acp.mjs';

const AGENT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures', 'fake-acp-agent.mjs');

// Runs one turn and returns the messages, the questions asked, and the engine.
async function turn({ permissionMode = 'default', answer = { behavior: 'allow' }, rules = '', env = process.env, allowTools, resume, text = 'hi there', mcpServers = [{ name: 'portal', command: 'x', args: [], env: [] }], mcpHttp } = {}) {
  const items = [];
  const input = { async *[Symbol.asyncIterator]() { yield { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }; await new Promise(() => {}); } };
  const asked = [];
  const q = start({
    options: { command: process.execPath, args: [AGENT], cwd: process.cwd(), env, permissionMode, rules, allowTools, resume, mcpServers, mcpHttp },
    input,
    canUseTool: async (name, inp, opts) => { asked.push({ name, inp, opts }); return answer; },
  });
  for await (const m of q) { items.push(m); if (m.type === 'result') break; }
  q.close();
  return { items, asked };
}

test('streams text, shows the MCP tool the agent calls, and ends the turn', async () => {
  const { items, asked } = await turn();
  assert.equal(items[0].type, 'system');
  assert.equal(items[0].model, 'fake-1');
  const deltas = items.filter((m) => m.event?.type === 'content_block_delta').map((m) => m.event.delta.text);
  assert.deepEqual(deltas.slice(0, 2), ['Hel', 'lo']);
  const tool = items.find((m) => m.type === 'assistant' && m.message.content[0].type === 'tool_use').message.content[0];
  assert.equal(tool.name, 'mcp__portal__present_file');
  assert.deepEqual(tool.input, { paths: ['a.txt'] });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].name, 'mcp__portal__present_file');
  const result = items.find((m) => m.type === 'user').message.content[0];
  assert.equal(result.tool_use_id, 'T1');
  assert.equal(result.content, 'picked yes');
  assert.equal(result.is_error, false);
  const end = items.at(-1);
  assert.equal(end.type, 'result');
  assert.equal(end.subtype, 'success');
  assert.equal(end.result, 'echo: hi there');
});

test('a denied question rejects the tool; "always" picks the allow-always option', async () => {
  const denied = await turn({ answer: { behavior: 'deny', message: 'no' } });
  assert.equal(denied.items.find((m) => m.type === 'user').message.content[0].is_error, true);
  const always = await turn({ answer: { behavior: 'allow', updatedPermissions: [{ acpOption: 'always' }] } });
  assert.equal(always.items.find((m) => m.type === 'user').message.content[0].content, 'picked always');
});

test('Bypass permissions answers the agent without asking', async () => {
  const { items, asked } = await turn({ permissionMode: 'bypassPermissions' });
  assert.equal(asked.length, 0);
  assert.equal(items.find((m) => m.type === 'user').message.content[0].content, 'picked yes');
});

test('Docket\'s rules go ahead of the first message', async () => {
  const { items } = await turn({ rules: 'RULES-HERE' });
  assert.match(items.at(-1).result, /^echo: \(From Docket: your standing/);
});

test('a tool on the allowTools list runs without asking, in any mode', async () => {
  const { items, asked } = await turn({ allowTools: ['mcp__portal__present_file'] });
  assert.equal(asked.length, 0);
  assert.equal(items.find((m) => m.type === 'user').message.content[0].content, 'picked yes');
  const other = await turn({ allowTools: ['mcp__portal__send_to_session'] });
  assert.equal(other.asked.length, 1, 'a tool not on the list still asks');
});

// an agent that stops by itself, even with exit code 0, ends the session with an error, never in silence.
test('an agent that quits mid-turn is an error, whatever its exit code', async () => {
  await assert.rejects(turn({ env: { ...process.env, FAKE_ACP_QUIT: 'session/prompt' } }), /stopped before it answered \(exit code 0\)/);
});

test('an agent that quits while starting is an error', async () => {
  await assert.rejects(turn({ env: { ...process.env, FAKE_ACP_QUIT: 'initialize' } }), /stopped while starting/);
});

// a stopped Grok session picked up again continues its own conversation, so Grok remembers it.
for (const how of ['resume', 'load']) {
  test(`picks up the earlier conversation by session/${how}`, async () => {
    const memory = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-memory-'));
    const env = { ...process.env, FAKE_ACP_MEMORY: memory, FAKE_ACP_RESUME: how };
    try {
      const first = await turn({ env, rules: 'RULES-HERE', text: 'the word is PINEAPPLE' });
      const id = first.items.at(-1).session_id;
      assert.equal(first.items[0].resumed, undefined, 'a new session asks nothing to be picked up');
      const again = await turn({ env, rules: 'RULES-HERE', resume: id, text: 'what was the word?' });
      assert.equal(again.items[0].resumed, true);
      assert.equal(again.items.at(-1).session_id, id, 'the same conversation');
      // Docket's rules went at the start of the conversation ([rules]), and not again on pickup.
      assert.equal(first.items.at(-1).result, 'echo: [rules] the word is PINEAPPLE | remembers: nothing');
      assert.equal(again.items.at(-1).result, 'echo: what was the word? | remembers: the word is PINEAPPLE');
      const said = again.items.filter((m) => m.event?.type === 'content_block_delta').map((m) => m.event.delta.text).join('');
      assert.doesNotMatch(said, /REPLAY/, 'the replay of the old conversation is not shown again');
    } finally { fs.rmSync(memory, { recursive: true, force: true }); }
  });
}

test('an agent that cannot pick up a conversation starts a new one and says so', async () => {
  const memory = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-memory-'));
  try {
    const env = { ...process.env, FAKE_ACP_MEMORY: memory, FAKE_ACP_RESUME: '' };
    const first = await turn({ env, text: 'one' });
    const again = await turn({ env, rules: 'RULES-HERE', resume: first.items.at(-1).session_id, text: 'two' });
    assert.equal(again.items[0].resumed, false);
    assert.notEqual(again.items.at(-1).session_id, first.items.at(-1).session_id);
    assert.equal(again.items.at(-1).result, 'echo: [rules] two | remembers: nothing', 'a new conversation gets the rules');
    // A conversation the agent no longer has is the same: a new one.
    const gone = await turn({ env: { ...env, FAKE_ACP_RESUME: 'resume' }, resume: 'S-missing', text: 'three' });
    assert.equal(gone.items[0].resumed, false);
    assert.equal(gone.items.at(-1).result, 'echo: three | remembers: nothing');
  } finally { fs.rmSync(memory, { recursive: true, force: true }); }
});

test('the desk browser server goes over HTTP only to an agent that says it takes HTTP servers (#757)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-http-'));
  const seen = path.join(dir, 'seen.json');
  const playwright = { name: 'playwright', command: 'node', args: ['cli.js'], env: [] };
  const mcpServers = [{ name: 'portal', command: 'x', args: [], env: [] }, playwright];
  const mcpHttp = { playwright: 'http://localhost:1234/mcp' };
  try {
    await turn({ env: { ...process.env, FAKE_ACP_SEEN: seen, FAKE_ACP_HTTP: '1' }, mcpServers, mcpHttp });
    const http = JSON.parse(fs.readFileSync(seen, 'utf8'));
    assert.deepEqual(http[1], { type: 'http', name: 'playwright', url: 'http://localhost:1234/mcp', headers: [] });
    assert.equal(http[0].command, 'x', 'a server with no HTTP address stays as it was');
    await turn({ env: { ...process.env, FAKE_ACP_SEEN: seen }, mcpServers, mcpHttp });
    assert.deepEqual(JSON.parse(fs.readFileSync(seen, 'utf8'))[1], playwright, 'without the capability it keeps its own');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
