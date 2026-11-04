// #663: a task set done by mistake can be corrected by the plan's coordinator, to dropped or back to open, with a
// note; the plan file says so, and progress and readiness follow the corrected state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePlan, formatPlan, readyTasks, createPlanStore } from '../plans.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plans-'));
const three = [{ kind: 'build', title: 'Set up the domain' }, { kind: 'build', title: 'Send the first email', after: [1] }, { kind: 'build', title: 'Write the tests' }];
function withDone() {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'P', tasks: three, coordinator: 'c1', coordinatorTitle: 'Coordinator' });
  s.claim(p.id, 'T1', 'w1', 'Worker one');
  s.update(p.id, 'T1', { state: 'done', note: 'Bundled; cleared.' }, 'w1');
  return { s, p };
}

test('the coordinator corrects a wrongly done task to dropped: the note says so and progress stops counting it', () => {
  const { s, p } = withDone();
  assert.deepEqual(s.rollup(p.id), { done: 1, total: 3 });
  const r = s.update(p.id, 'T1', { state: 'dropped', note: 'Not done: replaced by T4.' }, 'c1');
  assert.equal(r.task.state, 'dropped');
  assert.equal(r.task.note, 'Corrected from done: Not done: replaced by T4. (earlier note: Bundled; cleared.)');
  const text = fs.readFileSync(s.fileOf(p.id), 'utf8');
  assert.match(text, /^- \[ \] T1 Set up the domain\n {2}- Kind: build\n {2}- State: dropped/m);
  assert.match(text, /^ {2}- Note: Corrected from done: Not done: replaced by T4\./m);
  assert.deepEqual(s.rollup(p.id), { done: 0, total: 2 });
  // Once dropped, a replacement can name it.
  assert.deepEqual(s.addTasks(p.id, [{ kind: 'build', title: 'Domain, for real', replaces: 'T1' }], 'c1').added.map((t) => t.id), ['T4']);
});

test('the coordinator reopens a wrongly done task: it is free again and tasks waiting on it wait again', () => {
  const { s, p } = withDone();
  assert.deepEqual(readyTasks(s.read(p.id)).map((t) => t.id), ['T2', 'T3']);
  const r = s.update(p.id, 'T1', { state: 'open', note: 'The domain was never verified.' }, 'c1');
  assert.deepEqual([r.task.state, r.task.holder, r.task.note], ['open', '', 'Corrected from done: The domain was never verified. (earlier note: Bundled; cleared.)']);
  const back = s.read(p.id);
  assert.deepEqual(readyTasks(back).map((t) => t.id), ['T1', 'T3']);
  assert.throws(() => s.claim(p.id, 'T2', 'w2'), /T2 waits on T1/);
  assert.deepEqual(s.rollup(p.id), { done: 0, total: 3 });
  assert.equal(s.claim(p.id, 'T1', 'w2').task.holder, 'w2');
});

test('only the coordinator corrects done, always with a note, and only to dropped or open', () => {
  const { s, p } = withDone();
  assert.throws(() => s.update(p.id, 'T1', { state: 'open', note: 'Oops' }, 'w1'), /already done\. Only the plan's coordinator/);
  assert.throws(() => s.update(p.id, 'T1', { state: 'dropped', note: 'Oops' }, 'w1'), /Only the plan's coordinator/);
  assert.throws(() => s.update(p.id, 'T1', { state: 'claimed' }, 'w1'), /Only the plan's coordinator/);
  assert.throws(() => s.update(p.id, 'T1', { state: 'open' }, 'c1'), /Say why T1 was not really done/);
  assert.throws(() => s.update(p.id, 'T1', { state: 'dropped', note: '  ' }, 'c1'), /Say why T1/);
  assert.throws(() => s.update(p.id, 'T1', { state: 'claimed' }, 'c1'), /set it dropped or open with a note/);
  assert.throws(() => s.claim(p.id, 'T1', 'w2'), /already done/);
  assert.throws(() => s.addTasks(p.id, [{ kind: 'build', title: 'X', replaces: 'T1' }], 'c1'), /correct it first/);
  assert.equal(s.read(p.id).tasks[0].state, 'done');
  // Sending a finished task back after checking it is still the coordinator's, and needs no correction note.
  assert.equal(s.update(p.id, 'T1', { state: 'sent_back', note: 'Tests missing' }, 'c1').task.note, 'Tests missing');
});

test('an old plan file with done tasks reads and writes back unchanged', () => {
  const old = '# Old\n\n- Plan: p-old123\n- Coordinator: c1 (Coordinator)\n\nThe goal.\n\n## Tasks\n\n- [x] T1 A\n  - State: done since 2026-10-01 10:00\n  - Held by: w1 (Worker)\n  - Note: Finished.\n- [ ] T2 B\n  - State: open\n  - After: T1\n';
  const p = parsePlan(old);
  assert.equal(formatPlan(p), old);
  assert.deepEqual(readyTasks(p).map((t) => t.id), ['T2']);
});
