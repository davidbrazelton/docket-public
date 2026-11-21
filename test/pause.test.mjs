// Tests for pause.mjs, the rules of Pause all / Resume all. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workingNow, newPause, holdsMessage, noteMessaged, wokeByItself, noteWoke, resumePlan, resumeNote, pauseWhy, autoPaused, clockJumped,
  newSessionPause, pauseNeedsChoice, pauseStops, restsNow, sessionHolds, takeQueued, sessionPauseView, sessionResumeNote } from '../pause.mjs';

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

test('while paused, a turn the session starts by itself is caught; the person\'s message and answers are not (#644)', () => {
  const p = newPause('user', []);
  assert.equal(wokeByItself(p, 'idle', 'running'), true, 'a background command ended and Claude Code started a turn');
  assert.equal(wokeByItself(p, 'idle', 'starting'), true);
  assert.equal(wokeByItself(p, 'running', 'running'), false, 'sendToSession already set running for the person\'s message');
  assert.equal(wokeByItself(p, 'requires_action', 'running'), false, 'the person answered a question');
  assert.equal(wokeByItself(p, 'running', 'idle'), false);
  assert.equal(wokeByItself(null, 'idle', 'running'), false, 'not paused: nothing to stop');
});

test('a session that woke during the pause is marked, added if Pause all left it out, and told about it on Resume', () => {
  const p = newPause('user', [{ id: 'a', client: 'c1', title: 'A', stopped: false }]);
  assert.equal(noteMessaged(p, 'a'), true);
  assert.equal(noteWoke(p, { id: 'a', client: 'c1', title: 'A' }), true);
  assert.equal(noteWoke(p, { id: 'b', client: 'c2' }), true);
  assert.equal(noteWoke(null, { id: 'x' }), false);
  const plan = resumePlan(p);
  assert.deepEqual(plan.map((x) => `${x.id}:${x.woke}`), ['a:true', 'b:true'], 'the person wrote to a earlier, but it woke after that, so it still gets the note');
  assert.equal(p.sessions[1].title, 'Untitled');
  const note = resumeNote(p, { stopped: false, woke: true });
  assert.match(note, /background command .* finished and started a new turn by itself/);
  assert.match(note, /Docket stopped that turn/);
  assert.doesNotMatch(resumeNote(p, { stopped: false }), /by itself/);
});

// ---------- Pause one session (#1070) ----------
test('pausing a session with background commands asks to wait for them or stop them; never freezes them', () => {
  assert.equal(pauseNeedsChoice(0), false);
  assert.equal(pauseNeedsChoice(2), true);
  assert.equal(pauseNeedsChoice(2, 'wait'), false);
  assert.equal(pauseNeedsChoice(2, 'stop'), false);
  assert.equal(pauseNeedsChoice(2, 'freeze'), true);
  assert.equal(newSessionPause({ client: 'c' }, { jobs: 'freeze' }).jobs, '', 'an unknown choice is not saved');
});

test('Pause stops a turn in progress, also one waiting on the person; an idle session has nothing to stop', () => {
  for (const status of ['starting', 'running', 'requires_action']) assert.equal(pauseStops({ status }), true, status);
  for (const status of ['idle', 'ended']) assert.equal(pauseStops({ status }), false, status);
});

test('a paused session rests once its turn stopped and the commands it waits for ended; Stop rests it at once', () => {
  const wait = newSessionPause({ client: 'c' }, { jobs: 'wait' }), stop = newSessionPause({ client: 'c' }, { jobs: 'stop' }), none = newSessionPause({ client: 'c' });
  assert.equal(restsNow(none, { status: 'idle' }), true);
  assert.equal(restsNow(none, { status: 'running' }), false, 'its turn is still being stopped');
  assert.equal(restsNow(wait, { status: 'idle', runningJobs: 1 }), false);
  assert.equal(restsNow(wait, { status: 'idle', runningJobs: 0 }), true);
  assert.equal(restsNow(stop, { status: 'idle', runningJobs: 3 }), true, 'resting ends the process and its commands');
  assert.equal(restsNow(null, { status: 'idle' }), false);
});

test('while a session is paused, only what the person types gets through (and resumes it)', () => {
  const p = newSessionPause({ client: 'c' });
  assert.equal(sessionHolds(p, {}), false, 'the person typed it');
  for (const from of ['session', 'brief', 'docket', 'pilot']) assert.equal(sessionHolds(p, { from }), true, from);
  assert.equal(sessionHolds(p, { system: true }), true, 'reports, wake-ups and notices');
  assert.equal(sessionHolds(null, { system: true }), false);
});

test('queue mode: a paused session\'s queued messages leave the queue for its held list', () => {
  const q = [{ id: 'a', text: '1' }, { id: 'b', text: '2' }, { id: 'a', text: '3' }];
  const { queue, taken } = takeQueued(q, 'a');
  assert.deepEqual(queue.map((x) => x.id), ['b']);
  assert.deepEqual(taken.map((x) => x.text), ['1', '3'], 'in order');
  assert.deepEqual(takeQueued(undefined, 'a'), { queue: [], taken: [] });
});

test('Resume all skips the resume note for a session paused on its own', () => {
  const p = newPause('user', [{ id: 'a', client: 'c', stopped: true }, { id: 'b', client: 'c', stopped: true }]);
  assert.deepEqual(resumePlan(p, { skip: (id) => id === 'b' }).map((x) => x.id), ['a']);
});

test('the resume note says the user paused it and to carry on, with what happened meanwhile', () => {
  const p = newSessionPause({ client: 'c', title: 'T' }, { stopped: true, jobs: 'stop' }, '2026-11-14T10:00:00.000Z');
  p.held.push({ text: 'x' }, { text: 'y' });
  const note = sessionResumeNote(p);
  assert.match(note, /^\(From Docket: the user paused this session/);
  assert.match(note, /Carry on where you left off/);
  assert.match(note, /stopped partway through/);
  assert.match(note, /background commands were stopped/);
  assert.match(note, /2 messages sent to it during the pause .* come next/);
  assert.match(sessionResumeNote(p, { typed: true }), /by writing to it/);
  const quiet = sessionResumeNote(newSessionPause({ client: 'c' }));
  assert.doesNotMatch(quiet, /partway|stopped|come next/);
  p.woke = true;
  assert.match(sessionResumeNote(p), /started a turn by itself/);
  assert.deepEqual(sessionPauseView(newSessionPause({ client: 'c' }, { jobs: 'wait' }, 'x'), { resting: false }), { at: 'x', held: 0, waiting: true });
});
