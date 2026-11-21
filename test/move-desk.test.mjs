// Moving sessions' records to another desk, on made-up records: desk, group, cost rows, touches, pins and places
// follow; open sessions and other desks' sessions are left alone; a second run changes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveDesk } from '../move-desk.mjs';

const made = () => ({
  state: {
    sessions: {
      a: { client: 'acme', groupId: 'g_old', title: 'A' },
      b: { client: 'acme', title: 'B' },
      c: { client: 'other' },
      live1: { client: 'acme' },
    },
    touched: { acme: { a: 100, b: 50 }, example: { a: 200 } },
    pins: { acme: ['a', 'z'], example: [] },
    places: { acme: ['z', 'a', 'b'] },
  },
  usage: {
    a: { client: 'acme', rows: [{ Client: 'acme', Date: '2026-10-01' }, { Client: 'acme', Date: '2026-10-02' }] },
    n: { client: 'acme', rows: [{ Client: 'acme' }] }, // costs but no portal record
  },
});
const opts = { from: 'acme', to: 'example', groupIds: ['g_new', 'g_kept'], isLive: (id) => id === 'live1' };

test('records follow the session to the new desk and group', () => {
  const { state, usage } = made();
  const { results } = moveDesk(state, usage, { ...opts, ids: ['a', 'b', 'n', 'c', 'live1', 'ghost'], groupId: 'g_new' });
  const by = Object.fromEntries(results.map((r) => [r.id, r]));
  assert.deepEqual(state.sessions.a, { client: 'example', groupId: 'g_new', title: 'A' });
  assert.deepEqual(state.sessions.b, { client: 'example', groupId: 'g_new', title: 'B' });
  assert.deepEqual(state.sessions.n, { client: 'example', groupId: 'g_new' });
  assert.deepEqual(usage.a.rows.map((r) => r.Client), ['example', 'example']);
  assert.equal(usage.a.client, 'example');
  assert.equal(usage.n.rows[0].Client, 'example');
  assert.deepEqual(state.touched, { acme: {}, example: { a: 200, b: 50 } });
  assert.deepEqual(state.pins, { acme: ['z'], example: ['a'] });
  assert.deepEqual(state.places.acme, ['z']);
  assert.equal(by.a.result, 'moved');
  assert.equal(by.c.result, 'skipped'); assert.match(by.c.why, /desk other/);
  assert.equal(by.live1.result, 'skipped'); assert.equal(state.sessions.live1.client, 'acme');
  assert.equal(by.ghost.result, 'moved'); // a group was given, so a record is made for it
  assert.deepEqual(state.sessions.c, { client: 'other' });
});

test('without a group, a group not of the new desk is dropped and one of it kept', () => {
  const { state, usage } = made();
  state.sessions.b.groupId = 'g_kept';
  moveDesk(state, usage, { ...opts, ids: ['a', 'b', 'ghost'] });
  assert.equal(state.sessions.a.groupId, undefined);
  assert.equal(state.sessions.b.groupId, 'g_kept');
  assert.equal(state.sessions.ghost, undefined);
});

test('running it twice changes nothing more', () => {
  const { state, usage } = made();
  const o = { ...opts, ids: ['a', 'b', 'n', 'c', 'live1'], groupId: 'g_new' };
  moveDesk(state, usage, o);
  const snap = JSON.stringify({ state, usage });
  const again = moveDesk(state, usage, o);
  assert.equal(JSON.stringify({ state, usage }), snap);
  assert.equal(again.changed, false);
  assert.ok(again.results.every((r) => r.result !== 'moved'));
});

test('refuses a group of another desk and the same desk twice', () => {
  const { state, usage } = made();
  assert.throws(() => moveDesk(state, usage, { ...opts, ids: ['a'], groupId: 'g_old' }), /not a group/);
  assert.throws(() => moveDesk(state, usage, { ...opts, to: 'acme', ids: ['a'] }), /two different desks/);
});
