// The Plan section's order (#868): steps stay in plan order, a step that waits on an earlier one of the same phase
// hangs under it, phases come in the plan's order, and a "label — a, b, c, d" note line is a list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const a = page.indexOf('// ---------- plan order (#868)'), b = page.indexOf('// end of plan order');
assert.ok(a > 0 && b > a, 'the plan order part of index.html has moved or lost its markers');
const { planParents, planTree, planPhases, planNoteLines } = new Function(page.slice(a, b) + '\nreturn { planParents, planTree, planPhases, planNoteLines };')();

const task = (id, after = [], phase) => ({ id, after, state: 'open', ...(phase ? { phase } : {}) });
const ids = (list) => list.map((t) => t.id);

test('a chain reads as a tree: each step right under the step it waits on, roots in plan order', () => {
  const tasks = [task('T1'), task('T2'), task('T3', ['T1']), task('T4', ['T3']), task('T5', ['T2'])];
  const p = planParents(tasks);
  assert.deepEqual(ids(planTree(tasks, p)), ['T1', 'T3', 'T4', 'T2', 'T5']);
});

test('a wait on a later step or a step in another phase does not move it', () => {
  const tasks = [task('T1', ['T2']), task('T2'), task('T3', ['T1'], 'B'), task('T4', ['T9'])];
  const p = planParents(tasks);
  assert.equal(p.size, 0);
  assert.deepEqual(ids(planTree(tasks, p)), ['T1', 'T2', 'T3', 'T4']);
});

test('a step whose parent is hidden becomes a root in its place', () => {
  const tasks = [task('T1'), task('T2', ['T1']), task('T3')];
  const p = planParents(tasks);
  assert.deepEqual(ids(planTree([tasks[1], tasks[2]], p)), ['T2', 'T3']);
});

test('phases come in the order the plan lists them, unlisted ones last, empty ones left out', () => {
  assert.equal(planPhases({ tasks: [task('T1')] }), null);
  assert.equal(planPhases({ phases: [], tasks: [task('T1')] }), null);
  const tasks = [task('T1', [], 'Release'), task('T2', [], 'Build'), task('T3'), task('T4', [], 'Build')];
  const ph = planPhases({ phases: ['Build', { name: 'Release' }, 'Unused'], tasks });
  assert.deepEqual(ph.map((x) => [x.no, x.name, ids(x.steps)]), [[1, 'Build', ['T2', 'T4']], [2, 'Release', ['T1']], [0, 'No phase', ['T3']]]);
  assert.equal(ph[2].key, '');
});

test('a note line naming more than three things is a list', () => {
  assert.deepEqual(planNoteLines('Merged #1772.\nwrong price — A, B, C, D\nshort — A, B'), [
    { text: 'Merged #1772.' }, { label: 'wrong price', items: ['A', 'B', 'C', 'D'] }, { text: 'short — A, B' }]);
  const long = 'Records still needing a price correction after the release — A, B, C, D';
  assert.deepEqual(planNoteLines(long), [{ text: long }]);
});
