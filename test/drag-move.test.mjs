// Tests for dragging a session in the list to another group or under another session (index.html and
// drag-move.mjs). Run with: npm test
// The page is one file with no modules, so the part under test is read out of it between its markers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { familyBelow as serverFamilyBelow } from '../drag-move.mjs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.indexOf('// ---------- drag moves');
const end = page.indexOf('// end of drag moves');
assert.ok(start > 0 && end > start, 'the drag moves part of index.html has moved or lost its markers');
const { familyBelow, dropMove } = new Function(page.slice(start, end) + '\nreturn { familyBelow, dropMove };')();

// a (group g1) has children b and c; b has child d. e is alone in g2; f is top level with no group.
const rows = () => [
  { id: 'a', parentId: null, groupId: 'g1' },
  { id: 'b', parentId: 'a', groupId: 'g1' },
  { id: 'c', parentId: 'a', groupId: 'g1' },
  { id: 'd', parentId: 'b', groupId: 'g1' },
  { id: 'e', parentId: null, groupId: 'g2' },
  { id: 'f', parentId: null, groupId: null },
];
const sorted = (x) => [...x].sort();

test('a family is every session under it, all the way down, on the page and in the app', () => {
  for (const fb of [familyBelow, serverFamilyBelow]) {
    assert.deepEqual(sorted(fb(rows(), 'a')), ['b', 'c', 'd']);
    assert.deepEqual(fb(rows(), 'b'), ['d']);
    assert.deepEqual(fb(rows(), 'e'), []);
  }
});

test('a loop in the parent links does not go round forever', () => {
  const loop = [{ id: 'x', parentId: 'y' }, { id: 'y', parentId: 'x' }];
  for (const fb of [familyBelow, serverFamilyBelow]) assert.deepEqual(fb(loop, 'x'), ['y']);
});

test('dropping on a group heading moves it to the top level there, family and all', () => {
  assert.deepEqual(dropMove(rows(), 'a', { gid: 'g2' }), { parentId: null, groupId: 'g2', below: ['b', 'c', 'd'] });
  assert.deepEqual(dropMove(rows(), 'e', { gid: '' }), { parentId: null, groupId: '', below: [] });
});

test('dropping a child on its own group heading takes it to the top level', () => {
  assert.deepEqual(dropMove(rows(), 'b', { gid: 'g1' }), { parentId: null, groupId: 'g1', below: ['d'] });
});

test('dropping on another session puts it under that session, in that session\'s group', () => {
  assert.deepEqual(dropMove(rows(), 'e', { id: 'c' }), { parentId: 'c', groupId: 'g1', below: [] });
  assert.deepEqual(dropMove(rows(), 'a', { id: 'f' }), { parentId: 'f', groupId: '', below: ['b', 'c', 'd'] });
  assert.deepEqual(dropMove(rows(), 'd', { id: 'c' }), { parentId: 'c', groupId: 'g1', below: [] });
});

test('drops that make no sense are refused', () => {
  assert.equal(dropMove(rows(), 'a', { id: 'a' }), null, 'onto itself');
  assert.equal(dropMove(rows(), 'a', { id: 'b' }), null, 'onto its child');
  assert.equal(dropMove(rows(), 'a', { id: 'd' }), null, 'onto its grandchild');
  assert.equal(dropMove(rows(), 'b', { id: 'a' }), null, 'onto the parent it already has');
  assert.equal(dropMove(rows(), 'a', { gid: 'g1' }), null, 'onto its own group when already at the top');
  assert.equal(dropMove(rows(), 'f', { gid: '' }), null, 'onto No group when already there');
  assert.equal(dropMove(rows(), 'zz', { gid: 'g1' }), null, 'a session the page does not know');
  assert.equal(dropMove(rows(), 'a', { id: 'zz' }), null, 'onto a session the page does not know');
});
