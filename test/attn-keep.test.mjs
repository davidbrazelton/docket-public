// Tests for what keeps a read, idle session in the ✦ Needs attention list (#613): the window picked in 👁 (Last workday
// and the rest), pins, and families kept whole. Runs that part of index.html on its own. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = page.indexOf('// ---------- keeping sessions in needs attention');
const end = page.indexOf('// end of keeping sessions in needs attention');
assert.ok(start > 0 && end > start, 'the keeping part of index.html has moved or lost its markers');
const { ATTN_WINDOWS, attnWindowOf, lastWorkdayStart, keepSince, attnShown } = new Function(page.slice(start, end) + '\nreturn { ATTN_WINDOWS, attnWindowOf, lastWorkdayStart, keepSince, attnShown };')();

// November 2026, local time: Fri 6, Sat 7, Sun 8, Mon 9, Tue 10, Wed 11; Fri 23 Oct is two weeks before Mon 9.
const at = (day, h = 0, m = 0, month = 10) => +new Date(2026, month, day, h, m);
const show = (t) => new Date(t).toString().slice(0, 21);

test('Last workday starts at the start of the latest weekday before today with any touch (the table in #613)', () => {
  const table = [
    ['Mon, worked Fri', at(9, 8), [at(6, 15)], at(6)],
    ['Mon, worked Fri, Sat and Sun', at(9, 8), [at(6, 15), at(7, 11), at(8, 20)], at(6)],
    ['Tue, worked Mon', at(10, 9), [at(9, 17)], at(9)],
    ['Wed, worked Mon, off Tue', at(11, 9), [at(9, 17)], at(9)],
    ['Mon, worked Fri two weeks ago', at(9, 9), [at(23, 16, 0, 9)], at(23, 0, 0, 9)],
    ['Sat, worked Fri', at(7, 10), [at(6, 18)], at(6)],
  ];
  for (const [name, now, times, want] of table) assert.equal(show(lastWorkdayStart(now, times)), show(want), name);
});

test('touches today never make the last workday, and with none before today the window is today', () => {
  assert.equal(lastWorkdayStart(at(10, 15), [at(10, 9), at(9, 23, 59)]), at(9));
  assert.equal(lastWorkdayStart(at(10, 15), [at(10, 9)]), at(10));
  assert.equal(lastWorkdayStart(at(10, 15), []), at(10));
  assert.equal(lastWorkdayStart(at(9, 8), [at(7, 12), at(8, 12)]), at(9), 'a weekend alone is never the last workday');
});

test('each window choice', () => {
  const now = at(10, 15, 30);
  assert.equal(keepSince('12h', now, []), at(10, 3, 30));
  assert.equal(keepSince('yesterday', now, []), at(9));
  assert.equal(keepSince('workday', now, [at(6, 12)]), at(6));
  assert.equal(keepSince('7d', now, []), now - 7 * 864e5);
  assert.equal(keepSince('off', now, [at(9)]), null);
  assert.equal(keepSince('pins', now, [at(9)]), null);
  assert.equal(attnWindowOf(undefined), 'workday', 'Last workday at first');
  assert.equal(attnWindowOf('sideways'), 'workday');
  assert.deepEqual(ATTN_WINDOWS.map(([k]) => k), ['off', '12h', 'yesterday', 'workday', '7d', 'pins']);
});

const kindOf = (live) => (s) => live.includes(s.id) ? 'needs' : null;
const sorted = (set) => [...set].sort().join(',');

test('recent and pinned sessions are kept beside the live ones; archived ones never', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e', archived: true }];
  const touched = { b: 100, c: 50, e: 200 };
  const r = attnShown(rows, { kind: kindOf(['a']), since: 80, touched, pins: ['d', 'e'] });
  assert.equal(sorted(r.live), 'a');
  assert.equal(sorted(r.kept), 'b,d', 'b touched in the window, d pinned; c too old, e archived');
  assert.ok(r.has('b') && !r.has('c') && !r.has('e'));
  const pinsOnly = attnShown(rows, { kind: kindOf(['a']), since: null, touched, pins: ['d'] });
  assert.equal(sorted(pinsOnly.kept), 'd', 'Off and Pins: only pins');
});

test('a shown session brings its parents, so a family stays whole', () => {
  const rows = [{ id: 'top' }, { id: 'mid', parentId: 'top' }, { id: 'kid', parentId: 'mid' }, { id: 'other', parentId: 'top' }, { id: 'gone', archived: true }, { id: 'orphan', parentId: 'gone' }];
  const r = attnShown(rows, { kind: kindOf(['kid', 'orphan']), since: null });
  assert.equal(sorted(r.family), 'mid,top', 'the whole chain up');
  assert.ok(!r.has('other'), 'brothers and sisters are not brought in');
  assert.ok(!r.has('gone'), 'an archived parent is not brought back');
  const loop = attnShown([{ id: 'x', parentId: 'y' }, { id: 'y', parentId: 'x' }], { kind: kindOf(['x']), since: null });
  assert.equal(sorted(loop.family), 'y', 'a loop of parents ends');
  const searched = attnShown(rows, { kind: kindOf(['kid']), match: (s) => s.id !== 'kid', since: null });
  assert.equal(searched.live.size + searched.family.size, 0, 'the search picks what is shown; parents only follow');
});

test('the app records a touch when you send or start a session, and archiving takes the pin away', () => {
  assert.match(server, /touchSession\(target\.client, id\);\n\s+sendToSession\(target, b\);/, 'a message sent from the page');
  assert.match(server, /touchSession\(s\.client, s\.id\);\n\s+sendToSession\(s, b\);/, 'a new session');
  assert.match(server, /touchSession\(client\.id, child\.id\);/, 'a session started under another one');
  assert.match(server, /if \(archived\) setPinned\(clientId, id, false\);/);
  assert.match(server, /p === '\/api\/keep'/);
});

test('the ✦ count still counts only what needs you', () => {
  assert.ok(page.includes("const n = allSessionRows().filter((s) => ['needs', 'waiting', 'ending', 'cut'].includes(attnKind(s))).length;"));
});
