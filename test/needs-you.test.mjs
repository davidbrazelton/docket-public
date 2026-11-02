// Tests for when a session needs you: the saved rules (needs-you.mjs) and the page's needsYou in index.html. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { savedWaiting, unreadAfterRestart } from '../needs-you.mjs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.indexOf('// ---------- needs you');
const end = page.indexOf('// end of needs you');
assert.ok(start > 0 && end > start, 'the needs you part of index.html has moved or lost its markers');
const inBackground = (s) => s.live && s.status === 'idle' && (s.runningTasks > 0 || s.background);
const { needsYou } = new Function('inBackground', page.slice(start, end) + '\nreturn { needsYou };')(inBackground);

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
