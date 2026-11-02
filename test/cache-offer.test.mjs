// Tests for cache-offer.mjs: when to offer the 1-hour prompt cache. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileReplies, tally, offerKind, CACHE_OFFER } from '../cache-offer.mjs';

const MIN = 60000, DAY = 864e5, NOW = Date.UTC(2026, 9, 28, 12);
const at = (min) => NOW - DAY + min * MIN;

test('only gaps of 5 to 60 minutes count as misses 1 hour would have saved', () => {
  const t = tally([[{ at: at(0), ttl: 300 }, { at: at(1) }, { at: at(10) }, { at: at(70) }, { at: at(250) }, { at: at(255) }]], NOW);
  assert.equal(t.replies, 6);
  assert.equal(t.misses, 1); // 9 minutes counts; 60, 180 and 5 minutes do not
  assert.equal(t.ttl, 300);
});

test('replies older than the window are left out, and the latest cache length wins across sessions', () => {
  const old = { at: NOW - 8 * DAY, ttl: 3600 };
  const t = tally([[old, { at: at(20), ttl: 300 }], [{ at: at(5), ttl: 3600 }]], NOW);
  assert.equal(t.replies, 2);
  assert.equal(t.misses, 0); // the gap from a reply outside the window is still a gap, but 8 days is no miss
  assert.equal(t.ttl, 300);
});

test('first ask: on 5 minutes with no answer; never when 1 hour is set or measured', () => {
  const t = { replies: 3, misses: 0, share: 0, ttl: 300 };
  assert.equal(offerKind({ t, now: NOW }), 'first');
  assert.equal(offerKind({ t, setting: '1h', now: NOW }), null);
  assert.equal(offerKind({ t: { ...t, ttl: 3600 }, now: NOW }), null);
  assert.equal(offerKind({ t: { ...t, ttl: null }, now: NOW }), null);
  assert.equal(offerKind({ t, answer: { answer: 'never', at: 0 }, now: NOW }), null);
});

test('after Not now: quiet for 30 days, then asks only when the misses pass the share', () => {
  const high = { replies: CACHE_OFFER.minReplies, misses: 5, share: 0.25, ttl: 300 };
  const later = (days) => ({ answer: 'later', at: NOW - days * DAY });
  assert.equal(offerKind({ t: high, answer: later(29), now: NOW }), null);
  assert.equal(offerKind({ t: high, answer: later(31), now: NOW }), 'measured');
  assert.equal(offerKind({ t: { ...high, share: 0.1 }, answer: later(31), now: NOW }), null);
  assert.equal(offerKind({ t: { ...high, replies: CACHE_OFFER.minReplies - 1 }, answer: later(31), now: NOW }), null);
});

test('a session file is read once per reply, sidechains left out, and only the added part on the next look', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cache-offer-')), 's.jsonl');
  const line = (id, min, extra = {}) => JSON.stringify({ type: 'assistant', timestamp: new Date(at(min)).toISOString(), ...extra,
    message: { id, usage: { input_tokens: 1, cache_creation: { ephemeral_5m_input_tokens: 10 } } } }) + '\n';
  fs.writeFileSync(file, line('a', 0) + line('a', 0) + line('b', 1, { isSidechain: true }) + JSON.stringify({ type: 'user' }) + '\n' + line('c', 8));
  assert.deepEqual(fileReplies(file).map((r) => r.at), [at(0), at(8)]);
  fs.appendFileSync(file, line('d', 20).slice(0, 30)); // half a line: not read yet
  assert.equal(fileReplies(file).length, 2);
  fs.appendFileSync(file, line('d', 20).slice(30));
  const all = fileReplies(file);
  assert.equal(all.length, 3);
  assert.equal(all[2].ttl, 300);
});
