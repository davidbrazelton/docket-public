// Tests for a full session list never undoing a newer status update (#647, in index.html). Run with: npm test
// The page is one file with no modules, so the part under test is read out of it between its markers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.indexOf('const livePushedAt');
const end = page.indexOf('// end of takeLive');
assert.ok(start > 0 && end > start, 'takeLive in index.html has moved or lost its marker');
const { takeLive } = new Function(page.slice(start, end) + '\nreturn { takeLive };')();

test('a turn that ended while the list was on its way stays idle', () => {
  // The list is asked for at 100 (a child was closed), the parent's turn ends at 150, the list lands at 200.
  const live = { p: { id: 'p', status: 'running' } }, pushedAt = { p: 50 };
  live.p = { id: 'p', status: 'idle' }; pushedAt.p = 150;
  takeLive(live, [{ id: 'p', status: 'running' }], pushedAt, 100);
  assert.equal(live.p.status, 'idle');
});

test('a list asked for after the last update replaces it', () => {
  const live = { p: { id: 'p', status: 'running' } }, pushedAt = { p: 50 };
  takeLive(live, [{ id: 'p', status: 'idle' }], pushedAt, 100);
  assert.equal(live.p.status, 'idle');
});

test('a session the page has no row for is taken from the list', () => {
  const live = {}, pushedAt = { q: 150 }; // pushed, then ended (row removed), then started again
  takeLive(live, [{ id: 'q', status: 'running' }], pushedAt, 100);
  assert.equal(live.q.status, 'running');
});
