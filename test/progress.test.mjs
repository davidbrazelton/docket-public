// A session's own rough estimate (#1053): what report_progress keeps, and when it goes stale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressOf, progressFresh, PROGRESS_STALE, STEP_MAX } from '../progress.mjs';

test('a report keeps done, total, a tidy step and when', () => {
  assert.deepEqual(progressOf({ done: 3, total: 7, step: '  running\n tests ' }, 1000), { progress: { done: 3, total: 7, step: 'running tests', at: 1000 } });
  assert.deepEqual(progressOf({ done: 0, total: 1 }, 5), { progress: { done: 0, total: 1, at: 5 } });
  assert.equal(progressOf({ done: 1, total: 2, step: 'x'.repeat(200) }).progress.step.length, STEP_MAX);
});

test('done past total is kept at total', () => {
  assert.equal(progressOf({ done: 9, total: 4 }).progress.done, 4);
});

test('a report with no checklist is refused, never a made-up number', () => {
  for (const bad of [{ done: 1, total: 0 }, { done: 1 }, { done: -1, total: 3 }, { done: 1.5, total: 3 }, { done: 'a', total: 3 }, undefined])
    assert.ok(progressOf(bad).error, JSON.stringify(bad));
});

test('an estimate goes stale after a long quiet', () => {
  const p = progressOf({ done: 1, total: 3 }, 0).progress;
  assert.ok(progressFresh(p, PROGRESS_STALE - 1));
  assert.ok(!progressFresh(p, PROGRESS_STALE));
  assert.ok(!progressFresh(null));
});
