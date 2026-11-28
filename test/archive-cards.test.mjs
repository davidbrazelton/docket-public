// Tests for open cards in archived sessions (#984): the waiting list leaves them out (pilot.mjs openWaiting), and
// archiving settles them (handoff.mjs closeOnArchive). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openWaiting } from '../pilot.mjs';
import { closeOnArchive, ARCHIVED_NOTE } from '../handoff.mjs';

const prop = (id, parentId, state = 'open') => ({ parentId, client: 'docket', title: id, ev: { k: 'proposal', id, state } });
const hoff = (id, sessionId, state = 'open') => ({ sessionId, client: 'docket', title: id, ev: { k: 'handoff', id, state } });

test("an archived session's open proposal, handoff and sign-in need do not count as waiting", () => {
  const archived = (desk, id) => desk === 'docket' && id === 'old';
  const w = openWaiting({
    proposals: [prop('prop_69bc8f10', 'old'), prop('prop_live', 'open1'), prop('prop_done', 'open1', 'dismissed')],
    handoffs: [hoff('handoff_old', 'old'), hoff('handoff_live', 'open1')],
    sessions: { old: { client: 'docket', needsSignin: { site: 'a.com' } }, open1: { client: 'docket', needsSignin: { site: 'b.com' } } },
    archived,
  });
  assert.deepEqual(w.proposals.map((p) => p.ev.id), ['prop_live']);
  assert.deepEqual(w.handoffs.map((h) => h.ev.id), ['handoff_live']);
  assert.deepEqual(w.signins.map(([id]) => id), ['open1']);
});

test('with nothing archived every open item still counts', () => {
  const w = openWaiting({ proposals: [prop('p1', 's1')], handoffs: [hoff('h1', 's1')], sessions: { s1: { client: 'docket', needsSignin: { site: 'a.com' } } } });
  assert.equal(w.proposals.length + w.handoffs.length + w.signins.length, 3);
});

test('archiving settles each open card kind and leaves answered ones and desk handoffs alone', () => {
  assert.deepEqual(closeOnArchive({ k: 'proposal', state: 'open' }), { state: 'dismissed', note: ARCHIVED_NOTE });
  assert.deepEqual(closeOnArchive({ k: 'offer', state: 'pending' }), { state: 'closed' });
  assert.deepEqual(closeOnArchive({ k: 'cross', state: 'pending' }), { state: 'stopped' });
  assert.deepEqual(closeOnArchive({ k: 'title-suggestion', state: 'open' }), { state: 'dismissed' });
  assert.deepEqual(closeOnArchive({ k: 'plan-offer', state: 'open' }), { state: 'dismissed' });
  assert.deepEqual(closeOnArchive({ k: 'handoff', state: 'open' }), { state: 'closed' });
  assert.deepEqual(closeOnArchive({ k: 'handoff', state: 'started', archive: 'offered' }), { archive: 'archived' });
  assert.equal(closeOnArchive({ k: 'handoff', state: 'here' }), null);
  assert.equal(closeOnArchive({ k: 'proposal', state: 'started' }), null);
  assert.equal(closeOnArchive({ k: 'desk-handoff', state: 'open' }), null);
});
