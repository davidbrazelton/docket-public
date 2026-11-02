// Tests for the session list's order switch (in index.html). Run with: npm test
// The page is one file with no modules, so the part under test is read out of it between its markers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.indexOf('// ---------- list order');
const end = page.indexOf('// end of list order');
assert.ok(start > 0 && end > start, 'the list order part of index.html has moved or lost its markers');
const { orderOf, byPlace, familyTier, familyAt, ORDER_CHOICES, TIER, takeHold, holding, startedAt, naturalSort, dropPlace } = new Function(page.slice(start, end) + '\nreturn { orderOf, byPlace, familyTier, familyAt, ORDER_CHOICES, TIER, takeHold, holding, startedAt, naturalSort, dropPlace };')();

const at = (s) => s.at;
const rows = () => [{ id: 'b', at: 200 }, { id: 'c', at: 300 }, { id: 'a', at: 100 }];
const ids = (list) => list.map((s) => s.id).join('');

test('a fresh profile sees oldest first', () => {
  assert.equal(orderOf(undefined), 'oldest');
  assert.equal(orderOf(null), 'oldest');
  assert.equal(ORDER_CHOICES[0][0], 'oldest');
});

test('a saved choice is kept, and anything unknown falls back to oldest first', () => {
  assert.equal(orderOf('newest'), 'newest');
  assert.equal(orderOf('oldest'), 'oldest');
  assert.equal(orderOf('sideways'), 'oldest');
});

test('oldest first puts the longest-waiting session at the top', () => {
  assert.equal(ids(rows().sort(byPlace('oldest', at))), 'abc');
});

test('newest first puts the latest session at the top', () => {
  assert.equal(ids(rows().sort(byPlace('newest', at))), 'cba');
});

test('a session that just finished joins the bottom in oldest first', () => {
  const list = [...rows(), { id: 'd', at: 400 }].sort(byPlace('oldest', at));
  assert.equal(list.at(-1).id, 'd');
});

// A row's tier: unread (or waiting on you) first, then working, then read.
const unread = (s) => s.unread ? TIER.waiting : s.working ? TIER.working : TIER.read;
const mixed = () => [{ id: 'a', at: 100 }, { id: 'B', at: 200, unread: true }, { id: 'c', at: 300 }, { id: 'D', at: 400, unread: true }];

test('oldest first puts unread sessions above read ones, oldest first inside each', () => {
  assert.equal(ids(mixed().sort(byPlace('oldest', at, unread))), 'BDac');
});

test('newest first puts unread sessions above read ones, newest first inside each', () => {
  assert.equal(ids(mixed().sort(byPlace('newest', at, unread))), 'DBca');
});

test('a session that is read drops to the read sessions, in its time place', () => {
  const list = mixed();
  list.find((s) => s.id === 'B').unread = false;
  assert.equal(ids(list.sort(byPlace('oldest', at, unread))), 'DaBc');
});

// Families: three read top sessions (a oldest, c newest), each with one child.
const family = () => {
  const tops = [{ id: 'b', at: 200 }, { id: 'a', at: 100 }, { id: 'c', at: 300 }];
  const kids = { a: [{ id: 'a1', at: 150 }], b: [{ id: 'b1', at: 250 }], c: [{ id: 'c1', at: 350 }] };
  return { tops, kids };
};
const famSort = (tops, kids, order = 'oldest') => ids(tops.sort(byPlace(order, (s) => familyAt(s, kids, unread, at), (s) => familyTier(s, kids, unread))));

test('a family with nothing unread keeps its time place', () => {
  const { tops, kids } = family();
  assert.equal(famSort(tops, kids), 'abc');
});

test('a child waiting on you lifts its family above families with nothing waiting', () => {
  const { tops, kids } = family();
  kids.c[0].unread = true;
  assert.equal(famSort(tops, kids), 'cab');
});

test('a grandchild waiting on you lifts the whole family too', () => {
  const { tops, kids } = family();
  kids.c1 = [{ id: 'c2', at: 360, unread: true }];
  assert.equal(famSort(tops, kids), 'cab');
});

test('lifted families keep the time order among themselves', () => {
  const { tops, kids } = family();
  kids.c[0].unread = true;
  tops.find((s) => s.id === 'b').unread = true;
  assert.equal(famSort(tops, kids), 'bca');
});

test('a family whose links loop back on themselves still sorts', () => {
  const { tops, kids } = family();
  kids.a1 = [tops.find((s) => s.id === 'a')];
  assert.equal(familyTier(tops.find((s) => s.id === 'a'), kids, unread), TIER.read);
  kids.a[0].unread = true;
  assert.equal(familyTier(tops.find((s) => s.id === 'a'), kids, unread), TIER.waiting);
});

test('a lifted family is placed by its waiting child, not its newer parent', () => {
  const { tops, kids } = family();
  tops.find((s) => s.id === 'a').unread = true; // a finished at 100
  kids.c[0].at = 50; kids.c[0].unread = true; // c's child has waited since 50
  assert.equal(famSort(tops, kids), 'cab');
});

test('a family with several waiting members is placed by the one that has waited longest', () => {
  const { tops, kids } = family();
  kids.c[0].unread = true; kids.c1 = [{ id: 'c2', at: 90, unread: true }];
  assert.equal(familyAt(tops.find((s) => s.id === 'c'), kids, unread, at), 90);
});

// The three tiers: waiting on you, then working, then read.
test('working sessions sit between unread and read ones, each part in time order', () => {
  const list = [{ id: 'a', at: 100 }, { id: 'W', at: 150, working: true }, { id: 'B', at: 200, unread: true }, { id: 'c', at: 300 }, { id: 'X', at: 50, working: true }];
  assert.equal(ids(list.sort(byPlace('oldest', at, unread))), 'BXWac');
  assert.equal(ids(list.sort(byPlace('newest', at, unread))), 'BWXca');
});

test('a working child lifts its family above families that are read', () => {
  const { tops, kids } = family();
  kids.c[0].working = true;
  assert.equal(famSort(tops, kids), 'cab');
});

test('a waiting child lifts its family above a working family', () => {
  const { tops, kids } = family();
  tops.find((s) => s.id === 'a').working = true; // a is working and oldest
  kids.c[0].unread = true; // c's child waits on you
  assert.equal(famSort(tops, kids), 'cab');
});

test('a family that is both waiting and working counts as waiting', () => {
  const { tops, kids } = family();
  tops.find((s) => s.id === 'c').working = true;
  kids.c[0].unread = true;
  assert.equal(familyTier(tops.find((s) => s.id === 'c'), kids, unread), TIER.waiting);
});

test('working families keep the time order among themselves, in both orders', () => {
  const { tops, kids } = family();
  kids.c[0].working = true; kids.b[0].working = true;
  assert.equal(famSort(tops, kids), 'bca');
  assert.equal(famSort(tops, kids, 'newest'), 'cba');
});

test('all three tiers together: waiting, then working, then read', () => {
  const tops = [{ id: 'a', at: 100 }, { id: 'b', at: 200 }, { id: 'c', at: 300 }, { id: 'd', at: 400 }, { id: 'e', at: 500 }];
  const kids = { a: [{ id: 'a1', at: 110 }], b: [{ id: 'b1', at: 210, working: true }], c: [{ id: 'c1', at: 310 }], d: [{ id: 'd1', at: 410, unread: true }], e: [{ id: 'e1', at: 510 }] };
  tops.find((s) => s.id === 'e').working = true;
  assert.equal(famSort(tops, kids), 'dbeac');
  assert.equal(famSort(tops, kids, 'newest'), 'debca');
});

test('a working family is placed by its longest-working member', () => {
  const { tops, kids } = family();
  kids.c[0].at = 50; kids.c[0].working = true; // c's child has worked since 50
  tops.find((s) => s.id === 'a').working = true; // a since 100
  assert.equal(famSort(tops, kids), 'cab');
});

// Closed or disconnected sessions sit below the open ones, even when they are older.
const open = (s) => s.unread ? TIER.waiting : s.working ? TIER.working : s.live ? TIER.read : TIER.ended;

test('an open read session sits above older closed sessions', () => {
  const list = [{ id: 'a', at: 100 }, { id: 'b', at: 200 }, { id: 'C', at: 300, live: true }, { id: 'd', at: 400 }];
  assert.equal(ids(list.sort(byPlace('oldest', at, open))), 'Cabd');
  assert.equal(ids(list.sort(byPlace('newest', at, open))), 'Cdba');
});

test('a closed session waiting on you still goes to the top', () => {
  const list = [{ id: 'a', at: 100 }, { id: 'B', at: 200, live: true }, { id: 'c', at: 300, unread: true }];
  assert.equal(ids(list.sort(byPlace('oldest', at, open))), 'cBa');
});

test('one open member keeps a closed family above the closed ones', () => {
  const { tops, kids } = family();
  kids.c[0].live = true;
  assert.equal(ids(tops.sort(byPlace('oldest', (s) => familyAt(s, kids, open, at), (s) => familyTier(s, kids, open)))), 'cab');
});

// The open session holds the place it had when it was opened, until another one is opened.
// Rows b (oldest), C (unread, the one opened), d: C sits at the top while it waits on you.
const opened = () => [{ id: 'b', at: 200 }, { id: 'C', at: 300, unread: true }, { id: 'd', at: 400 }];
const heldSort = (list, hold) => ids(list.sort(byPlace('oldest', holding(hold, 'at', at), holding(hold, 'tier', unread))));
const openIt = (list, id) => takeHold(list.find((s) => s.id === id), { tier: unread, at });

test('the open session does not move when it is read', () => {
  const list = opened(), hold = openIt(list, 'C');
  list.find((s) => s.id === 'C').unread = false;
  assert.equal(heldSort(list, hold), 'Cbd');
});

test('the open session does not move while it works on a reply', () => {
  const list = opened(), hold = openIt(list, 'C');
  Object.assign(list.find((s) => s.id === 'C'), { unread: false, working: true });
  assert.equal(heldSort(list, hold), 'Cbd');
});

test('the open session does not move when it finishes, even though its time changed', () => {
  const list = opened(), hold = openIt(list, 'C');
  Object.assign(list.find((s) => s.id === 'C'), { unread: true, working: false, at: 900 });
  list.push({ id: 'E', at: 500, unread: true }); // another reply landed meanwhile
  assert.equal(heldSort(list, hold), 'CEbd');
});

test('the open session settles into its place once another one is opened', () => {
  const list = opened(), first = openIt(list, 'C');
  list.find((s) => s.id === 'C').unread = false;
  assert.equal(heldSort(list, first), 'Cbd');
  assert.equal(heldSort(list, openIt(list, 'd')), 'bCd');
  assert.equal(heldSort(list, null), 'bCd'); // or when nothing is open
});

test('other rows keep sorting as they do now while one is held', () => {
  const list = opened(), hold = openIt(list, 'C');
  list.find((s) => s.id === 'd').unread = true;
  assert.equal(heldSort(list, hold), 'Cdb');
});

test('a held child keeps its family where it was, through reading and replying', () => {
  const { tops, kids } = family();
  kids.c[0].unread = true; // c's child waits on you, so c's family is at the top
  const hold = takeHold(kids.c[0], { tier: unread, at });
  const tier = holding(hold, 'tier', unread), heldAt = holding(hold, 'at', at);
  const sorted = () => ids(tops.sort(byPlace('oldest', (s) => familyAt(s, kids, tier, heldAt), (s) => familyTier(s, kids, tier))));
  kids.c[0].unread = false; // opened and read
  assert.equal(sorted(), 'cab');
  kids.c[0].working = true; // replied: working
  assert.equal(sorted(), 'cab');
});

test('a held top keeps its family where it was', () => {
  const { tops, kids } = family();
  const c = tops.find((s) => s.id === 'c');
  c.unread = true;
  const hold = takeHold(c, { tier: unread, at });
  c.unread = false;
  const tier = holding(hold, 'tier', unread), heldAt = holding(hold, 'at', at);
  assert.equal(ids(tops.sort(byPlace('oldest', (s) => familyAt(s, kids, tier, heldAt), (s) => familyTier(s, kids, tier)))), 'cab');
});

test('a hold with nothing noted yet reads the row as it is', () => {
  const list = opened();
  list.find((s) => s.id === 'C').unread = false;
  assert.equal(heldSort(list, { id: 'C' }), 'bCd');
  assert.equal(takeHold(null, { tier: unread }), null);
});

test('Natural is a choice of its own, and is kept when saved', () => {
  assert.ok(ORDER_CHOICES.some(([v]) => v === 'natural'));
  assert.equal(orderOf('natural'), 'natural');
});

test('Natural orders by when each session was started, oldest at the top, whatever its tier', () => {
  const list = [
    { id: 'c', createdAt: 300, tier: TIER.waiting },
    { id: 'a', createdAt: '1970-01-01T00:00:00.100Z', tier: TIER.ended },
    { id: 'b', createdAt: 200, tier: TIER.working },
  ];
  assert.equal(ids(list.sort(byPlace('natural', startedAt))), 'abc');
});

test('Natural: a row does not move when its tier or reply time changes', () => {
  const list = [{ id: 'a', createdAt: 100, at: 900 }, { id: 'b', createdAt: 200, at: 100 }];
  const before = ids(list.slice().sort(byPlace('natural', startedAt)));
  list[0].at = 50; list[1].tier = TIER.waiting;
  assert.equal(ids(list.slice().sort(byPlace('natural', startedAt))), before);
});

test('Natural: a saved session with no start time falls back to when it last spoke', () => {
  assert.equal(startedAt({ lastModified: 500 }), 500);
  assert.equal(startedAt({}), 0);
});

// Dragging rows into place in Natural order. Four sessions started a, b, c, d.
const started = () => [{ id: 'c', createdAt: 300 }, { id: 'a', createdAt: 100 }, { id: 'd', createdAt: 400 }, { id: 'b', createdAt: 200 }];

test('Natural with nothing dragged is start order', () => {
  assert.equal(ids(naturalSort(started(), [])), 'abcd');
  assert.equal(ids(naturalSort(started())), 'abcd');
});

test('dropping a row before another saves every shown row in its new place', () => {
  const saved = dropPlace([], ['a', 'b', 'c', 'd'], 'd', 'b');
  assert.deepEqual(saved, ['a', 'd', 'b', 'c']);
  assert.equal(ids(naturalSort(started(), saved)), 'adbc');
});

test('dropping on the bottom half of a row puts it after that row', () => {
  assert.deepEqual(dropPlace([], ['a', 'b', 'c', 'd'], 'a', 'd', true), ['b', 'c', 'd', 'a']);
  assert.deepEqual(dropPlace([], ['a', 'b', 'c', 'd'], 'a', 'b', true), ['b', 'a', 'c', 'd']);
});

test('a new session not yet dragged joins the bottom, where Natural puts it', () => {
  const saved = dropPlace([], ['a', 'b', 'c', 'd'], 'd', 'a');
  const list = [...started(), { id: 'e', createdAt: 500 }];
  assert.equal(ids(naturalSort(list, saved)), 'dabce');
});

test('a never-dragged session keeps its start-order place among dragged ones', () => {
  // Only b and d were shown when d was dropped before b (another part of the list); a and c keep their slots.
  const saved = dropPlace([], ['b', 'd'], 'd', 'b');
  assert.equal(ids(naturalSort(started(), saved)), 'adcb');
});

test('dragging in one part of the list leaves the saved order of another part alone', () => {
  let saved = dropPlace([], ['x', 'y', 'z'], 'z', 'x'); // another group: z x y
  saved = dropPlace(saved, ['a', 'b', 'c', 'd'], 'c', 'a');
  const other = [{ id: 'x', createdAt: 1 }, { id: 'y', createdAt: 2 }, { id: 'z', createdAt: 3 }];
  assert.equal(ids(naturalSort(other, saved)), 'zxy');
  assert.equal(ids(naturalSort(started(), saved)), 'cabd');
});

test('a family is placed by its top session, so children move with their parent', () => {
  const fams = started().map((top) => ({ top }));
  const saved = dropPlace([], ['a', 'b', 'c', 'd'], 'c', 'a');
  assert.equal(naturalSort(fams, saved, (f) => f.top).map((f) => f.top.id).join(''), 'cabd');
});

test('a saved order with sessions since deleted still sorts the ones left', () => {
  assert.equal(ids(naturalSort(started(), ['gone', 'd', 'old', 'a'])), 'dbca');
});
