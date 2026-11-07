// Tests for when a session needs you: the saved rules (needs-you.mjs) and the page's needsYou in index.html. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { savedWaiting, unreadAfterRestart, keptReason, markUnreadReason } from '../needs-you.mjs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.indexOf('// ---------- needs you');
const end = page.indexOf('// end of needs you');
assert.ok(start > 0 && end > start, 'the needs you part of index.html has moved or lost its markers');
const inBackground = (s) => s.live && s.status === 'idle' && (s.runningTasks > 0 || s.background);
const { needsYou, needLabel } = new Function('inBackground', page.slice(start, end) + '\nreturn { needsYou, needLabel };')(inBackground);

test('a row says why it needs you, from Docket\'s own signals first (#671)', () => {
  const done = { live: true, unread: true, status: 'idle', unreadWhy: 'result' };
  assert.equal(needLabel(done), 'reply', 'a plain finished turn');
  assert.equal(needLabel({ ...done, unreadSaid: 'done' }), 'done');
  assert.equal(needLabel({ ...done, unreadSaid: 'done' }, true), 'merge', 'an open pull request outranks done');
  assert.equal(needLabel({ ...done, unreadWhy: 'error' }), 'problem');
  assert.equal(needLabel({ ...done, lastError: { text: 'fetch failed' } }), 'problem');
  for (const why of ['offer', 'permission', 'cross', 'handoff', 'requires_action']) assert.equal(needLabel({ ...done, unreadWhy: why }), 'question', why);
  assert.equal(needLabel({ ...done, status: 'requires_action' }), 'question');
  assert.equal(needLabel({ ...done, asksYou: true }), 'question', 'a reply that ends by asking');
  assert.equal(needLabel({ ...done, unreadSaid: 'question' }), 'question', 'a session may say its plain reply asks');
});

test('a declared label never makes a row quieter than Docket\'s signal', () => {
  const base = { live: true, unread: true, status: 'idle' };
  assert.equal(needLabel({ ...base, unreadWhy: 'offer', unreadSaid: 'done' }), 'question', 'an open card stays question');
  assert.equal(needLabel({ ...base, unreadWhy: 'error', unreadSaid: 'reply' }), 'problem');
  assert.equal(needLabel({ ...base, asksYou: true, unreadSaid: 'done' }), 'question');
  assert.equal(needLabel({ ...base, unreadSaid: 'reply' }, true), 'merge');
});

const stopped = { unread: true, status: 'ended', lastError: { text: 'Session stopped: fetch failed' } };

test('a session stopped by an error and not opened is saved as waiting', () => {
  assert.equal(savedWaiting(stopped), true);
  assert.equal(savedWaiting({ ...stopped, unread: false }), false, 'opened since');
  assert.equal(savedWaiting({ ...stopped, lastError: null }), false, 'ended without an error, as after End');
});

test('the other saved waiting cases are unchanged', () => {
  assert.equal(savedWaiting({ unread: true, status: 'idle' }), true);
  assert.equal(savedWaiting({ unread: true, status: 'idle', heldTurn: true }), false);
  assert.equal(savedWaiting({ unread: true, status: 'requires_action' }), true);
  assert.equal(savedWaiting({ unread: true, status: 'running' }), false);
  assert.equal(savedWaiting({ unread: false, status: 'idle' }), false);
});

test('after an app restart a session that was waiting comes back unread', () => {
  // The case in #590: stopped by an error, still held by the runner, brought back idle.
  assert.equal(unreadAfterRestart({ asks: 0, wasWaiting: savedWaiting(stopped), busy: false }), true);
  assert.equal(unreadAfterRestart({ asks: 0, wasWaiting: true, busy: true }), false, 'working again: not waiting');
  assert.equal(unreadAfterRestart({ asks: 0, wasWaiting: false, busy: false }), false, 'seen before the restart');
  assert.equal(unreadAfterRestart({ asks: 1, wasWaiting: false, busy: true }), true);
  assert.equal(unreadAfterRestart({ asks: 0, wasWaiting: false, busy: false, unsent: { at: 1 } }), true);
});

test('the page lists a live session stopped by an error under Needs you until it is opened', () => {
  assert.equal(needsYou({ live: true, ...stopped }), true);
  assert.equal(needsYou({ live: true, ...stopped, unread: false }), false, 'opened');
  assert.equal(needsYou({ live: true, unread: true, status: 'ended', lastError: null }), false);
  // Back after a restart: idle, unread again, the error still saved.
  assert.equal(needsYou({ live: true, unread: true, status: 'idle', lastError: stopped.lastError }), true);
  // Sending a message clears unread and the error and sets it running.
  assert.equal(needsYou({ live: true, unread: false, status: 'running', lastError: null }), false);
});

test('the page keeps its other needs you cases', () => {
  assert.equal(needsYou({ live: true, status: 'requires_action' }), true);
  assert.equal(needsYou({ live: true, status: 'idle', unread: true }), true);
  assert.equal(needsYou({ live: true, status: 'idle', unread: true, runningTasks: 2 }), false);
  assert.equal(needsYou({ live: true, status: 'running', unread: true }), false);
  assert.equal(needsYou({ live: false, waiting: true }), true);
  assert.equal(needsYou({ live: false, waiting: false, lastError: stopped.lastError }), false);
});

test('Mark unread brings back the tag the row had before it was read (#771)', () => {
  const row = (r) => ({ live: true, unread: true, status: 'idle', unreadWhy: r.why, unreadSaid: r.said });
  for (const [why, said, label] of [['result', 'done', 'done'], ['result', 'question', 'question'], ['error', '', 'problem'], ['offer', '', 'question'], ['result', '', 'reply']]) {
    const kept = keptReason(why, said); // saved as readWhy when it is read, so it survives a restart
    assert.equal(needLabel(row(markUnreadReason(JSON.parse(JSON.stringify(kept))))), label, `${why} ${said}`);
  }
  assert.deepEqual(markUnreadReason(undefined), { why: 'mark-unread', said: '' }, 'nothing kept: Mark unread is the reason');
  assert.equal(keptReason(null, 'done'), undefined, 'no reason, nothing to keep');
  const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(server, /setUnread\(s, 'mark-unread'\); s\.unreadWhy = back\.why/, 'the live session takes the kept reason back');
  assert.match(server, /rec\.waitingWhy = back/, 'and so does a saved one');
  assert.match(server, /by \$\{s\.unreadBy/, 'the log still says Mark unread turned it orange');
});
