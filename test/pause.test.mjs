// Tests for pause.mjs, the rules of Pause all / Resume all. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workingNow, newPause, holdsMessage, noteMessaged, resumePlan, resumeNote, pauseWhy, autoPaused, clockJumped } from '../pause.mjs';

test('a reply in progress is stopped; background commands alone are listed but not stopped; the rest are left out', () => {
  assert.deepEqual(workingNow({ status: 'running' }), { stop: true });
  assert.deepEqual(workingNow({ status: 'starting' }), { stop: true });
  assert.deepEqual(workingNow({ status: 'idle' }, 2), { stop: false });
  assert.deepEqual(workingNow({ status: 'idle', heldTurn: true }), { stop: false });
  assert.equal(workingNow({ status: 'idle' }), null);
  assert.equal(workingNow({ status: 'requires_action' }), null, 'a question waiting on the person is not cut off');
  assert.equal(workingNow({ status: 'ended' }, 3), null);
});

test('while paused, messages from Docket and other sessions wait; what the person types goes through', () => {
  const p = newPause('user', []);
  assert.equal(holdsMessage(p, { system: true }), true);
  assert.equal(holdsMessage(p, { from: 'session' }), true);
  assert.equal(holdsMessage(p, {}), false);
  assert.equal(holdsMessage(null, { system: true }), false, 'nothing waits when not paused');
});

test('Resume all tells each paused session to carry on, skips ones the person wrote to, then sends held messages in order', () => {
  const p = newPause('user', [
    { id: 'a', client: 'c1', title: 'A', stopped: true },
    { id: 'b', client: 'c2', title: 'B', stopped: false },
    { id: 'c', client: 'c1', title: 'C', stopped: true },
  ]);
  p.held.push({ id: 'z', client: 'c1', text: '', context: 'report 1', system: true, from: '' });
  p.held.push({ id: 'a', client: 'c1', text: 'hi', context: '', system: false, from: 'session' });
  assert.equal(noteMessaged(p, 'c'), true);
  assert.equal(noteMessaged(p, 'c'), false, 'only the first message counts as a change');
  assert.equal(noteMessaged(p, 'nope'), false);
  const plan = resumePlan(p);
  assert.deepEqual(plan.map((x) => `${x.kind}:${x.id}`), ['note:a', 'note:b', 'held:z', 'held:a']);
  assert.equal(plan[1].stopped, false);
  assert.deepEqual(resumePlan(null), []);
});

test('the resume note says why, that Docket made the stop, and to check servers and browsers', () => {
  const p = newPause('user', [], '2026-10-28T22:00:00.000Z');
  const stopped = resumeNote(p, { stopped: true });
  assert.match(stopped, /^\(From Docket: /);
  assert.match(stopped, /Pause all/);
  assert.match(stopped, /Docket did it, not the user/);
  assert.match(stopped, /test server, browser or background command/);
  assert.match(stopped, /carry on/);
  assert.doesNotMatch(resumeNote(p, { stopped: false }), /partway through/);
  assert.match(resumeNote(newPause('sleep', []), {}), /about to sleep/);
  assert.equal(newPause('nonsense', []).reason, 'user', 'an unknown reason is saved as the button');
  assert.equal(pauseWhy('shutdown'), 'the computer was about to shut down or restart');
});

test('an automatic pause ends by itself; the person\'s own Pause all does not', () => {
  assert.equal(autoPaused(newPause('sleep', [])), true);
  assert.equal(autoPaused(newPause('shutdown', [])), true);
  assert.equal(autoPaused(newPause('slept', [])), true);
  assert.equal(autoPaused(newPause('user', [])), false);
  assert.equal(autoPaused(null), false);
  assert.match(resumeNote(newPause('slept', []), {}), /without warning/);
});

test('the wake check counts five minutes or more between ticks as a sleep', () => {
  assert.equal(clockJumped(0, 30000), false);
  assert.equal(clockJumped(0, 4 * 60000), false);
  assert.equal(clockJumped(0, 5 * 60000), true);
  assert.equal(clockJumped(0, 60000, 60000), true);
});
