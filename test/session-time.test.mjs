// Agent, wait and typing time per session: turns and waits read from a made-up Claude log, waits Docket recorded
// itself, a turn over midnight, and how the seconds sit on the rows so any set of rows adds up to the right total.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSession, timeByDay, addSeconds, sessionRows } from '../costs.mjs';
import { readCodexSession } from '../codex-usage.mjs';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const PRICING = path.join(ROOT, 'pricing.json');
const T0 = new Date(2026, 9, 20, 10, 0, 0).getTime(); // local time, so the day is the same anywhere
const at = (s) => new Date(T0 + s * 1000).toISOString();
let n = 0;
const usage = { input_tokens: 10, output_tokens: 10 };
const prompt = (s, text = 'hi') => ({ type: 'user', uuid: `u${n++}`, timestamp: at(s), message: { role: 'user', content: [{ type: 'text', text }] } });
const reply = (s, content = [{ type: 'text', text: 'ok' }]) => ({ type: 'assistant', uuid: `a${n++}`, requestId: `r${n}`, timestamp: at(s), message: { id: `m${n}`, model: 'claude-opus-5-5', content, usage } });
const result = (s, id) => ({ type: 'user', uuid: `t${n++}`, timestamp: at(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'done' }] } });

function log(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-time-'));
  const file = path.join(dir, 'S1.jsonl');
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}
const LINES = [
  prompt(0),
  reply(10, [{ type: 'tool_use', id: 'b1', name: 'Bash', input: {} }]),
  result(40, 'b1'), // a Bash step Docket asked permission for from 12s to 32s (recorded by the app)
  reply(50, [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: {} }]),
  result(350, 'q1'), // the question form: 5 minutes waiting on the person
  reply(360),
  // an hour with the session open and nothing running: not counted
  prompt(3960, '<task-notification>done</task-notification>'),
  reply(3990),
  { type: 'user', uuid: `s${n++}`, isSidechain: true, timestamp: at(9000), message: { role: 'user', content: 'helper' } }, // a helper's line: not a turn
];

test('turns run from a message to its last reply; question forms are waits', () => {
  const { turns, waits } = readSession([log(LINES)]);
  assert.deepEqual(turns.map((t) => [(t.start - T0) / 1000, (t.end - T0) / 1000]), [[0, 360], [3960, 3990]]);
  assert.deepEqual(waits.map(([a, b]) => [(a - T0) / 1000, (b - T0) / 1000]), [[50, 350]]);
});

test('waits come out of agent time, overlapping waits count once, waits outside a turn do not count', () => {
  const { turns, waits } = readSession([log(LINES)]);
  const app = [[T0 + 12000, T0 + 32000], [T0 + 50000, T0 + 350000], [T0 + 5000000, T0 + 5100000]]; // the form again, and one after the turns
  const day = Object.values(timeByDay(turns, [...waits, ...app]));
  assert.equal(day.length, 1);
  assert.equal(Math.round(day[0].wait), 20 + 300);
  assert.equal(Math.round(day[0].agent), 360 - 320 + 30);
});

test('a turn over midnight is split between its two days', () => {
  const late = new Date(2026, 9, 20, 23, 59, 0).getTime();
  const days = timeByDay([{ start: late, end: late + 180000 }]);
  assert.deepEqual(Object.fromEntries(Object.entries(days).map(([d, t]) => [d, Math.round(t.agent)])), { '2026-10-20': 60, '2026-10-21': 120 });
});

test('the seconds go on each day\'s first row once, and a day with only time gets an empty row', () => {
  const rows = [{ Date: '2026-10-20', Source: 'main', Cost: 1 }, { Date: '2026-10-20', Source: 'agent', Cost: 2 }];
  addSeconds(rows, 'UserSeconds', { '2026-10-20': 90.4, '2026-10-21': 30 });
  assert.deepEqual(rows.map((r) => [r.Date, r.Source, r.UserSeconds, r.Cost]), [['2026-10-20', 'main', 90, 1], ['2026-10-20', 'agent', 0, 2], ['2026-10-21', 'main', 30, 0]]);
});

test('the session\'s rows carry the agent and wait seconds, with Docket\'s own waits taken out', () => {
  const rows = sessionRows('acme', log(LINES), 'S1', PRICING, 'Test', {}, [[T0 + 12000, T0 + 32000]]);
  const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  assert.equal(sum('WaitSeconds'), 320);
  assert.equal(sum('AgentSeconds'), 70);
});

test('Codex turns run from task_started to task_complete', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-time-'));
  const file = path.join(dir, 'rollout-S1.jsonl');
  const line = (s, type, payload) => JSON.stringify({ timestamp: at(s), type, payload });
  fs.writeFileSync(file, [line(0, 'session_meta', { id: 'S1' }), line(1, 'event_msg', { type: 'task_started' }), line(30, 'response_item', { type: 'message' }),
    line(40, 'event_msg', { type: 'task_complete' }), line(500, 'event_msg', { type: 'task_started' }), line(520, 'response_item', { type: 'message' })].join('\n') + '\n');
  const { turns } = readCodexSession([file]);
  assert.deepEqual(turns.map((t) => [(t.start - T0) / 1000, (t.end - T0) / 1000]), [[1, 40], [500, 520]]);
});
