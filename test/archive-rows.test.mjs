// Tests for keeping the open session's row in the list while it is archived (in index.html). Run with: npm test
// The page is one file with no modules, so the part under test is read out of it between its markers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.indexOf('// ---------- archiving rows');
const end = page.indexOf('// end of archiving rows');
assert.ok(start > 0 && end > start, 'the archiving rows part of index.html has moved or lost its markers');
const { markArchived, endLive } = new Function(page.slice(start, end) + '\nreturn { markArchived, endLive };')();

// What the list shows for one id, the way renderList decides it: a live row always, a history row
// when it is not archived, or when it is archived but open (keptOpen).
const shown = (live, hist, id, selected) => {
  if (live[id]) return live[id].archived ? 'archived' : 'shown';
  const h = hist.find((r) => r.id === id);
  if (!h) return 'gone';
  if (!h.archived) return 'shown';
  return h.id === selected ? 'archived' : 'gone';
};

test('archiving the open running session never drops its row, even with no history row yet', () => {
  const live = { a: { id: 'a', title: 'A', live: true, status: 'idle' } };
  let hist = [{ id: 'b', archived: false }];
  const steps = [];
  markArchived(live, hist, ['a'], true); steps.push(shown(live, hist, 'a', 'a')); // the click
  hist = endLive(live, hist, 'a'); steps.push(shown(live, hist, 'a', 'a'));       // server: ended
  markArchived(live, hist, ['a'], true); steps.push(shown(live, hist, 'a', 'a')); // server: archived
  assert.deepEqual(steps, ['archived', 'archived', 'archived']);
  assert.equal(shown(live, hist, 'a', 'b'), 'gone', 'it leaves once another session is opened');
});

test('archiving the open idle session tags it at once and keeps it', () => {
  const live = {};
  const hist = [{ id: 'a', archived: false }];
  markArchived(live, hist, ['a'], true);
  assert.equal(shown(live, hist, 'a', 'a'), 'archived');
  assert.equal(shown(live, hist, 'a', null), 'gone');
});

test('archiving several at once marks every one of them', () => {
  const live = { a: { id: 'a' } };
  const hist = [{ id: 'b', archived: false }, { id: 'c', archived: false }];
  markArchived(live, hist, ['a', 'b', 'c'], true);
  assert.equal(live.a.archived, true);
  assert.deepEqual(hist.map((r) => r.archived), [true, true]);
});

test('a session that stops running keeps its history row as it was', () => {
  const live = { a: { id: 'a', live: true, status: 'running' } };
  const hist = [{ id: 'a', live: false, archived: false, title: 'kept' }];
  const out = endLive(live, hist, 'a');
  assert.equal(out, hist);
  assert.equal(live.a, undefined);
});

test('a session that stops running with no history row gets one that is not live', () => {
  const live = { a: { id: 'a', live: true, status: 'running', title: 'A' } };
  const out = endLive(live, [], 'a');
  assert.equal(out.length, 1);
  assert.equal(out[0].live, false);
  assert.equal(out[0].status, 'idle');
  assert.equal(out[0].title, 'A');
});
