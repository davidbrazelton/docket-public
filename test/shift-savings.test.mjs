// What Shift saved: a Shift session's rows priced again at the top gear, and the Usage page's Shift line.
// Covers shift-savings.mjs. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { priceTokens, gearIndex, topGearCost, sessionShiftFacts, shiftTotals, shiftEntry, withShift, MAX_SHIFTS } from '../shift-savings.mjs';
import { GEARS } from '../gears.mjs';

const CLAUDE = GEARS.claude.map((g) => g.id); // haiku, sonnet, opus
const OPUS = { input: 4, output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
// 1M of each kind of token; 1h writes are part of CacheCreate, as in the rows.
const row = (over) => ({ SessionId: 's1', Model: 'claude-haiku-5-5', InputTokens: 1e6, OutputTokens: 1e6, CacheRead: 1e6, CacheCreate: 2e6, CacheCreate1h: 1e6, Cost: 1, PersonalCost: 1, ...over });

test('a row is priced by its tokens: input, output, cache reads, 5-minute and 1-hour writes', () => {
  near(priceTokens(row(), OPUS), 4 + 20 + 0.2 + 5 + 8);
  assert.equal(priceTokens(row(), null), null);
});

test('a gear is known by its id, with or without a Bedrock prefix or a date', () => {
  assert.equal(gearIndex('claude-haiku-5-5', CLAUDE), 0);
  assert.equal(gearIndex('us.anthropic.claude-opus-5-5-v1:0', CLAUDE), 2);
  assert.equal(gearIndex('claude-sonnet-5-5-20261001', CLAUDE), 1);
  assert.equal(gearIndex('claude-haiku-4-5', CLAUDE), -1);
  assert.equal(gearIndex('', CLAUDE), -1);
});

test('a row on a lower gear costs the same tokens at the top gear', () => {
  const r = topGearCost(row(), CLAUDE, OPUS);
  assert.deepEqual(r, { cost: 37.2, priced: true });
});

test("Bedrock's regional rate carries over to the top-gear price", () => {
  near(topGearCost(row({ Cost: 1.1, PersonalCost: 1 }), CLAUDE, OPUS).cost, 37.2 * 1.1);
});

test('a row already on the top gear, or on a model that is no gear, keeps its own cost', () => {
  assert.deepEqual(topGearCost(row({ Model: 'claude-opus-5-5', Cost: 37.2 }), CLAUDE, OPUS), { cost: 37.2, priced: true });
  assert.deepEqual(topGearCost(row({ Model: 'claude-haiku-4-5', Cost: 3 }), CLAUDE, OPUS), { cost: 3, priced: true });
  assert.deepEqual(topGearCost(row({ Model: '', Cost: 0 }), CLAUDE, OPUS), { cost: 0, priced: true }); // a typing-time row
});

test('a top gear with no price keeps the row at its own cost and says so', () => {
  assert.deepEqual(topGearCost(row({ Model: 'gpt-6-luna', Cost: 2 }), GEARS.codex.map((g) => g.id), null), { cost: 2, priced: false });
});

test('a session shifted when its history says so, or (before history was saved) its rows are on two gears', () => {
  assert.deepEqual(sessionShiftFacts([row()], CLAUDE, [{ from: 'claude-haiku-5-5', to: 'claude-sonnet-5-5' }], 'claude-sonnet-5-5'), { shifted: true, shifts: 1, reachedTop: false });
  assert.deepEqual(sessionShiftFacts([row(), row({ Model: 'claude-opus-5-5' })], CLAUDE), { shifted: true, shifts: 0, reachedTop: true });
  assert.deepEqual(sessionShiftFacts([row()], CLAUDE, [], 'claude-haiku-5-5'), { shifted: false, shifts: 0, reachedTop: false });
  assert.equal(sessionShiftFacts([], CLAUDE, [], 'claude-opus-5-5').reachedTop, true); // on the top gear, no reply yet
});

test('the Shift line adds up spent, top-gear cost and saved, and counts its sessions once each', () => {
  const rows = [
    { SessionId: 'a', Cost: 1, TopGearCost: 10 }, { SessionId: 'a', Cost: 2, TopGearCost: 2 }, // a: shifted up to the top
    { SessionId: 'b', Cost: 0.5, TopGearCost: 5 }, // b: stayed low, never shifted
    { SessionId: 'c', Cost: 3, TopGearCost: 3, TopGearUnpriced: 1 }, // c: a brand whose top gear has no price
    { SessionId: 'd', Cost: 7 }, // not a Shift session: left out
  ];
  const shift = { a: { shifted: true, reachedTop: true }, b: { shifted: false, reachedTop: false }, c: { shifted: true, reachedTop: false } };
  const t = shiftTotals(rows, shift);
  near(t.spent, 6.5); near(t.top, 20); near(t.saved, 13.5);
  assert.deepEqual({ sessions: t.sessions, shifted: t.shifted, stayedLow: t.stayedLow, unpriced: t.unpriced }, { sessions: 3, shifted: 2, stayedLow: 2, unpriced: 1 });
});

test('a shift that cost more than it saved shows as a negative saving', () => {
  near(shiftTotals([{ SessionId: 'a', Cost: 5, TopGearCost: 4 }], { a: { shifted: true, reachedTop: true } }).saved, -1);
});

test('no Shift rows: all zero', () => {
  assert.deepEqual(shiftTotals([{ SessionId: 'x', Cost: 1 }]), { spent: 0, top: 0, saved: 0, sessions: 0, shifted: 0, stayedLow: 0, unpriced: 0 });
});

test('a shift history entry keeps from, to, when, reason and who, and the list stays bounded', () => {
  const e = shiftEntry({ from: 'claude-haiku-5-5', to: 'claude-opus-5-5', reason: 'debugging', by: 'parent', at: 5 });
  assert.deepEqual(e, { at: 5, from: 'claude-haiku-5-5', to: 'claude-opus-5-5', reason: 'debugging', by: 'parent' });
  assert.equal(shiftEntry({ from: 'a', to: 'b', by: 'someone' }).by, 'session');
  assert.equal(shiftEntry({ from: 'a', to: 'b', by: 'docket' }).by, 'docket');
  let list;
  for (let i = 0; i < MAX_SHIFTS + 5; i++) list = withShift(list, shiftEntry({ from: 'a', to: 'b', at: i }));
  assert.equal(list.length, MAX_SHIFTS);
  assert.equal(list.at(-1).at, MAX_SHIFTS + 4);
});

test("a shift Docket made counts as shifted, from the saved history alone", () => {
  const docket = shiftEntry({ from: 'claude-haiku-5-5', to: 'claude-opus-5-5', reason: 'file edit', by: 'docket' });
  assert.equal(docket.by, 'docket');
  // Its rows are all on the top gear (it was raised before its first reply that cost anything), so only the history says it shifted.
  const facts = sessionShiftFacts([row({ Model: 'claude-opus-5-5' })], CLAUDE, withShift(undefined, docket), 'claude-opus-5-5');
  assert.deepEqual(facts, { shifted: true, shifts: 1, reachedTop: true });
  const t = shiftTotals([{ SessionId: 'a', Cost: 1, TopGearCost: 1 }], { a: facts });
  assert.deepEqual([t.shifted, t.stayedLow], [1, 0]);
});

test("Docket's raise before work saves through recordShift, so it is in portal-state.json", () => {
  const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('async function shiftUpForWork'), src.indexOf('function shiftUpReply'));
  assert.match(body, /recordShift\(s, \{[^}]*by: 'docket' \}\)/);
  assert.doesNotMatch(src, /shifts \|\|= \[\]\)\.push/); // every shift goes through recordShift
});
