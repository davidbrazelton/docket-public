// Tests for the news-only reports in reports.mjs (#734): which child reports leave a note instead of waking the
// parent, how held news reaches it, and the debounce for children that finish close together. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnNewsFor, reportIsNews, heldNewsText, debounceLeft, REPORT_DEBOUNCE } from '../reports.mjs';

test('turnNewsFor: a Nothing to do now notice and an agree-done message mark the turn as news', () => {
  assert.equal(turnNewsFor({ notice: 'The session "X" (id 1) now reports to you. Its finished turns will come to you as session reports. Nothing to do now; reply in one line at most.' }), 'ack');
  assert.equal(turnNewsFor({ notice: 'Docket asked this session to save its state.' }), '');
  assert.equal(turnNewsFor({ message: 'Checked and agree the work is done; the merge is still yours to ask for.' }), 'agreed');
  assert.equal(turnNewsFor({ message: 'I checked the PR and agree it is done.' }), 'agreed');
  assert.equal(turnNewsFor({ message: 'Looks good.', done: true }), 'agreed');
  assert.equal(turnNewsFor({ message: 'The tests fail on Windows; please fix the path handling.' }), '');
  assert.equal(turnNewsFor({ message: 'I do not agree it is done: the test is missing.' }), '');
  assert.equal(turnNewsFor({ message: "I don't agree it's done yet." }), '');
  assert.equal(turnNewsFor({}), '');
});

test('reportIsNews: news only when a cause marked it, never on an error', () => {
  for (const cause of ['ack', 'agreed', 'quiet']) assert.equal(reportIsNews({ cause }), true, cause);
  assert.equal(reportIsNews({ cause: '' }), false);
  assert.equal(reportIsNews({}), false);
  assert.equal(reportIsNews({ cause: 'ack', error: true }), false);
  assert.equal(reportIsNews({ cause: 'quiet', error: true }), false);
});

test('reportIsNews: the last open child saying ready to close still wakes the parent; an acknowledgement does not', () => {
  assert.equal(reportIsNews({ cause: 'agreed', lastOpen: true }), false);
  assert.equal(reportIsNews({ cause: 'agreed', lastOpen: false }), true);
  assert.equal(reportIsNews({ cause: 'ack', lastOpen: true }), true);
  assert.equal(reportIsNews({ cause: 'quiet', lastOpen: true }), true);
});

test('heldNewsText: held news reaches the parent with its next turn, one line per report', () => {
  assert.equal(heldNewsText([]), '');
  const t = heldNewsText([{ childId: 'a1', title: 'Fix the list', text: 'Complete and ready to close.' }, { childId: 'b2', title: 'Docs', text: 'Noted.' }]);
  assert.match(t, /^\(From Docket:/);
  assert.match(t, /- "Fix the list" \(id a1\) finished a turn: Complete and ready to close\./);
  assert.match(t, /- "Docs" \(id b2\) finished a turn: Noted\./);
});

test('debounceLeft: reports to an idle parent wait for a quiet spell, but not past the cap', () => {
  const { quietMs, maxMs } = REPORT_DEBOUNCE, now = 1e9;
  assert.equal(debounceLeft([], now), 0);
  assert.equal(debounceLeft([{ at: now }], now), quietMs);
  assert.equal(debounceLeft([{ at: now - quietMs }], now), 0);
  assert.equal(debounceLeft([{ at: now - 10000 }, { at: now }], now), quietMs); // the wait runs from the latest
  assert.equal(debounceLeft([{ at: now - maxMs + 5000 }, { at: now }], now), 5000); // the first one's cap holds
  assert.equal(debounceLeft([{ at: now, byPerson: true }], now), 0); // a turn the person started goes at once
  assert.equal(debounceLeft([{ kind: 'plan' }], now), 0); // freed plan tasks carry no time and go at once
});
