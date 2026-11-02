import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { grokSessionDirs, grokRows, grokSignature, grokTitle, grokAccount } from '../grok-usage.mjs';
import { CSV_COLUMNS } from '../costs.mjs';

const PRICING = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pricing.json');

// A Grok home with one session of two turns (numbers from a real grok-4.7-build turn) and one compaction.
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-usage-'));
  const dir = path.join(home, 'sessions', 'C%3A%5Cwork', 'g1');
  fs.mkdirSync(path.join(dir, 'compaction_checkpoints'), { recursive: true });
  const turn = (n, endedAt, input, cached, output, calls, ticks, model = 'grok-4.7-build') => ({ turnNumber: n, endedAt,
    modelUsage: { [model]: { inputTokens: input, cachedReadTokens: cached, cacheCreationTokens: 0, outputTokens: output, modelCalls: calls, costUsdTicks: ticks } } });
  fs.writeFileSync(path.join(dir, 'usage.json'), JSON.stringify({ sessionId: 'g1', turns: [
    turn(1, '2026-10-20T15:00:00Z', 22567, 1792, 827, 1, 161187200),
    turn(2, '2026-10-20T16:00:00Z', 104151, 98176, 1330, 1, 284661200),
    { turnNumber: 3, endedAt: '2026-10-20T16:05:00Z', inputTokens: 0, modelCalls: 0, turnCount: 1 }, // a cancelled turn: no usage
  ] }));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), ['{"ts":"2026-10-20T15:00:00Z","type":"tool_started","tool_name":"read_file"}',
    '{"ts":"2026-10-20T15:00:01Z","type":"tool_completed"}', '{"ts":"2026-10-20T16:00:00Z","type":"tool_started","tool_name":"grep"}'].join('\n'));
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ generated_title: 'Fix the thing' }));
  const cp = path.join(dir, 'compaction_checkpoints', 'c1.json');
  fs.writeFileSync(cp, '{}');
  const t = new Date('2026-10-20T15:30:00Z'); fs.utimesSync(cp, t, t);
  fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ 'https://auth.x.ai::x': { key: 'secret', email: null, first_name: 'Pat' } }));
  fs.mkdirSync(path.join(home, 'sessions', 'C%3A%5Cwork', 'empty')); // a folder with no usage.json is not a session
  return { home, dir };
}

test('finds Grok sessions, their title and the signed-in name', () => {
  const { home, dir } = makeHome();
  const dirs = grokSessionDirs(home);
  assert.deepEqual([...dirs.keys()], ['g1']);
  assert.equal(dirs.get('g1'), dir);
  assert.equal(grokTitle(dir), 'Fix the thing');
  assert.equal(grokAccount(home), 'Pat (Grok)');
});

test("rows use Grok's own cost and the tracker's columns, with Brand grok", () => {
  const { dir } = makeHome();
  const rows = grokRows('acme', 'docket-1', [dir], PRICING, 'My session', 'Pat (Grok)');
  assert.equal(rows.length, 1); // both turns are on one day and one model
  const r = rows[0];
  for (const c of CSV_COLUMNS) if (c !== 'Group') assert.ok(c in r, `missing ${c}`); // the app adds Group, as for Claude rows
  assert.equal(r.Brand, 'grok');
  assert.equal(r.Source, 'main');
  assert.equal(r.Model, 'grok-4.7-build');
  assert.equal(r.Turns, 2);
  assert.equal(r.InputTokens, (22567 - 1792) + (104151 - 98176)); // cached reads are counted apart, as for Claude
  assert.equal(r.CacheRead, 1792 + 98176);
  assert.equal(r.OutputTokens, 827 + 1330);
  assert.equal(r.Cost, Math.round((161187200 + 284661200) / 1e10 * 10000) / 10000);
  assert.equal(r.PersonalCost, r.Cost);
  assert.equal(r.HypotheticalCost, r.Cost);
  assert.ok(r.CacheSaved > 0);
  assert.equal(r.ToolCalls, 2);
  assert.equal(r.Compacting, 1);
  assert.equal(r.CacheCreate, 0);
  assert.equal(r.BilledProfile, 'Pat (Grok)');
});

test('the rates in pricing.json reproduce a plain Grok turn to the tick', () => {
  const prices = JSON.parse(fs.readFileSync(PRICING, 'utf8'));
  const m = prices.pricing_periods.at(-1).models['grok-4.7-build'];
  const ticks = ((22567 - 1792) * m.input + 1792 * m.cacheRead + 827 * m.output) / 1e6 * 1e10;
  assert.equal(Math.round(ticks), 161187200);
});

test('the signature changes when Grok adds a turn or a compaction', () => {
  const { dir } = makeHome();
  const a = grokSignature([dir], PRICING);
  fs.appendFileSync(path.join(dir, 'usage.json'), ' ');
  const b = grokSignature([dir], PRICING);
  assert.notEqual(a, b);
  fs.writeFileSync(path.join(dir, 'compaction_checkpoints', 'c2.json'), '{}');
  assert.notEqual(grokSignature([dir], PRICING), b);
});
