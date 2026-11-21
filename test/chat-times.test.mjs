// The time each saved Claude message was written: read from the transcript file's own UTC timestamps, by record id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcriptTimes, asyncHookEvents, covered, turnSplit } from '../chat-times.mjs';

test('each record with an id and a timestamp gets its UTC time', () => {
  const text = [
    JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-10-30T14:32:01.250Z', message: {} }),
    JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: '2026-10-30T14:32:09Z', message: {} }),
  ].join('\n');
  const times = transcriptTimes(text);
  assert.equal(times.get('u1'), Date.parse('2026-10-30T14:32:01.250Z'));
  assert.equal(times.get('a1'), Date.parse('2026-10-30T14:32:09Z'));
});

test('lines without an id or a time, and lines that are not JSON, are skipped', () => {
  const text = [
    JSON.stringify({ type: 'summary', summary: 'no time here' }),
    JSON.stringify({ type: 'user', timestamp: '2026-10-30T14:00:00Z' }),
    '{"type":"user","uuid":"bad","timestamp":',
    JSON.stringify({ type: 'user', uuid: 'ok', timestamp: 'not a date' }),
  ].join('\n');
  assert.equal(transcriptTimes(text).size, 0);
});

test('an empty or missing file gives no times', () => {
  assert.equal(transcriptTimes('').size, 0);
  assert.equal(transcriptTimes(undefined).size, 0);
});

// The time hooks hold a turn up (#743): split hooks first, so a hook inside a step or a model call counts as hook time.

test('covered counts overlapping spans once, inside the window', () => {
  assert.equal(covered([[0, 10], [5, 15], [20, 25]]), 20);
  assert.equal(covered([[0, 10], [5, 15]], 8, 12), 4);
  assert.equal(covered([]), 0);
});

test('a turn splits into hook, step and model time, hooks first', () => {
  // A 60 s turn: UserPromptSubmit 0-5 s overlaps the first model call (0-20 s); a Bash step 20-40 s holds its
  // PreToolUse (20-25 s) and PostToolUse (35-40 s); the Stop hook runs 55-60 s.
  const split = turnSplit({ start: 0, end: 60000, hooks: [[0, 5000], [20000, 25000], [35000, 40000], [55000, 60000]], tools: [[20000, 40000]] });
  assert.deepEqual(split, { hookMs: 20000, toolMs: 10000, modelMs: 30000 });
});

test('a hook still running when the turn ends counts up to the end', () => {
  assert.deepEqual(turnSplit({ start: 0, end: 10000, hooks: [[8000, 0]], tools: [] }), { hookMs: 2000, toolMs: 0, modelMs: 8000 });
});

test('with no hooks the split is left out, so the turn shows as before', () => {
  assert.equal(turnSplit({ start: 0, end: 60000, hooks: [], tools: [[20000, 40000]] }), null);
});

test('an event whose every hook is async is left out; one with a synchronous hook is not', () => {
  const company = { hooks: {
    PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'c', async: false }] }],
    PostToolBatch: [{ matcher: '', hooks: [{ type: 'command', command: 'c', async: true }] }],
    Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'c', async: true }] }],
  } };
  const desk = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine' }] }] } }; // no async: synchronous
  assert.deepEqual([...asyncHookEvents([company, desk])], ['PostToolBatch']);
  assert.equal(asyncHookEvents([]).size, 0);
  assert.equal(asyncHookEvents([{ hooks: 'bad' }, null]).size, 0);
});
