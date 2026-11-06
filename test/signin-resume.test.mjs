// Tests for signin-resume.mjs, carrying on a session after its desk signs in again (#719). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failedTurn, newSigninFail, messagedSince, signinResumeCheck, dropsMark, signinNote, RECENT_MS, MAX_TEXT } from '../signin-resume.mjs';

const now = Date.parse('2026-11-06T12:00:00Z');
const earlier = [{ k: 'user', text: 'old message' }, { k: 'text', text: 'old reply' }, { k: 'result' }];

test('a turn that failed before doing anything sends its message again', () => {
  assert.deepEqual(failedTurn([...earlier, { k: 'user', text: ' fix the build ' }, { k: 'error', text: 'Token is expired' }]), { midTurn: false, text: 'fix the build' });
});

test('a turn that had replied or used a tool is told to carry on, not sent the message twice', () => {
  assert.deepEqual(failedTurn([...earlier, { k: 'user', text: 'go' }, { k: 'tool', name: 'Bash' }, { k: 'error' }]), { midTurn: true, text: '' });
  assert.deepEqual(failedTurn([...earlier, { k: 'user', text: 'go' }, { k: 'text', text: 'On it' }, { k: 'error' }]), { midTurn: true, text: '' });
});

test('a turn not started by a message (a report, a continue) is told to carry on, never sent an older message', () => {
  assert.deepEqual(failedTurn([...earlier, { k: 'note', text: 'Resumed' }, { k: 'error' }]), { midTurn: true, text: '' });
  assert.deepEqual(failedTurn([]), { midTurn: true, text: '' });
  assert.deepEqual(failedTurn(undefined), { midTurn: true, text: '' });
});

test('a message too long to keep is not saved; the session is told to carry on', () => {
  assert.equal(failedTurn([{ k: 'user', text: 'x'.repeat(MAX_TEXT + 1) }]).midTurn, true);
});

test('the mark keeps the time, the turn and whether it was the automatic try', () => {
  const events = [{ k: 'user', text: 'hi' }, { k: 'error' }];
  assert.deepEqual(newSigninFail({ events, now }), { at: now, midTurn: false, text: 'hi' });
  assert.deepEqual(newSigninFail({ events, tried: true, now }), { at: now, midTurn: false, text: 'hi', tried: true });
});

test('messagedSince: a message after the failure counts; tool results, meta lines and the lines written at rest do not', () => {
  const line = (o) => JSON.stringify(o);
  const at = (ms) => new Date(now + ms).toISOString();
  const before = line({ type: 'user', timestamp: at(-5000), message: { role: 'user', content: 'fix the build' } });
  const rest = [line({ type: 'last-prompt', lastPrompt: 'fix the build' }), line({ type: 'cost-state', sessionId: 'x' })];
  assert.equal(messagedSince([before, ...rest].join('\n'), now), false, 'resting writes its own lines, which are not a message');
  assert.equal(messagedSince(line({ type: 'user', timestamp: at(1000), message: { content: [{ type: 'tool_result', content: 'ok' }] } }), now), false);
  assert.equal(messagedSince(line({ type: 'user', isMeta: true, timestamp: at(1000), message: { content: 'caveat' } }), now), false);
  assert.equal(messagedSince(line({ type: 'user', timestamp: at(1000), message: { content: 'carry on' } }), now), true, 'typed in another app');
  assert.equal(messagedSince(line({ type: 'user', timestamp: at(1000), message: { content: [{ type: 'text', text: 'hi' }] } }) + '\r\n', now), true);
  assert.equal(messagedSince('not json\n{"type":"user"', now), false, 'a cut first or last line is skipped');
  assert.equal(messagedSince('', now), false);
});

test('an eligible session carries on by itself, on a sign-in seen or done by the person', () => {
  const rec = { signinFail: newSigninFail({ events: [], now }) };
  assert.deepEqual(signinResumeCheck({ on: true, rec, now: now + 60_000 }), { go: true });
  assert.deepEqual(signinResumeCheck({ on: true, rec, how: 'user', now: now + 60_000 }), { go: true });
});

test('each guard stops it and says why', () => {
  const signinFail = newSigninFail({ events: [], now });
  const ok = { on: true, rec: { signinFail }, how: 'seen', now: now + 60_000 };
  const why = (o) => { const r = signinResumeCheck({ ...ok, ...o }); assert.equal(r.go, false); return r.why; };
  assert.match(why({ rec: {} }), /did not fail on its sign-in/);
  assert.match(why({ rec: null }), /did not fail on its sign-in/);
  assert.match(why({ on: false }), /is off/);
  assert.match(why({ archived: true }), /archived/);
  assert.match(why({ paused: true }), /paused/);
  assert.match(why({ now: now + RECENT_MS + 1 }), /more than 12 hours/);
  assert.match(why({ working: true }), /already working/);
  assert.match(why({ messaged: true }), /sent something after the failure/);
  assert.match(why({ rec: { signinFail: { ...signinFail, tried: true } } }), /one automatic try/, 'a try that failed again does not loop on the recheck');
});

test('a session that failed again after its automatic try goes on the person\'s next sign-in', () => {
  const rec = { signinFail: { ...newSigninFail({ events: [], now }), tried: true } };
  assert.equal(signinResumeCheck({ on: true, rec, how: 'user', now: now + 1000 }).go, true);
});

test('only a pause or a used try keep the mark for a later sign-in', () => {
  const r = (o) => signinResumeCheck({ on: true, rec: { signinFail: { at: now, midTurn: true, text: '', ...o.f } }, now: now + 1000, ...o }).why;
  assert.equal(dropsMark(r({ paused: true })), false);
  assert.equal(dropsMark(r({ f: { tried: true } })), false);
  assert.equal(dropsMark(r({ on: false })), true);
  assert.equal(dropsMark(r({ archived: true })), true);
  assert.equal(dropsMark(r({ now: now + RECENT_MS + 1 })), true);
  assert.equal(dropsMark(r({ messaged: true })), true);
  assert.equal(dropsMark(r({ working: true })), true);
});

test('the note says the sign-in ran out and is back, and what to do', () => {
  const mid = signinNote({ at: now, midTurn: true });
  assert.match(mid, /^\(From Docket: /);
  assert.match(mid, /sign-in ran out/);
  assert.match(mid, /signed in again/);
  assert.match(mid, /may or may not have finished/);
  assert.match(mid, /carry on/);
  assert.ok(mid.endsWith(')'));
  const again = signinNote({ at: now, midTurn: false, text: 'hi' });
  assert.match(again, /failed before it started/);
  assert.match(again, /sent it again/);
});
