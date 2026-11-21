// The start cost (#802): what each session's first reply cost to read its start, whether a session started it and
// whether it was short, on its first usage row; the week's tally of a desk; and when the start-cost card shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sessionRows, startFacts, SHORT_TURNS, CSV_COLUMNS } from '../costs.mjs';
import { START_OFFER, startTally, startOfferKind, startOfferWords } from '../start-offer.mjs';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const PRICING = path.join(ROOT, 'pricing.json');
const T0 = new Date(2026, 9, 20, 10, 0, 0).getTime();
const at = (s) => new Date(T0 + s * 1000).toISOString();
let n = 0;
const msg = (s, text) => ({ type: 'user', uuid: `u${n++}`, timestamp: at(s), message: { role: 'user', content: [{ type: 'text', text }] } });
const reply = (s, usage, model = 'claude-opus-5-5') => ({ type: 'assistant', uuid: `a${n++}`, requestId: `r${n}`, timestamp: at(s), message: { id: `m${n}`, model, content: [{ type: 'text', text: 'ok' }], usage } });
const BRIEF = 'Fix the bug.(From Docket: This session was started by the session "Parent" (id 73d70e03-a8c1-452d-af08-d43574aced09) and is listed under it.)';
// The first reply reads 20k from the cache (Docket's and Claude Code's shared start), writes 30k (the desk's setup and
// the brief) to the 1-hour cache, has 50 tokens plain and writes 400.
const FIRST = { input_tokens: 50, output_tokens: 400, cache_read_input_tokens: 20000, cache_creation_input_tokens: 30000,
  cache_creation: { ephemeral_1h_input_tokens: 30000, ephemeral_5m_input_tokens: 0 } };
const LATER = { input_tokens: 10, output_tokens: 1000, cache_read_input_tokens: 50000, cache_creation_input_tokens: 2000 };

function session(id, lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-cost-'));
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

test("a session's start cost is its first main reply, output left out, on its first row", () => {
  const file = session('C1', [msg(0, BRIEF), reply(10, FIRST), reply(20, LATER), msg(100, 'thanks, one more thing'), reply(110, LATER)]);
  const rows = sessionRows('acme', file, 'C1', PRICING, 'Child');
  // Opus 5.5: $4 input, $0.20 cache read, $8 1-hour cache write per million
  const want = (50 * 4 + 20000 * 0.2 + 30000 * 8) / 1e6;
  const first = rows.filter((r) => r.Starts);
  assert.equal(first.length, 1, 'once per session');
  assert.ok(Math.abs(first[0].StartCost - want) < 1e-4, `${first[0].StartCost} vs ${want}`);
  assert.equal(first[0].Child, 1);
  assert.equal(first[0].ShortChild, 1, `two turns is short (SHORT_TURNS ${SHORT_TURNS})`);
  assert.ok(rows.every((r) => 'StartCost' in r && 'ShortChild' in r));
  assert.ok(CSV_COLUMNS.includes('StartCost') && CSV_COLUMNS.includes('ShortChild'));
});

test('a session the person started is no child; a child with more turns is not short', () => {
  const own = sessionRows('acme', session('P1', [msg(0, 'build the thing'), reply(10, FIRST)]), 'P1', PRICING, 'Own');
  assert.deepEqual([own[0].Starts, own[0].Child, own[0].ShortChild], [1, 0, 0]);
  const lines = [msg(0, BRIEF), reply(10, FIRST)];
  for (let i = 1; i <= SHORT_TURNS; i++) lines.push(msg(100 * i, `more ${i}`), reply(100 * i + 10, LATER));
  const long = sessionRows('acme', session('C2', lines), 'C2', PRICING, 'Long child');
  assert.deepEqual([long[0].Child, long[0].ShortChild], [1, 0]);
});

test('startFacts skips helper agents and compaction estimates, and is null with no reply', () => {
  assert.equal(startFacts([], []), null);
  const priced = [{ subagent: true, priced: true, cost: 9, parts: {} }, { estimate: true, compaction: true, priced: true, cost: 9, parts: {} },
    { priced: true, cost: 1.5, parts: { output: 0.5, webSearch: 0.25 } }];
  assert.deepEqual(startFacts(priced, [{ cause: 'person' }]), { cost: 0.75, child: false, short: false, turns: 1 });
});

// A desk's week: rows as the app keeps them, a session's start on its first row only.
const row = (id, day, { start = 0.5, child = 1, short = 1, model = 'claude-opus-5-5' } = {}) => ({ SessionId: id, Date: day, Source: 'main', Model: model,
  Starts: 1, StartCost: start, Child: child, ShortChild: short });
const week = (n, extra = {}) => Array.from({ length: n }, (_, i) => row(`s${i}`, '2026-11-05', extra));

test('the tally counts each start once, by dates, and the short children that stayed on the top gear', () => {
  const rows = [...week(3), row('s9', '2026-11-05', { child: 0, short: 0, start: 2 }), row('old', '2026-10-01'),
    { SessionId: 's0', Date: '2026-11-06', Source: 'main', Model: 'claude-opus-5-5', Starts: 0, StartCost: 0 }, // a later day of s0: no start
    row('lo', '2026-11-05', { model: 'claude-haiku-5-5' })];
  const t = startTally(rows, { from: '2026-11-03', gearIds: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'] });
  assert.deepEqual(t, { sessions: 5, startCost: 4, children: 4, childCost: 2, short: 4, shortCost: 2, shortTop: 3 });
});

test('the card shows only above the threshold, with splitting on, and Not now holds it off', () => {
  const now = Date.parse('2026-11-09T12:00:00');
  const enough = startTally(week(20, { start: 0.5 })); // 20 short children, $10
  assert.ok(enough.shortCost >= START_OFFER.weekly);
  assert.equal(startOfferKind({ tally: enough, now }), 'first');
  assert.equal(startOfferKind({ tally: enough, split: false, now }), null, 'splitting already off');
  assert.equal(startOfferKind({ tally: startTally(week(20, { start: 0.1 })), now }), null, 'under the saving threshold');
  assert.equal(startOfferKind({ tally: startTally(week(3, { start: 5 })), now }), null, 'too few children');
  const mostlyLong = startTally([...week(4, { start: 2 }), ...Array.from({ length: 6 }, (_, i) => row(`l${i}`, '2026-11-05', { short: 0 }))]);
  assert.equal(startOfferKind({ tally: mostlyLong, now }), null, 'most children were not short');
  const later = { answer: 'later', at: now - 3 * 864e5 };
  assert.equal(startOfferKind({ tally: enough, answer: later, now }), null, 'Not now holds it off');
  assert.equal(startOfferKind({ tally: enough, answer: { ...later, at: now - START_OFFER.laterDays * 864e5 }, now }), 'again');
  const w = startOfferWords('Acme', { ...enough, shortTop: 2 });
  assert.match(w.title, /^Acme spent \$10 last week starting 20 sessions$/);
  assert.match(w.lines[0], /20 of its 20 child sessions finished in 2 turns or fewer; starting those cost \$10/);
  assert.match(w.lines[1], /2 of them ran only on the top gear/);
});
