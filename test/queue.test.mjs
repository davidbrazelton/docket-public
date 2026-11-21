// Tests for queue.mjs, the rules of queue mode (#1064). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUEUE_DEFAULTS, queueSettings, queueLimit, holdsSlot, startsTurn, itemRank, queueOrder, queuePositions, queueGate, nextToStart, queueItem, queuedNote } from '../queue.mjs';

const sess = (id, status, more = {}) => ({ id, client: 'acme', status, ...more });
const live = (...list) => new Map(list.map((s) => [s.id, s]));
const item = (id, at, more = {}) => ({ id, client: 'acme', at, person: false, ...more });

test('off by default, 1 on battery and 6 plugged in; limits are whole numbers from 1 to 50', () => {
  assert.deepEqual(queueSettings(undefined), QUEUE_DEFAULTS);
  assert.deepEqual(QUEUE_DEFAULTS, { on: false, battery: 1, plugged: 6, autoBattery: false });
  assert.deepEqual(queueSettings({ on: 1, battery: '3', plugged: 0 }), { on: true, battery: 3, plugged: 6, autoBattery: false });
  assert.deepEqual(queueSettings({ on: true, battery: 2.6, plugged: 999, autoBattery: 1 }), { on: true, battery: 3, plugged: 50, autoBattery: true });
  assert.deepEqual(queueSettings({ battery: 'x', plugged: -1 }), QUEUE_DEFAULTS);
});

test('the limit follows the battery, is endless while off, and a load cap lowers it', () => {
  const cfg = { on: true, battery: 2, plugged: 6 };
  assert.equal(queueLimit({ ...cfg, on: false }, { onBattery: true }), Infinity);
  assert.equal(queueLimit(cfg, { onBattery: true }), 2);
  assert.equal(queueLimit(cfg, { onBattery: false }), 6);
  assert.equal(queueLimit(cfg, { onBattery: null }), 6, 'not known yet counts as plugged in');
  assert.equal(queueLimit(cfg, { onBattery: false, cap: 3 }), 3);
  assert.equal(queueLimit(cfg, { onBattery: true, cap: 4 }), 2, 'a cap never raises the limit');
  assert.equal(queueLimit(cfg, { onBattery: false, cap: 0 }), 6, 'a cap of 0 means none');
});

test('only a turn really working holds a slot', () => {
  assert.equal(holdsSlot(sess('a', 'running')), true);
  assert.equal(holdsSlot(sess('a', 'requires_action')), false, 'a permission prompt or a question form waits on the person');
  assert.equal(holdsSlot(sess('a', 'running', { inWait: 1 })), false, 'inside a wait_until call');
  assert.equal(holdsSlot(sess('a', 'idle', { heldTurn: true })), false, 'background commands after the turn ended');
  assert.equal(holdsSlot(sess('a', 'idle')), false, 'between turns, waiting on its children');
  assert.equal(holdsSlot(sess('a', 'starting')), false, 'a process starting with no message yet');
  assert.equal(holdsSlot(sess('a', 'ended')), false);
});

test('a message starts a turn unless the session is already in one', () => {
  assert.equal(startsTurn(sess('a', 'idle')), true);
  assert.equal(startsTurn(sess('a', 'starting')), true);
  assert.equal(startsTurn(sess('a', 'ended')), true);
  assert.equal(startsTurn(sess('a', 'idle', { resting: true })), true);
  assert.equal(startsTurn(sess('a', 'running')), false);
  assert.equal(startsTurn(sess('a', 'requires_action')), false);
});

test('the gate holds only a turn about to start, and only while queue mode is on', () => {
  assert.equal(queueGate({ limit: Infinity, session: sess('a', 'idle') }), 'send');
  assert.equal(queueGate({ limit: 2, session: sess('a', 'running') }), 'send', 'joins the turn it has');
  assert.equal(queueGate({ limit: 2, session: sess('a', 'requires_action') }), 'send');
  assert.equal(queueGate({ limit: 2, session: sess('a', 'idle') }), 'queue');
  assert.equal(queueGate({ limit: Infinity, session: sess('a', 'idle'), waiting: true }), 'queue', 'behind its own messages still waiting');
});

test('priority: typed or open first, then always run, then first in first out', () => {
  const isOpen = (id) => id === 'open', isAlways = (id) => id === 'vip';
  assert.equal(itemRank(item('x', 1, { person: true }), { isOpen, isAlways }), 0);
  assert.equal(itemRank(item('open', 1), { isOpen, isAlways }), 0);
  assert.equal(itemRank(item('vip', 1), { isOpen, isAlways }), 1);
  assert.equal(itemRank(item('x', 1), { isOpen, isAlways }), 2);
  const items = [item('old', 1), item('vip', 5), item('newer', 3), item('typed', 9, { person: true }), item('open', 8)];
  assert.deepEqual(queueOrder(items, { isOpen, isAlways }).map((x) => x.id), ['open', 'typed', 'vip', 'old', 'newer']);
  assert.deepEqual([...queuePositions(items, { isOpen, isAlways })], [['open', 1], ['typed', 2], ['vip', 3], ['old', 4], ['newer', 5]]);
});

test('a session with several messages waiting is in line once, at its best rank and earliest time', () => {
  const items = [item('a', 1), item('b', 2), item('b', 7, { person: true }), item('a', 9)];
  const order = queueOrder(items);
  assert.deepEqual(order.map((x) => [x.id, x.rank, x.at]), [['b', 0, 2], ['a', 2, 1]]);
});

test('starts as many as there are free slots, in priority order', () => {
  const sessions = live(sess('w1', 'running'), sess('q1', 'idle'), sess('q2', 'idle'), sess('q3', 'idle'));
  const items = [item('q1', 1), item('q2', 2), item('q3', 3)];
  assert.deepEqual(nextToStart(items, { limit: 2, sessions }), ['q1']);
  assert.deepEqual(nextToStart(items, { limit: 1, sessions }), []);
  assert.deepEqual(nextToStart(items, { limit: 6, sessions }), ['q1', 'q2', 'q3'], 'plugged back in: the higher limit starts more');
  assert.deepEqual(nextToStart(items, { limit: Infinity, sessions }), ['q1', 'q2', 'q3'], 'turned off: everything goes');
});

test('nothing starts while paused (Pause all), and a resting queued session is started again when its turn comes', () => {
  const sessions = live(sess('q1', 'idle', { resting: true }));
  assert.deepEqual(nextToStart([item('q1', 1)], { limit: 2, sessions, paused: true }), []);
  assert.deepEqual(nextToStart([item('q1', 1)], { limit: 2, sessions }), ['q1']);
  assert.deepEqual(nextToStart([item('gone', 1)], { limit: 1, sessions: new Map() }), ['gone'], 'not live: brought back to take its message');
});

test('a queued session that started a turn by itself takes its messages at once, without a slot', () => {
  const sessions = live(sess('w1', 'running'), sess('q1', 'running'), sess('q2', 'idle'));
  assert.deepEqual(nextToStart([item('q1', 1), item('q2', 2)], { limit: 2, sessions }), ['q1'], 'q1 already counts as working, so q2 waits');
});

test('no deadlock: a parent and the child it waits on never block each other', () => {
  // Limit 1. The parent is working and starts a child: the child's brief waits.
  const parent = sess('parent', 'running'), child = sess('child', 'starting');
  const sessions = live(parent, child), items = [item('child', 1)];
  assert.equal(queueGate({ limit: 1, session: child }), 'queue');
  assert.deepEqual(nextToStart(items, { limit: 1, sessions }), []);
  // The parent waits on its child with wait_until: it frees its slot, so the child starts.
  parent.inWait = 1;
  assert.deepEqual(nextToStart(items, { limit: 1, sessions }), ['child']);
  // Or the parent ends its turn to wait for the child's report.
  parent.inWait = 0; parent.status = 'idle';
  assert.deepEqual(nextToStart(items, { limit: 1, sessions }), ['child']);
  // Or the parent stops on a permission prompt or a question form for the person.
  parent.status = 'requires_action';
  assert.deepEqual(nextToStart(items, { limit: 1, sessions }), ['child']);
  // The child works, then reports back: its turn has ended, so the parent's report starts.
  parent.status = 'idle'; child.status = 'running';
  assert.deepEqual(nextToStart([item('parent', 2, { report: true })], { limit: 1, sessions }), []);
  child.status = 'idle';
  assert.deepEqual(nextToStart([item('parent', 2, { report: true })], { limit: 1, sessions }), ['parent']);
  // A child waiting on the person mid-turn holds nothing either, so its parent can take a report from a sibling.
  child.status = 'requires_action';
  assert.deepEqual(nextToStart([item('parent', 3)], { limit: 1, sessions }), ['parent']);
});

test('an item keeps what sendToSession was given; typed and pressed count as the person', () => {
  const s = { id: 'a', client: 'acme' };
  assert.equal(queueItem(s, { text: 'hi' }, 5).person, true);
  assert.equal(queueItem(s, { text: '', system: true, byPerson: true }).person, true);
  assert.equal(queueItem(s, { text: 'report', system: true, report: true }).person, false);
  assert.equal(queueItem(s, { text: 'brief', from: 'brief' }).person, false);
  assert.equal(queueItem(s, { text: 'note', from: 'session' }).person, false);
  const it = queueItem(s, { text: 't', context: 'c', news: 'n', reported: ['k'] }, 7);
  assert.deepEqual({ id: it.id, at: it.at, context: it.context, news: it.news, reported: it.reported }, { id: 'a', at: 7, context: 'c', news: 'n', reported: ['k'] });
});

test('the chat note says why it waits and where to change it', () => {
  assert.match(queuedNote({ working: 2, limit: 2, onBattery: true }), /2 sessions working.*on battery \(2\)/);
  assert.match(queuedNote({ working: 1, limit: 1, onBattery: false }), /1 session working.*plugged in \(1\).*Queue mode/);
});
