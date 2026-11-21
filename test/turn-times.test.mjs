// Turn timings (#793): the line written at the end of each turn, the machine figures it carries, the monthly file
// and its cap, and the report's grouping by hour and by sessions working.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { turnLine, cpuTotals, cpuBusy, createSampler, fileFor, appendLine, readLines, MAX_FILE_BYTES, workingBucket, byHour, byWorking, summarize, hookLogHours, reportText } from '../turn-times.mjs';

const AT = new Date(2026, 10, 3, 10, 30).getTime();

test('a turn line has the timings, tokens and machine figures, and nothing of what was said', () => {
  const l = turnLine({ at: AT, session: 's1', desk: 'acme', brand: 'claude', model: 'opus', error: false, ms: 10000,
    split: { modelMs: 6000, toolMs: 1000, hookMs: 3000 }, tools: [[AT - 5000, AT - 4000], [AT - 3000, AT - 2000]],
    usage: { input_tokens: 5, output_tokens: 600, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
    working: 3, machine: { cpu: 40, freeMb: 8000, loopP50: 20.1, loopP99: 40.5 } });
  assert.deepEqual(l, { at: new Date(AT).toISOString(), session: 's1', desk: 'acme', brand: 'claude', model: 'opus', error: false,
    ms: 10000, modelMs: 6000, toolMs: 1000, hookMs: 3000, tools: 2, outTok: 600, inTok: 5, cacheTok: 1200, working: 3,
    cpu: 40, freeMb: 8000, loopP50: 20.1, loopP99: 40.5 });
});

test('with no hook in the turn, the tools\' own spans give the tool time and the rest is the model', () => {
  const l = turnLine({ at: AT, session: 's', desk: 'd', ms: 10000, split: null, tools: [[AT - 6000, AT - 4000], [AT - 5000, AT - 3000], [AT - 1000, undefined]], working: 1 });
  assert.equal(l.toolMs, 4000); // 6s–3s overlapping, plus the one still open at the end
  assert.equal(l.modelMs, 6000);
  assert.equal(l.hookMs, 0);
  assert.equal(l.brand, 'claude');
  assert.equal(l.outTok, null);
});

test('CPU busy share comes from the time totals between two looks', () => {
  const a = cpuTotals([{ times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 } }, { times: { user: 0, nice: 0, sys: 0, idle: 1000, irq: 0 } }]);
  const b = cpuTotals([{ times: { user: 600, nice: 0, sys: 50, idle: 1350, irq: 0 } }, { times: { user: 500, nice: 0, sys: 0, idle: 1500, irq: 0 } }]);
  assert.equal(cpuBusy(a, b), 50);
  assert.equal(cpuBusy(null, b), null);
  assert.equal(cpuBusy(b, b), null);
});

test('the sampler covers only the stretch since its last look and resets the loop histogram', () => {
  let user = 0, idle = 1000, resets = 0;
  const sample = createSampler({ cpus: () => [{ times: { user, nice: 0, sys: 0, idle, irq: 0 } }], freemem: () => 2 * 1048576,
    histogram: { count: 5, percentile: (p) => (p === 50 ? 21_340_000 : 99_990_000), reset: () => resets++ }, resolutionMs: 20 });
  user = 500; idle = 1500; // half of the time since the first look was busy
  const s = sample();
  assert.equal(s.cpu, 50);
  assert.equal(s.freeMb, 2);
  assert.equal(s.loopP50, 1.3); // the 20 ms sampling step taken off
  assert.equal(s.loopP99, 80);
  assert.equal(resets, 1);
  const quiet = createSampler({ cpus: () => [{ times: { user: 1, nice: 0, sys: 0, idle: 1, irq: 0 } }], freemem: () => 0, histogram: { count: 0, reset() {} } })();
  assert.equal(quiet.loopP50, null);
  assert.equal(quiet.cpu, null);
});

test('one file a month, and a full file takes no more lines', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-times-'));
  assert.equal(path.basename(fileFor(dir, AT)), 'turn-times-2026-11.jsonl');
  const line = turnLine({ at: AT, session: 's', desk: 'd', ms: 1000, working: 1 });
  assert.equal(await appendLine(dir, line), true);
  assert.equal(await appendLine(dir, { ...line, at: new Date(2026, 11, 1, 9).toISOString() }), true);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['turn-times-2026-11.jsonl', 'turn-times-2026-12.jsonl']);
  assert.equal(await appendLine(dir, line, { size: () => MAX_FILE_BYTES }), false);
  assert.equal(await appendLine(dir, line, { append: () => Promise.reject(new Error('disk full')) }), false);
  fs.appendFileSync(fileFor(dir, AT), 'not json\n');
  assert.equal(readLines(dir).length, 2);
  assert.equal(readLines(dir, new Date(2026, 11, 1).getTime()).length, 1);
  fs.rmSync(dir, { recursive: true });
});

const L = (hour, working, ms, extra = {}) => ({ at: new Date(2026, 10, 3, hour, 5).toISOString(), working, ms, modelMs: ms / 2, toolMs: ms / 4, hookMs: ms / 4, outTok: 100, cpu: 30, loopP50: 20, loopP99: 30, ...extra });

test('sessions working fall in 1, 2–3, 4–7 and 8+', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 7, 8, 30].map(workingBucket), ['1', '1', '2–3', '2–3', '4–7', '4–7', '8+', '8+']);
  const g = byWorking([L(9, 1, 1000), L(9, 5, 4000), L(9, 6, 8000), L(9, 12, 2000)]);
  assert.deepEqual(g.map((x) => [x.key, x.turns]), [['1', 1], ['4–7', 2], ['8+', 1]]);
});

test('turns group by the hour of day, in order', () => {
  const g = byHour([L(14, 1, 1000), L(9, 1, 2000), L(14, 2, 3000)]);
  assert.deepEqual(g.map((x) => [x.key, x.turns]), [[9, 1], [14, 2]]);
});

test('a group\'s figures: p50 and p90, hook share of turn time, and output tokens per model second', () => {
  const s = summarize([L(9, 1, 2000), L(9, 1, 4000, { hookMs: 3000 }), L(9, 1, 6000, { error: true }), L(9, 1, 8000, { outTok: null })]);
  assert.equal(s.turns, 4);
  assert.equal(s.errors, 1);
  assert.deepEqual(s.ms, [6000, 8000]);
  assert.equal(s.hookShare, (500 + 3000 + 1500 + 2000) / 20000);
  assert.equal(s.tokPerSec, 300 / 6); // the line with no token count is left out: 300 tokens over 1+2+3 model seconds
  assert.equal(s.cpu, 30);
});

test('a hook log is counted by hour, with its deadline outcomes', () => {
  const t = (h) => new Date(2026, 10, 3, h, 1).toISOString();
  const log = [
    `time=${t(9)} level=INFO msg="hook invoked: connector=claude event=PreToolUse session=a timeout=8s"`,
    `time=${t(9)} level=INFO msg="hook done: connector=claude event=PreToolUse session=a outcome=ok took=1.5s"`,
    `time=${t(9)} level=INFO msg="hook done: connector=claude event=Stop session=a outcome=deadline took=8s"`,
    `time=${t(11)} level=INFO msg="hook done: connector=claude event=Stop session=b outcome=ok took=1s"`,
  ].join('\n');
  assert.deepEqual(hookLogHours(log), { 9: { calls: 2, deadline: 1 }, 11: { calls: 1, deadline: 0 } });
  assert.deepEqual(hookLogHours(log, new Date(2026, 10, 3, 10).getTime()), { 11: { calls: 1, deadline: 0 } });
});

test('the report has both tables, and the hook columns only when there is a hook log', () => {
  const lines = [L(9, 1, 1000), L(9, 4, 5000)];
  const plain = reportText(lines, { days: 7 });
  assert.match(plain, /## By sessions working/);
  assert.match(plain, /\| 4–7 \| 1 \| 5\.0 \/ 5\.0 \|/);
  assert.match(plain, /\| 09 \| 2 \|/);
  assert.doesNotMatch(plain, /hook calls/);
  const withHooks = reportText(lines, { hookHours: { 9: { calls: 12, deadline: 2 } } });
  assert.match(withHooks, /\| 09 \| 2 \|.* 12 \| 2 \|$/m);
  assert.equal(reportText([], { days: 7 }), 'No turns logged in the last 7 days.\n');
});
