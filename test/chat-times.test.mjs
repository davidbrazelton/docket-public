// The time each saved Claude message was written: read from the transcript file's own UTC timestamps, by record id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcriptTimes } from '../chat-times.mjs';

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
