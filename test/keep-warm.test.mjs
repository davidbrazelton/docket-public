// Tests for keep-warm.mjs: when Docket pings a waiting parent so its prompt cache stays warm (#734). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEEP_WARM, PING_TEXT, keepWarmDue, isPing } from '../keep-warm.mjs';

const MIN = 60000, now = 1e12;
const base = { engine: 'claude', status: 'idle', cacheTtl: 3600, tokens: 90000, lastReplyAt: now - (KEEP_WARM.afterMin + 1) * MIN, working: 1, now };

test('a parent waiting on a working child, near the end of its 1-hour cache, is pinged', () => {
  const d = keepWarmDue(base);
  assert.equal(d.ping, true);
  assert.equal(d.warmSince, now);
});

test('no ping before the threshold, nor once the cache has already gone', () => {
  assert.equal(keepWarmDue({ ...base, lastReplyAt: now - 30 * MIN }).ping, false);
  assert.equal(keepWarmDue({ ...base, lastReplyAt: now - (KEEP_WARM.afterMin + KEEP_WARM.windowMin + 1) * MIN }).ping, false);
  assert.equal(keepWarmDue({ ...base, lastReplyAt: 0 }).ping, false);
});

test('only big contexts on the 1-hour cache, Claude sessions, idle and not resting or paused', () => {
  assert.equal(keepWarmDue({ ...base, tokens: 30000 }).ping, false);
  assert.equal(keepWarmDue({ ...base, cacheTtl: 300 }).ping, false);
  assert.equal(keepWarmDue({ ...base, cacheTtl: null }).ping, false);
  assert.equal(keepWarmDue({ ...base, engine: 'grok' }).ping, false);
  assert.equal(keepWarmDue({ ...base, engine: undefined }).ping, true);
  assert.equal(keepWarmDue({ ...base, status: 'running' }).ping, false);
  assert.equal(keepWarmDue({ ...base, resting: true }).ping, false);
  assert.equal(keepWarmDue({ ...base, paused: true }).ping, false);
  assert.equal(keepWarmDue({ ...base, busy: true }).ping, false);
});

test('no child working: no ping, and the wait is over', () => {
  assert.deepEqual(keepWarmDue({ ...base, working: 0, warmSince: now - MIN }), { ping: false, warmSince: null });
});

test('pings stop after maxHours in one wait; a later wait starts its own count', () => {
  const long = now - (KEEP_WARM.maxHours * 60 + 1) * MIN;
  assert.deepEqual(keepWarmDue({ ...base, warmSince: long }), { ping: false, warmSince: long });
  const d = keepWarmDue({ ...base, warmSince: now - 2 * 3600000 });
  assert.equal(d.ping, true);
  assert.equal(d.warmSince, now - 2 * 3600000);
  assert.equal(keepWarmDue({ ...base, working: 0, warmSince: long }).warmSince, null);
});

test('the thresholds can be changed in one place', () => {
  const cfg = { ...KEEP_WARM, afterMin: 1, windowMin: 1, minTokens: 1000 };
  assert.equal(keepWarmDue({ ...base, tokens: 2000, lastReplyAt: now - 90000, cfg }).ping, true);
  assert.equal(keepWarmDue({ ...base, tokens: 2000, lastReplyAt: now - 90000 }).ping, false);
});

test('isPing finds the ping in a saved transcript, and nothing else', () => {
  assert.equal(isPing({ type: 'user', message: { content: [{ type: 'text', text: PING_TEXT }] } }), true);
  assert.equal(isPing({ type: 'user', message: { content: PING_TEXT } }), true);
  assert.equal(isPing({ type: 'user', message: { content: [{ type: 'text', text: 'hello' }] } }), false);
  assert.equal(isPing({ type: 'assistant', message: { content: [{ type: 'text', text: PING_TEXT }] } }), false);
  assert.equal(isPing(null), false);
});
