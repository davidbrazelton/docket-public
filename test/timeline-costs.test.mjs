// Tests for costs in the session Timeline (profile.mjs sessionTimeline with prices, #783). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionTimeline } from '../profile.mjs';
import { loadPrices, sessionCost } from '../costs.mjs';

const PRICING = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pricing.json');
const prices = loadPrices(PRICING);
const T0 = Date.parse('2026-11-01T12:00:00Z'), MIN = 60000;
const ts = (m) => new Date(T0 + m * MIN).toISOString();
const usage = (out, read = 10000, w1h = 500) => ({ input_tokens: 5, output_tokens: out, cache_read_input_tokens: read, cache_creation: { ephemeral_1h_input_tokens: w1h, ephemeral_5m_input_tokens: 0 } });
let uid = 0;
const you = (m, text) => ({ type: 'user', uuid: `u${++uid}`, timestamp: ts(m), message: { role: 'user', content: text } });
const result = (m, id, text = 'done', extra = {}) => ({ type: 'user', uuid: `u${++uid}`, timestamp: ts(m), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, ...extra });
const line = (m, req, block, u, model = 'claude-opus-5-5', extra = {}) => ({ type: 'assistant', uuid: `a${++uid}`, requestId: req, timestamp: ts(m), message: { id: `msg_${req}`, model, role: 'assistant', content: [block], usage: u }, ...extra });
const text = (t) => ({ type: 'text', text: t });
const tool = (id, name, input = {}) => ({ type: 'tool_use', id, name, input });

function session(lines, agents = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-costs-'));
  const id = `s${Math.random().toString(36).slice(2)}`;
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  for (const [name, { meta, lines: al }] of Object.entries(agents)) {
    const sub = path.join(dir, id, 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, `agent-${name}.jsonl`), al.map((l) => JSON.stringify(l)).join('\n') + '\n');
    if (meta) fs.writeFileSync(path.join(sub, `agent-${name}.meta.json`), JSON.stringify(meta));
  }
  return { file, id, append: (more) => fs.appendFileSync(file, more.map((l) => JSON.stringify(l)).join('\n') + '\n') };
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-4, `${a} ≈ ${b}`);
const find = (t, f) => t.entries.find(f);

test('a reply\'s cost shows once, on its first entry, though its text and tool calls come on several lines', () => {
  const s = session([
    you(0, 'Fix the bug'),
    line(0.1, 'r1', text('Looking.'), usage(100)),
    line(0.1, 'r1', tool('t1', 'Read', { file_path: 'a.js' }), usage(300)),
    line(0.1, 'r1', tool('t2', 'Grep', { pattern: 'x' }), usage(300)),
    result(0.2, 't1'), result(0.2, 't2'),
    line(0.3, 'r2', text('Fixed.'), usage(200)),
  ]);
  const t = sessionTimeline(s.file, { prices });
  const costed = t.entries.filter((e) => e.cost?.reply);
  assert.deepEqual(costed.map((e) => e.title), ['Claude', 'Claude']);
  assert.equal(find(t, (e) => e.toolId === 't1').cost, undefined);
  assert.equal(find(t, (e) => e.toolId === 't2').cost, undefined);
  // the same numbers as the Details panel and the Usage page
  near(costed[0].cost.reply + costed[1].cost.reply, sessionCost(s.file, s.id, PRICING).cost);
});

test('each message that starts a turn carries everything up to the next one; helper agents roll up onto their Agent call', () => {
  const s = session([
    you(0, 'First'),
    line(0.1, 'r1', tool('ag1', 'Agent', { description: 'look around', prompt: 'go' }), usage(100)),
    result(5, 'ag1', 'the agent\'s answer'),
    line(5.1, 'r2', text('Done.'), usage(100)),
    you(10, 'Second'),
    line(10.1, 'r3', text('Ok.'), usage(50)),
  ], { abc: { meta: { toolUseId: 'ag1' }, lines: [
    line(1, 'sa1', tool('x1', 'Read', { file_path: 'b' }), usage(800, 20000, 3000), 'claude-sonnet-5-5', { isSidechain: true }),
    line(2, 'sa2', text('found it'), usage(400, 20000, 0), 'claude-sonnet-5-5', { isSidechain: true }),
  ] } });
  const t = sessionTimeline(s.file, { prices });
  const total = sessionCost(s.file, s.id, PRICING);
  const agent = find(t, (e) => e.toolId === 'ag1');
  near(agent.cost.agents, total.subagents);
  assert.ok(agent.cost.reply > 0, 'the Agent call keeps its own reply\'s cost as well');
  const [first, second] = t.entries.filter((e) => e.title === 'You');
  near(first.cost.turn + second.cost.turn, total.cost);
  near(second.cost.turn, find(t, (e) => e.textId === 'msg_r3:0').cost.reply);
  near(first.cost.turn, agent.cost.reply + agent.cost.agents + find(t, (e) => e.textId === 'msg_r2:0').cost.reply);
});

test('a reply after the cache ran out is marked, and a compaction shows its cost, cold or not', () => {
  const s = session([
    you(0, 'Go'),
    line(0.1, 'r1', text('One.'), usage(100)),
    you(90, 'Back after lunch'),
    line(90.1, 'r2', text('Two.'), usage(100)),
    { type: 'system', subtype: 'compact_boundary', uuid: 'cb1', timestamp: ts(200), compactMetadata: { preTokens: 150000, durationMs: 50000 } },
    { type: 'user', uuid: 'cs1', isCompactSummary: true, timestamp: ts(200.01), message: { role: 'user', content: 'Summary of the conversation so far' } },
    line(200.1, 'r3', text('Three.'), usage(100, 0, 20000)),
  ]);
  const t = sessionTimeline(s.file, { prices });
  assert.equal(find(t, (e) => e.textId === 'msg_r1:0').cost.expired, undefined);
  assert.equal(find(t, (e) => e.textId === 'msg_r2:0').cost.expired, true);
  const cp = find(t, (e) => e.title === 'Conversation compacted');
  assert.equal(cp.cost.compact, 'cold'); // the last reply was 110 minutes before it
  assert.ok(cp.cost.reply > 1, `a cold compaction of 150k tokens costs over $1, got ${cp.cost.reply}`);
  assert.equal(find(t, (e) => e.textId === 'msg_r3:0').cost.after, true);
  assert.equal(t.entries.filter((e) => e.cost?.turn).length, 2, 'the compact summary starts no turn');
  near(t.entries.reduce((a, e) => a + (e.cost?.turn || 0), 0), sessionCost(s.file, s.id, PRICING).cost);
});

test('replies with no price show no amounts, not $0', () => {
  const s = session([you(0, 'Hi'), line(0.1, 'r1', text('Hello.'), usage(100), 'some-unknown-model')]);
  const t = sessionTimeline(s.file, { prices });
  assert.ok(t.entries.every((e) => e.cost === undefined));
});

test('it stays incremental: new lines are read on, and only entries whose costs changed come again', () => {
  const s = session([you(0, 'Go'), line(0.1, 'r1', text('One.'), usage(100))]);
  const t1 = sessionTimeline(s.file, { prices });
  const v = t1.v, pos = t1.pos;
  const msg = find(t1, (e) => e.title === 'You'), turn1 = msg.cost.turn;
  assert.equal(sessionTimeline(s.file, { prices }).v, v, 'nothing new, nothing changed');
  s.append([line(0.5, 'r2', text('Two.'), usage(100))]);
  const t2 = sessionTimeline(s.file, { prices });
  assert.equal(t2, t1, 'the same reading, carried on');
  assert.ok(t2.pos > pos);
  const changed = t2.entries.filter((e) => e.v > v).map((e) => e.title).sort();
  assert.deepEqual(changed, ['Claude', 'You'], 'the new reply, and the turn total it added to');
  assert.ok(msg.cost.turn > turn1);
});
