// Docket's own model calls as usage rows (#977): each Auto Group or artifact publish adds to its desk's day row for
// that kind, model and account, priced from its tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { addSideCall, sideId, loadPrices, priceReply, CSV_COLUMNS } from '../costs.mjs';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const prices = loadPrices(path.join(ROOT, 'pricing.json'));
const AT = new Date(2026, 10, 12, 10, 0, 0).getTime();
const USAGE = { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const billed = { connection: { key: 'claude:me@example.com', label: 'me@example.com', recorded: true } };

test('a side call is a row of its own, Source docket, Cause docket:<kind>, priced from its tokens', () => {
  const rows = addSideCall([], { client: 'acme', kind: 'auto-group', model: 'claude-haiku-4-5-20251001', usage: USAGE, at: AT }, prices, billed);
  assert.equal(rows.length, 1);
  const [r] = rows;
  assert.equal(r.SessionId, sideId('acme', 'auto-group'));
  assert.equal(r.Source, 'docket');
  assert.equal(r.Cause, 'docket:auto-group');
  assert.equal(r.Title, 'Docket: Auto Group');
  assert.equal(r.Turns, 1);
  assert.equal(r.InputTokens, 1200);
  assert.equal(r.Connection, 'claude:me@example.com');
  const want = priceReply({ model: 'claude-haiku-4-5-20251001', at: AT, usage: USAGE, tools: new Map() }, prices).cost;
  assert.ok(want > 0);
  assert.equal(r.Cost, Math.round(want * 10000) / 10000);
  for (const k of CSV_COLUMNS.filter((c) => c !== 'Group')) assert.ok(k in r, `has ${k}`);
});

test('calls on the same day, model and account add up; another day or kind is its own row', () => {
  let rows = addSideCall([], { client: 'acme', kind: 'artifact', model: 'claude-haiku-4-5', usage: USAGE, at: AT }, prices, billed);
  rows = addSideCall(rows, { client: 'acme', kind: 'artifact', model: 'claude-haiku-4-5', usage: USAGE, at: AT + 3600000 }, prices, billed);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Turns, 2);
  assert.equal(rows[0].InputTokens, 2400);
  assert.equal(rows[0].AvgTokensPerTurn, 1280);
  rows = addSideCall(rows, { client: 'acme', kind: 'artifact', model: 'claude-haiku-4-5', usage: USAGE, at: AT + 86400000 }, prices, billed);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Cause, 'docket:artifact');
});
