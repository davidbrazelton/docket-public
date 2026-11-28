// The details panel's section order: a saved order is kept, a section a later version adds takes its
// default place, and a dragged section lands just before or after the one it is dropped on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const a = page.indexOf('// ---------- details sections'), b = page.indexOf('// end of details sections');
assert.ok(a > 0 && b > a, 'the details sections part of index.html has moved or lost its markers');
const { SECTION_ORDER, sectionOrder, moveSection, foldedSections } = new Function(page.slice(a, b) + '\nreturn { SECTION_ORDER, sectionOrder, moveSection, foldedSections };')();

test('with nothing saved the sections come in their default order', () => {
  assert.deepEqual(sectionOrder(undefined), SECTION_ORDER);
  assert.deepEqual(sectionOrder([]), SECTION_ORDER);
  assert.deepEqual(sectionOrder('junk'), SECTION_ORDER);
});

test('a saved order is kept, and a section it does not name goes after the one it follows by default', () => {
  assert.deepEqual(sectionOrder(['tasks', 'files', 'cost', 'prs', 'mcp', 'runs', 'plan']), ['tasks', 'files', 'cost', 'prs', 'mcp', 'runs', 'plan']);
  // saved before "plan" existed: it follows runs
  assert.deepEqual(sectionOrder(['tasks', 'files', 'cost', 'prs', 'mcp', 'runs']), ['tasks', 'files', 'cost', 'prs', 'mcp', 'runs', 'plan']);
  // saved before "runs" and "mcp" existed: runs follows cost, mcp follows tasks
  assert.deepEqual(sectionOrder(['tasks', 'prs', 'files', 'cost']), ['tasks', 'mcp', 'prs', 'files', 'cost', 'runs', 'plan']);
  // a new first section goes first
  assert.deepEqual(sectionOrder(['b', 'a'], ['new', 'a', 'b']), ['new', 'b', 'a']);
});

test('names no longer used and repeats are dropped from a saved order', () => {
  assert.deepEqual(sectionOrder(['gone', 'mcp', 'mcp', 'cost']), ['mcp', 'cost', 'runs', 'plan', 'files', 'prs', 'tasks']);
});

test('a dragged section lands before or after the one it is dropped on', () => {
  const o = ['cost', 'runs', 'files', 'prs', 'tasks', 'mcp'];
  assert.deepEqual(moveSection(o, 'mcp', 'cost', false), ['mcp', 'cost', 'runs', 'files', 'prs', 'tasks']);
  assert.deepEqual(moveSection(o, 'cost', 'mcp', true), ['runs', 'files', 'prs', 'tasks', 'mcp', 'cost']);
  assert.deepEqual(moveSection(o, 'files', 'tasks', false), ['cost', 'runs', 'prs', 'files', 'tasks', 'mcp']);
  assert.deepEqual(moveSection(o, 'files', 'files', true), o);
  assert.deepEqual(moveSection(o, 'nope', 'files', true), o);
});

test('a Tasks folded before it became two sections folds both, and other folds are kept', () => {
  assert.deepEqual(foldedSections({ tasks: true, cost: true }), { cost: true, tasksRunning: true, tasksFinished: true });
  assert.deepEqual(foldedSections({ tasksFinished: true }), { tasksFinished: true });
  assert.deepEqual(foldedSections(undefined), {});
  assert.deepEqual(foldedSections('junk'), {});
});
