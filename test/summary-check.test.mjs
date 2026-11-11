import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUMMARY_CHECK, checkHours, summaryPlan, agoWords, factsBlock, checkStep, foundChanges, bucketOf, checkStats, tuneOffer, tuneWords, hoursWords } from '../summary-check.mjs';

const H = 3600000, now = Date.parse('2026-11-11T12:00:00Z');

test('the hours setting: a number from 0 up, the default otherwise', () => {
  assert.equal(checkHours(undefined), SUMMARY_CHECK.defaultHours);
  assert.equal(checkHours(''), SUMMARY_CHECK.defaultHours);
  assert.equal(checkHours('abc'), SUMMARY_CHECK.defaultHours);
  assert.equal(checkHours(-1), SUMMARY_CHECK.defaultHours);
  assert.equal(checkHours(0), 0);
  assert.equal(checkHours('12'), 12);
  assert.equal(checkHours(1.55), 1.6);
  assert.equal(checkHours(99999), SUMMARY_CHECK.maxHours);
});

test('an old last reply always checks, never as a sample', () => {
  const never = () => { throw new Error('random should not be asked'); };
  assert.deepEqual(summaryPlan({ lastReplyAt: now - 5 * H, now, hours: 4, random: never }), { ageMs: 5 * H, check: true, sampled: false });
  assert.deepEqual(summaryPlan({ lastReplyAt: now - 4 * H, now, hours: 4, random: never }), { ageMs: 4 * H, check: true, sampled: false });
});

test('an unknown last reply counts as old', () => {
  assert.deepEqual(summaryPlan({ lastReplyAt: null, now, random: () => 0.9 }), { ageMs: null, check: true, sampled: false });
});

test('a recent last reply checks only when sampled, about 1 in 4', () => {
  assert.deepEqual(summaryPlan({ lastReplyAt: now - 10 * 60000, now, hours: 4, random: () => 0.9 }), { ageMs: 600000, check: false, sampled: false });
  assert.deepEqual(summaryPlan({ lastReplyAt: now - 10 * 60000, now, hours: 4, random: () => 0.1 }), { ageMs: 600000, check: true, sampled: true });
  assert.equal(summaryPlan({ lastReplyAt: now - 1, now, random: () => 0.25 }).check, false);
});

test('the threshold setting changes the choice', () => {
  const at = now - 2 * H, r = () => 0.9;
  assert.equal(summaryPlan({ lastReplyAt: at, now, hours: 4, random: r }).check, false);
  assert.equal(summaryPlan({ lastReplyAt: at, now, hours: 1, random: r }).check, true);
  assert.equal(summaryPlan({ lastReplyAt: now, now, hours: 0, random: r }).check, true);
});

test('ages in words', () => {
  assert.equal(agoWords(20000), 'less than a minute');
  assert.equal(agoWords(5 * 60000), '5 min');
  assert.equal(agoWords(H), '1 hour');
  assert.equal(agoWords(30 * H), '30 hours');
  assert.equal(agoWords(4 * 24 * H), '4 days');
});

test('the facts block names the last reply, branch, pull request and sessions under it', () => {
  const b = factsBlock({ lastReplyAt: now - 3 * 24 * H, now, branch: 'fix-x', pr: { number: 12, status: 'merged', checks: 'pass' },
    kids: [{ id: 'a', title: 'Kid A', state: 'working' }, { id: 'b', title: 'Kid B', state: 'waiting' }] });
  assert.match(b, /^Docket checked just now/);
  assert.match(b, /Last reply: .*\(3 days ago\)/);
  assert.match(b, /Branch: fix-x/);
  assert.match(b, /#12 merged, checks pass/);
  assert.match(b, /working: "Kid A" \(id a\); waiting on the user: "Kid B" \(id b\)/);
  const empty = factsBlock({ now });
  assert.match(empty, /Last reply: unknown/);
  assert.match(empty, /Branch: none found/);
  assert.match(empty, /Pull request from it: none found/);
  assert.match(empty, /none working or waiting/);
});

test('the check step is read only, capped, and asks for the Changed line', () => {
  const s = checkStep({ lastReplyAt: now - 4 * 24 * H, now });
  assert.match(s, /\*\*Check first\.\*\*/);
  assert.match(s, /4 days ago/);
  assert.match(s, /at most about 8 calls/);
  assert.match(s, /do no new work/);
  assert.match(s, /as of <date>, unchecked/);
  assert.match(s, /Changed since last reply/);
  assert.doesNotMatch(s, /their claims/);
  assert.match(checkStep({ lastReplyAt: now - H, now, deep: true }), /their claims/);
});

test('found changes: a Changed bullet with something in it', () => {
  assert.equal(foundChanges('## Where it stands\n- **Changed since last reply:** PR #12 merged.\n- **Done:** x'), true);
  assert.equal(foundChanges('## Where it stands\n- **Changed since last reply:**\n  - PR #12 merged\n- **Done:** x'), true);
  assert.equal(foundChanges('- **Changed since last reply:** none.'), false);
  assert.equal(foundChanges('- **Changed since last reply:** Nothing changed'), false);
  assert.equal(foundChanges('- **Changed since last reply:**\n  - none'), false);
  assert.equal(foundChanges('- **Done:** all merged'), false);
  assert.equal(foundChanges(''), false);
});

test('age ranges', () => {
  assert.equal(bucketOf(0), '<1h');
  assert.equal(bucketOf(H - 1), '<1h');
  assert.equal(bucketOf(H), '1-4h');
  assert.equal(bucketOf(4 * H), '4-24h');
  assert.equal(bucketOf(24 * H), '>1d');
  assert.equal(bucketOf(null), '>1d');
});

test('stats by age range: checks run and the share that found changes', () => {
  const rows = checkStats([
    { ageMs: 10 * 60000, check: false },
    { ageMs: 20 * 60000, check: true, sampled: true, changed: false },
    { ageMs: 2 * H, check: true, sampled: true, changed: true },
    { ageMs: 5 * H, check: true, changed: true },
    { ageMs: 6 * H, check: true, changed: false },
    { ageMs: 3 * 24 * H, check: true, changed: true },
  ]);
  assert.deepEqual(rows.map((r) => r.range), ['<1h', '1-4h', '4-24h', '>1d']);
  assert.deepEqual(rows[0], { range: '<1h', summaries: 2, checks: 1, sampled: 1, changed: 0, pct: 0 });
  assert.deepEqual(rows[1], { range: '1-4h', summaries: 1, checks: 1, sampled: 1, changed: 1, pct: 100 });
  assert.deepEqual(rows[2], { range: '4-24h', summaries: 2, checks: 2, sampled: 0, changed: 1, pct: 50 });
  assert.equal(rows[3].pct, 100);
  assert.equal(checkStats([])[0].pct, null);
});

const logOf = (n, hours, changedEvery) => Array.from({ length: n }, (_, i) => ({ ageMs: hours * H, check: true, sampled: true, changed: changedEvery ? i % changedEvery === 0 : false }));

test('tuning: checks just below the threshold often finding changes offers the next lower step', () => {
  const entries = logOf(15, 3, 2); // 8 of 15 at 3 hours found changes
  assert.deepEqual(tuneOffer({ entries, hours: 4 }), { dir: 'down', from: 4, to: 2, lo: 2, hi: 4, checks: 15, changed: 8 });
  assert.equal(tuneOffer({ entries: logOf(9, 3, 1), hours: 4 }), null); // too few
  assert.equal(tuneOffer({ entries: logOf(20, 3, 5), hours: 4 }), null); // 4 of 20 is under 30%
  assert.equal(tuneOffer({ entries: logOf(15, 1, 1), hours: 4 }), null); // under 2 hours is not the range just below 4
});

test('tuning: checks just above the threshold rarely finding changes offers the next higher step', () => {
  assert.deepEqual(tuneOffer({ entries: logOf(12, 5, 0), hours: 4 }), { dir: 'up', from: 4, to: 8, lo: 4, hi: 8, checks: 12, changed: 0 });
  assert.equal(tuneOffer({ entries: logOf(12, 5, 6), hours: 4 }), null); // 2 of 12 is not under 10%
  assert.equal(tuneOffer({ entries: logOf(12, 30, 0), hours: 24 })?.to, 48);
  assert.equal(tuneOffer({ entries: logOf(12, 60, 0), hours: 48 }), null); // no step above 2 days
  assert.equal(tuneOffer({ entries: logOf(12, 0.5, 1), hours: 1 }), null); // no step below 1 hour
});

test('tuning: Not now holds the same move until 10 more checks in its range', () => {
  const dismissed = [{ from: 4, to: 2, checks: 15 }];
  assert.equal(tuneOffer({ entries: logOf(15, 3, 2), hours: 4, dismissed }), null);
  assert.equal(tuneOffer({ entries: logOf(24, 3, 2), hours: 4, dismissed }), null);
  assert.equal(tuneOffer({ entries: logOf(25, 3, 2), hours: 4, dismissed })?.to, 2);
  // a dismissed move down does not hide a move up
  assert.equal(tuneOffer({ entries: [...logOf(15, 3, 2), ...logOf(12, 5, 0)], hours: 4, dismissed })?.to, 8);
});

test('tuning: the card says the numbers', () => {
  const w = tuneWords('Acme', { dir: 'down', from: 4, to: 2, lo: 2, hi: 4, checks: 15, changed: 6 });
  assert.equal(w.line, 'Summaries on Acme: checks under 4 hours after the last reply found changes 6 of 15 times.');
  assert.equal(w.ask, 'Check after 2 hours instead?');
  assert.equal(tuneWords('Acme', { dir: 'up', from: 8, to: 24, lo: 8, hi: 24, checks: 12, changed: 1 }).ask, 'Check after 1 day instead?');
  assert.equal(hoursWords(48), '2 days');
});
