// Tests for talk mode's speech queue (#1161): order, waiting for the piece being said to end, replacing by session,
// dropping stale items, folding, and Stop emptying it. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newQueue, add, next, clear, skip, waiting, foldLine, lock, drop } from '../talk-queue.mjs';

// Says everything left, a piece at a time, as the voice would: [lead + text, with ♪ for the tone].
const drain = (q, opts) => { const out = []; for (let n; (n = next(q, opts));) out.push(`${n.tone ? '♪ ' : ''}${n.lead ? n.lead + ' ' : ''}${n.text}`); return out; };

test('items play in turn, each piece to its end; nothing before the first after quiet', () => {
  const q = newQueue();
  add(q, { kind: 'news', parts: ['Relay is done.'], session: 'a' });
  add(q, { kind: 'news', parts: ['Billing is done.'], session: 'b' });
  assert.deepEqual(drain(q), ['Relay is done.', '♪ Also, Billing is done.']);
  assert.equal(q.talking, false);
  add(q, { kind: 'news', parts: ['Later is done.'], session: 'c' });
  assert.deepEqual(drain(q), ['Later is done.']); // quiet again: no tone, no lead-in
});

test('news waits for the whole item being read', () => {
  const q = newQueue();
  add(q, { kind: 'news', parts: ['Reply one.', 'Reply two.', 'Reply three.'], session: 'open' }, { openId: 'open' });
  assert.equal(next(q, { openId: 'open' }).text, 'Reply one.');
  add(q, { kind: 'news', parts: ['Relay is done.'], session: 'a' });
  add(q, { kind: 'news', parts: ['Billing is done.'], session: 'b' });
  assert.deepEqual(drain(q, { openId: 'open' }), ['Reply two.', 'Reply three.', '♪ Also, Relay is done.', '♪ Also, Billing is done.']);
});

test('a need cuts in at the end of the piece being said, and the item it cut resumes from its next piece', () => {
  const q = newQueue();
  add(q, { kind: 'news', parts: ['Reply one.', 'Reply two.', 'Reply three.'], session: 'open' }, { openId: 'open' });
  assert.equal(next(q, { openId: 'open' }).text, 'Reply one.');
  add(q, { kind: 'need', parts: ['Relay has a question.'], session: 'a' });
  add(q, { kind: 'news', parts: ['Billing is done.'], session: 'b' });
  assert.deepEqual(drain(q, { openId: 'open' }), ['♪ Next, Relay has a question.', '♪ Reply two.', 'Reply three.', '♪ Also, Billing is done.']);
});

test('a need after the item ends has no "Next,"; needs go before news already waiting', () => {
  const q = newQueue();
  add(q, { kind: 'news', parts: ['Relay is done.'], session: 'a' });
  next(q);
  add(q, { kind: 'news', parts: ['Billing is done.'], session: 'b' });
  add(q, { kind: 'need', parts: ['Docs wants to merge 12.'], session: 'c' });
  assert.deepEqual(drain(q), ['♪ Docs wants to merge 12.', '♪ Also, Billing is done.']);
});

test('what the user asked for replaces what was being read on its own, after the piece being said', () => {
  const q = newQueue();
  add(q, { kind: 'news', parts: ['Reply one.', 'Reply two.'], session: 'open' }, { openId: 'open' });
  next(q, { openId: 'open' });
  add(q, { kind: 'asked', parts: ['Cancelled.'] });
  add(q, { kind: 'news', parts: ['Billing is done.'], session: 'b' });
  assert.deepEqual(drain(q, { openId: 'open' }), ['♪ Cancelled.', '♪ Also, Billing is done.']); // the reply's rest is gone
  // a need being read gives way too; asked items keep their order and never cut each other
  add(q, { kind: 'need', parts: ['Relay has a question.', 'It asks which.'], session: 'a' });
  next(q);
  add(q, { kind: 'asked', parts: ['First.', 'Still first.'] });
  add(q, { kind: 'asked', parts: ['Second.'] });
  assert.deepEqual(drain(q), ['♪ First.', 'Still first.', '♪ Second.']);
});

test('a newer line from the same session replaces its older one not yet begun, never one being read or asked for', () => {
  const q = newQueue();
  add(q, { kind: 'news', parts: ['Relay is working.', 'More of it.'], session: 'a' });
  next(q);
  add(q, { kind: 'news', parts: ['Relay is done.'], session: 'a' }); // the one being read keeps going
  add(q, { kind: 'need', parts: ['Billing has a question.'], session: 'b' });
  add(q, { kind: 'asked', parts: ['Billing, read back.'], session: 'b' });
  add(q, { kind: 'news', parts: ['Billing is done.'], session: 'b' }); // replaces the question, not the asked item
  assert.equal(waiting(q), 3);
  assert.deepEqual(drain(q), ['♪ Billing, read back.', '♪ Also, Relay is done.', '♪ Also, Billing is done.']);
});

test('items about a session opened since they were queued are dropped, unless asked for', () => {
  const q = newQueue();
  add(q, { kind: 'news', parts: ['Relay is done.'], session: 'a' }, { openId: 'x' });
  add(q, { kind: 'need', parts: ['Relay has a question.'], session: 'a' }, { openId: 'x' });
  add(q, { kind: 'asked', parts: ['Relay.'], session: 'a' }, { openId: 'x' });
  add(q, { kind: 'news', parts: ['The open reply.'], session: 'a' }, { openId: 'a' }); // queued while open: kept
  assert.equal(waiting(q, { openId: 'a' }), 2);
  assert.deepEqual(drain(q, { openId: 'a' }), ['Relay.', '♪ Also, The open reply.']);
});

test('more than two news items waiting fold into one line that keeps them for "more"', () => {
  const q = newQueue();
  add(q, { kind: 'asked', parts: ['Reading the reply.'] });
  assert.equal(next(q).text, 'Reading the reply.');
  for (const s of ['a', 'b', 'c']) add(q, { kind: 'news', parts: [`${s} is done.`], session: s });
  add(q, { kind: 'need', parts: ['d has a question.'], session: 'd' });
  assert.equal(waiting(q), 4);
  const n1 = next(q), n2 = next(q);
  assert.equal(n1.text, 'd has a question.');
  assert.deepEqual([n2.text, n2.tone, n2.lead], [foldLine(3), true, '']);
  assert.deepEqual(n2.item.folded.map((x) => x.parts[0]), ['a is done.', 'b is done.', 'c is done.']);
  assert.equal(foldLine(3), 'Three more updates. Say more to hear them.');
  assert.equal(next(q), null);
  // two waiting is not folded
  add(q, { kind: 'asked', parts: ['x'] }); next(q);
  add(q, { kind: 'news', parts: ['a.'], session: 'a' }); add(q, { kind: 'news', parts: ['b.'], session: 'b' });
  assert.deepEqual(drain(q), ['♪ Also, a.', '♪ Also, b.']);
});

test('Stop empties the queue; skip moves on to the next item at once', () => {
  const q = newQueue();
  add(q, { kind: 'news', parts: ['One.', 'Two.'], session: 'a' });
  add(q, { kind: 'news', parts: ['Other.'], session: 'b' });
  next(q);
  skip(q);
  assert.deepEqual(drain(q), ['♪ Also, Other.']);
  add(q, { kind: 'news', parts: ['One.', 'Two.'], session: 'a' });
  add(q, { kind: 'need', parts: ['Q.'], session: 'b' });
  next(q);
  clear(q);
  assert.equal(waiting(q), 0);
  assert.equal(next(q), null);
  add(q, { kind: 'news', parts: ['After stop.'], session: 'c' });
  assert.deepEqual(drain(q), ['After stop.']); // quiet after Stop: no tone
});

test('empty items are not queued', () => {
  const q = newQueue();
  assert.equal(add(q, { kind: 'news', parts: ['', null] }), null);
  assert.equal(next(q), null);
});

test('the screen locked (#1173): the reading stops, the queue empties, lines that come in are dropped, and after unlock only new ones speak', () => {
  const q = newQueue();
  add(q, { kind: 'news', parts: ['One.', 'Two.'], session: 'a' });
  add(q, { kind: 'need', parts: ['Q.'], session: 'b' });
  assert.equal(next(q).text, 'Q.'); // being said when the screen locks, the news after it
  lock(q, true);
  assert.equal(waiting(q), 0);
  assert.equal(next(q), null);
  assert.equal(add(q, { kind: 'news', parts: ['While locked.'], session: 'c' }), null, 'dropped, not held');
  assert.equal(add(q, { kind: 'asked', parts: ['Asked while locked.'] }), null);
  lock(q, false);
  assert.equal(next(q), null, 'nothing is said after unlock');
  add(q, { kind: 'news', parts: ['After unlock.'], session: 'd' });
  assert.deepEqual(drain(q), ['After unlock.']); // quiet before: no tone, no lead-in
});

test("the user acting on a session drops its lines at once, and a line being said ends after its sentence (#1177)", () => {
  const q = newQueue();
  add(q, { kind: 'need', parts: ['Relay wants to merge #12.'], session: 'a', from: [{ id: 'a' }] });
  add(q, { kind: 'news', parts: ['Two sessions are done.'], session: null, from: [{ id: 'a' }, { id: 'b' }] });
  add(q, { kind: 'news', parts: ['Billing is done.'], session: 'c', from: [{ id: 'c' }] });
  add(q, { kind: 'asked', parts: ['Opened Relay.'], session: 'a' });
  drop(q, 'a');
  assert.equal(q.waiting.length, 3, 'its own line goes; what the user asked for stays');
  const two = q.waiting.find((w) => w.from?.length === 1 && w.session === null);
  assert.deepEqual(two.from, [{ id: 'b' }], 'a line about several sessions forgets it');
  assert.equal(two.stale, true, 'and is made again before it is spoken');
  drop(q, 'b');
  assert.equal(q.waiting.includes(two), false, 'with nobody left in it, it goes');
  const p = newQueue();
  add(p, { kind: 'news', parts: ['Relay is done.', 'It fixed the port.', 'Tests pass.'], session: 'a' });
  add(p, { kind: 'news', parts: ['Billing is done.'], session: 'c' });
  assert.equal(next(p).text, 'Relay is done.');
  drop(p, 'a');
  assert.deepEqual(drain(p), ['♪ Also, Billing is done.'], 'the line being said stops after its sentence');
});
