// Tests for a coordinator's family (#717): family.mjs, which list_sessions and close_session use, and the session
// list's nesting in index.html (nestParent), which must place every session under the same one. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openParent, openFamily, closedNote } from '../family.mjs';
import { closeRefusal } from '../reports.mjs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.indexOf('// ---------- nesting rows'), end = page.indexOf('// end of nesting rows');
assert.ok(start > 0 && end > start, 'the nesting rows part of index.html has moved or lost its markers');
const { nestParent } = new Function(page.slice(start, end) + '\nreturn { nestParent };')();

// coord > kid (archived) > grandkid; coord > moved (set_parent); other > stray; gone > orphan (gone archived, no parent)
const parents = { kid: 'coord', grandkid: 'kid', moved: 'coord', stray: 'other', orphan: 'gone', deep: 'grandkid' };
const archived = new Set(['kid', 'gone']);
const up = (id) => parents[id] || null, open = (id) => !archived.has(id);
const ids = ['coord', 'kid', 'grandkid', 'moved', 'other', 'stray', 'gone', 'orphan', 'deep'];

test('openParent: the parent, or past archived ones to the nearest open session above', () => {
  assert.equal(openParent('moved', up, open), 'coord');
  assert.equal(openParent('grandkid', up, open), 'coord', 'its own parent kid is archived');
  assert.equal(openParent('deep', up, open), 'grandkid');
  assert.equal(openParent('orphan', up, open), null, 'nothing open above it');
  assert.equal(openParent('coord', up, open), null);
  assert.equal(openParent('a', (x) => (x === 'a' ? 'b' : 'a'), () => false), null, 'a loop of archived parents ends');
});

test('openFamily: every open session below, grandchildren too, never an archived one', () => {
  assert.deepEqual(openFamily('coord', ids, up, open), [
    { id: 'grandkid', parent: 'coord', depth: 1 }, { id: 'deep', parent: 'grandkid', depth: 2 }, { id: 'moved', parent: 'coord', depth: 1 }]);
  assert.deepEqual(openFamily('other', ids, up, open), [{ id: 'stray', parent: 'other', depth: 1 }]);
  assert.deepEqual(openFamily('moved', ids, up, open), []);
});

test('nestParent in the session list agrees with openParent', () => {
  const rows = ids.map((id) => ({ id, parentId: parents[id] || null, archived: archived.has(id) }));
  const byId = new Map(rows.map((r) => [r.id, r])), shown = new Map(rows.filter((r) => !r.archived).map((r) => [r.id, r]));
  for (const r of rows.filter((x) => !x.archived)) assert.equal(nestParent(r, shown, byId), openParent(r.id, up, open), r.id);
  // In the archive, archived sessions keep their own parent.
  const arch = new Map(rows.filter((r) => r.archived).map((r) => [r.id, r]));
  assert.equal(nestParent({ id: 'x', parentId: 'kid', archived: true }, arch, byId), 'kid');
  // A parent not on view (another group's, or past the list's limit) puts it at the top, as before.
  assert.equal(nestParent(byId.get('moved'), new Map([['moved', 1]]), byId), null);
});

test('closedNote: only with nothing left open is it the last open session', () => {
  assert.match(closedNote([]), /^ That was your last open session:/);
  const done = closedNote([{ id: 'm', title: 'Moved', state: 'done' }]);
  assert.doesNotMatch(done, /last open session/);
  assert.match(done, /None of your sessions is still working or waiting on the user, but 1 under you is still open: "Moved" \(id m, done\)/);
  assert.match(done, /mark_turn "done"/);
  const busy = closedNote([{ id: 'w', title: 'W', state: 'working' }, { id: 'm', title: 'M', state: 'done' }]);
  assert.match(busy, /^ Still open under you: "W" \(id w, working\); "M" \(id m, done\)\.$/);
});

test('closeRefusal: the nearest open session above may close it, and a running session is never "already archived"', () => {
  const base = { callerId: 'coord', reply: 'Done.', busy: false };
  assert.match(closeRefusal({ ...base, rec: { reportsTo: 'kid' } }), /not a session you started/);
  assert.equal(closeRefusal({ ...base, rec: { reportsTo: 'kid' }, under: true }), '', 'its parent kid is archived');
  assert.equal(closeRefusal({ ...base, rec: { reportsTo: 'coord', archived: true }, live: { status: 'idle' } }), '', 'sent work after closing, running again');
  assert.match(closeRefusal({ ...base, rec: { reportsTo: 'coord', archived: true }, live: { status: 'ended' } }), /already archived/);
  assert.match(closeRefusal({ ...base, rec: { reportsTo: 'coord', archived: true } }), /already archived/);
});
