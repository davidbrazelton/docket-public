// Tests for the session list's one row per schedule (in index.html). Run with: npm test
// The page is one file with no modules, so the part under test is read out of it between its markers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.indexOf('// ---------- one row per schedule');
const end = page.indexOf('// end of one row per schedule');
assert.ok(start > 0 && end > start, 'the one-row-per-schedule part of index.html has moved or lost its markers');
const { scheduleRows, runTime } = new Function('S', page.slice(start, end) + '\nreturn { scheduleRows, runTime };')({});

const run = (id, day, more = {}) => ({ id, scheduleId: 'retire', title: `Retire old URLs check`, runAt: `2026-10-${day}T13:00:00.000Z`, ...more });
const unread = (s) => !!s.unread && !s.archived;

test('all runs of a schedule collapse into one row, the newest run', () => {
  const rows = [run('a', 22), run('c', 28), run('b', 25), { id: 'x', title: 'Other work' }];
  const { hidden, info } = scheduleRows(rows, rows);
  assert.deepEqual([...hidden].sort(), ['a', 'b']);
  assert.deepEqual([...info.keys()], ['c']);
  assert.deepEqual(info.get('c').runs, ['c', 'b', 'a']);
});

test('each schedule gets its own row', () => {
  const rows = [run('a', 22), run('b', 25), { ...run('m', 1), scheduleId: 'monthly' }];
  const { hidden, info } = scheduleRows(rows, rows);
  assert.deepEqual([...hidden], ['a']);
  assert.deepEqual([...info.keys()].sort(), ['b', 'm']);
});

test('the row carries the schedule name, not the newest run\'s own title', () => {
  const rows = [run('a', 22), run('b', 25, { title: 'Renamed by Claude inside the run' })];
  const { info } = scheduleRows(rows, rows, { titles: { retire: 'Old links check' } });
  assert.equal(info.get('b').title, 'Old links check');
  // a schedule that was deleted falls back to the run's own title
  assert.equal(scheduleRows(rows, rows).info.get('b').title, 'Renamed by Claude inside the run');
});

test('unread runs are counted across the whole schedule, archived ones are not', () => {
  const all = [run('a', 22, { unread: true, archived: true }), run('b', 25, { unread: true }), run('c', 28, { unread: true })];
  const shown = all.filter((s) => !s.archived);
  const { info } = scheduleRows(shown, all, { unread });
  assert.equal(info.get('c').unread, 2);
  assert.equal(info.get('c').topUnread, true);
});

test('an archived schedule comes back as the new run once it fires', () => {
  const all = [run('a', 22, { archived: true }), run('b', 25, { archived: true }), run('c', 28, { unread: true })];
  const shown = all.filter((s) => !s.archived);
  const { hidden, info } = scheduleRows(shown, all, { unread });
  assert.equal(hidden.size, 0);
  assert.deepEqual([...info.keys()], ['c']);
  assert.equal(info.get('c').unread, 1);
});

test('a run with no run time falls back to when the session was made', () => {
  const rows = [{ id: 'old', scheduleId: 's', createdAt: Date.parse('2026-10-20') }, { id: 'new', scheduleId: 's', runAt: '2026-10-21T00:00:00Z' }];
  assert.equal(runTime(rows[0]), Date.parse('2026-10-20'));
  assert.deepEqual([...scheduleRows(rows, rows).info.keys()], ['new']);
});
