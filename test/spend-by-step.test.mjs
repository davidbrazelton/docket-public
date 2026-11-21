// Tests for spend by step (steps.mjs, #1094): which tool calls a session's spend went on. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSession, priceReplies, loadPrices, summarize, sessionLogFiles } from '../costs.mjs';
import { attributeSteps, stepDays, stepView, commandKind, TURN_START } from '../steps.mjs';

const prices = loadPrices(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pricing.json'));
const T0 = Date.parse('2026-11-10T15:00:00Z');
const ts = (s) => new Date(T0 + s * 1000).toISOString();
let n = 0;
const usage = (o = {}) => ({ input_tokens: 10, output_tokens: 200, cache_read_input_tokens: 20000, cache_creation: { ephemeral_1h_input_tokens: 1000, ephemeral_5m_input_tokens: 0 }, ...o });
const said = (s, text, extra = {}) => ({ type: 'user', uuid: `u${n++}`, timestamp: ts(s), message: { role: 'user', content: text }, ...extra });
const reply = (s, req, content, u = usage(), extra = {}) => ({ type: 'assistant', uuid: `a${n++}`, requestId: req, timestamp: ts(s),
  message: { id: `msg_${req}`, model: 'claude-opus-5-5', content, usage: u }, ...extra });
const call = (id, name, input) => ({ type: 'tool_use', id, name, input });
const result = (s, id, text, extra = {}) => ({ type: 'user', uuid: `u${n++}`, timestamp: ts(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, ...extra });

// A turn: a message; a call that runs git diff and a Read side by side; a call that reads both and starts a helper
// agent; the agent's own two calls in its log; the call that reads its answer.
function sampleSession() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steps-'));
  const id = 'sess-1', main = path.join(dir, `${id}.jsonl`);
  const lines = [
    said(0, 'Look at the diff'),
    reply(1, 'r1', [call('t1', 'Bash', { command: 'cd /c/x && git diff --stat' })]),
    reply(1, 'r1', [call('t2', 'Read', { file_path: 'C:/x/a.js' })]), // the same reply, a second line
    result(2, 't1', 'x'.repeat(3000)),
    result(2, 't2', 'y'.repeat(1000)),
    reply(3, 'r2', [call('t3', 'Agent', { description: 'Survey the code', subagent_type: 'Explore', prompt: 'look' })], usage({ cache_creation: { ephemeral_1h_input_tokens: 4000, ephemeral_5m_input_tokens: 0 } })),
    result(30, 't3', 'z'.repeat(500)),
    reply(31, 'r3', [{ type: 'text', text: 'Done.' }]),
  ];
  fs.writeFileSync(main, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const sub = path.join(dir, id, 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'), [
    said(4, 'look', { isSidechain: true }),
    reply(5, 's1', [call('i1', 'Grep', { pattern: 'foo' })], usage(), { isSidechain: true }),
    result(6, 'i1', 'w'.repeat(8000), { isSidechain: true }),
    reply(7, 's2', [{ type: 'text', text: 'Found it.' }], usage(), { isSidechain: true }),
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
  fs.writeFileSync(path.join(sub, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Survey the code', toolUseId: 't3' }));
  const { replies, compactions, agentFiles } = readSession(sessionLogFiles(main, id));
  return { priced: priceReplies(replies, compactions, prices), agentFiles };
}

test('each call is charged to the tool results it read, and the steps add up to the session', () => {
  const { priced, agentFiles } = sampleSession();
  const byKey = Object.fromEntries(priced.map((r) => [r.key, r]));
  const { steps, loose } = attributeSteps(priced, agentFiles);
  const step = (id) => steps.find((s) => s.id === id);
  // The first call of the turn read a message, not a tool result.
  assert.deepEqual(loose.map((l) => l.tool), [TURN_START]);
  assert.equal(loose[0].cost, byKey.r1.cost);
  // r2 read both results: its new tokens split 3:1 by size, the rest evenly.
  const r2 = byKey.r2, fresh = r2.parts.input + r2.parts.cacheWrite1h + r2.parts.cacheWrite5m, rest = r2.cost - fresh;
  assert.ok(Math.abs(step('t1').cost - (rest / 2 + fresh * 0.75)) < 1e-9);
  assert.ok(Math.abs(step('t2').cost - (rest / 2 + fresh * 0.25)) < 1e-9);
  assert.equal(step('t1').detail, 'git diff');
  assert.equal(step('t1').chars, 3000);
  assert.equal(step('t1').label, 'git diff --stat', 'the cd it starts with is left out');
  // The helper agent is one step: both its calls, and the call that read its answer.
  const agent = step('t3');
  assert.equal(agent.detail, 'Explore');
  assert.ok(Math.abs(agent.inner - (byKey.s1.cost + byKey.s2.cost)) < 1e-9);
  assert.ok(Math.abs(agent.cost - (byKey.s1.cost + byKey.s2.cost + byKey.r3.cost)) < 1e-9);
  assert.equal(step('i1'), undefined, 'a call inside the agent is not a step of its own');
  // Asked: the output of the call that made the step, split over the calls it made.
  assert.ok(Math.abs(step('t1').asked - byKey.r1.parts.output / 2) < 1e-9);
  // Everything adds up to the session's total.
  const total = steps.reduce((a, s) => a + s.cost, 0) + loose.reduce((a, l) => a + l.cost, 0);
  assert.ok(Math.abs(total - summarize(priced).cost) < 1e-9);
  assert.ok(Math.abs(stepView({ steps, loose }).total - summarize(priced).cost) < 1e-9);
});

test('a helper agent log with no .meta.json is a step of its own', () => {
  const { priced } = sampleSession();
  const { steps, loose } = attributeSteps(priced, []); // as if the meta were missing
  const own = steps.find((s) => s.id.startsWith('agent:'));
  assert.ok(own, 'an agent step for the log');
  assert.equal(own.tool, 'Agent');
  const total = steps.reduce((a, s) => a + s.cost, 0) + loose.reduce((a, l) => a + l.cost, 0);
  assert.ok(Math.abs(total - summarize(priced).cost) < 1e-9);
});

test('per-day lines and the session view', () => {
  const { priced, agentFiles } = sampleSession();
  const s = attributeSteps(priced, agentFiles);
  const days = stepDays(s);
  assert.deepEqual(days.map((d) => d.Tool).sort(), ['(start of turn)', 'Agent', 'Bash', 'Read'].sort());
  assert.ok(days.every((d) => d.Date === days[0].Date && d.Steps === 1));
  const v = stepView(s);
  assert.equal(v.kinds[0].tool, 'Agent');
  assert.equal(v.top[0].label, 'Survey the code');
  assert.ok(v.untied[TURN_START] > 0);
});

test('a shell command in a word or two', () => {
  assert.equal(commandKind('git diff --stat'), 'git diff');
  assert.equal(commandKind('cd /c/Projects/x && git -C ../y log --oneline'), 'git log');
  assert.equal(commandKind('GH_TOKEN=$(gh auth token -u someone) gh pr view 12'), 'gh pr');
  assert.equal(commandKind('export A=1; npm test 2>&1 | tail -5'), 'npm test');
  assert.equal(commandKind('for f in a b; do sed -n 1,5p $f; done'), 'sed');
  assert.equal(commandKind('python -m pytest -q'), 'python -m pytest');
  assert.equal(commandKind('C:/tools/node.exe server.mjs'), 'node');
  assert.equal(commandKind('$env:PORTAL_PORT=4401; node server.mjs'), 'node');
  assert.equal(commandKind('echo "--- log"; git log -3'), 'git log');
  assert.equal(commandKind('echo hello > out.txt'), 'echo');
  assert.equal(commandKind(''), '');
});
