// Tests for pricing a compaction (costs.mjs compactCall and usageLeft, #747). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactCall, usageLeft, loadPrices, priceReply } from '../costs.mjs';

const prices = loadPrices(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pricing.json'));
const est = prices.compactionEstimate;
const at = Date.parse('2026-11-01T12:00:00Z'), MIN = 60000;
const reply = (t, h1 = 1000) => ({ model: 'claude-opus-5-5', at: t, usage: { cache_creation: { ephemeral_1h_input_tokens: h1, ephemeral_5m_input_tokens: 0 } } });
const c = { at, preTokens: 167000, ms: 55000, summary: 14000 };

test('a compaction on a warm cache reads its context, and its output comes from how long it took', () => {
  const call = compactCall(c, [reply(at - 55000 - 2 * MIN)], est);
  assert.equal(call.cold, false);
  assert.equal(call.usage.cache_read_input_tokens, 167000 - est.cacheWrite);
  assert.equal(call.usage.output_tokens, Math.round((55 - est.startSec) * est.outputPerSec));
  const cost = priceReply({ model: 'claude-opus-5-5', at, usage: call.usage }, prices).cost;
  assert.ok(cost > 0.2 && cost < 0.4, `about $0.29, got ${cost}`);
});

test('a compaction after the cache ran out writes its whole context again', () => {
  const call = compactCall(c, [reply(at - 55000 - 70 * MIN)], est);
  assert.equal(call.cold, true);
  assert.equal(call.usage.cache_creation.ephemeral_1h_input_tokens, 167000);
  assert.equal(call.usage.cache_read_input_tokens, 0);
  const cost = priceReply({ model: 'claude-opus-5-5', at, usage: call.usage }, prices).cost;
  assert.ok(cost > 1.5, `cold costs over $1.50, got ${cost}`);
  // on a 5-minute cache, 10 minutes is cold
  assert.equal(compactCall(c, [reply(at - 55000 - 10 * MIN, 0)], est).cold, true);
});

test('with no duration, the summary sets the output, else the flat figure', () => {
  assert.equal(compactCall({ ...c, ms: 0 }, [reply(at - MIN)], est).usage.output_tokens, Math.round(14000 * est.summaryTokensPerChar));
  assert.equal(compactCall({ ...c, ms: 0, summary: 0 }, [reply(at - MIN)], est).usage.output_tokens, est.output);
  assert.equal(compactCall(c, [], est), null);
});

test('usageLeft: what the turn\'s replies do not account for is the compaction call', () => {
  const seen = { 'claude-opus-5-5': { inputTokens: 10, outputTokens: 100, cacheReadInputTokens: 1000, cacheCreationInputTokens: 50 } };
  const now = { 'claude-opus-5-5': { inputTokens: 3020, outputTokens: 9300, cacheReadInputTokens: 166000 + 1000 + 20000, cacheCreationInputTokens: 50 + 2000 + 16000 }, 'claude-haiku-5-5': { outputTokens: 50 } };
  const calls = [{ model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 200, cache_read_input_tokens: 20000, cache_creation_input_tokens: 16000 } }];
  const u = usageLeft(seen, now, calls, 'claude-opus-5-5', 3600);
  assert.deepEqual([u.input_tokens, u.output_tokens, u.cache_read_input_tokens, u.cache_creation.ephemeral_1h_input_tokens], [3000, 9000, 166000, 2000]);
  assert.equal(usageLeft(seen, seen, [], 'claude-opus-5-5'), null); // nothing left
  // a process that started again counts from zero
  const fresh = usageLeft(seen, { 'claude-opus-5-5': { inputTokens: 5, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } }, [], 'claude-opus-5-5');
  assert.equal(fresh.output_tokens, 50);
});
