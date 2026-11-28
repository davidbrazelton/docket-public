// Tests for Read aloud's timing log (#1177): the record's shape, what is logged and kept, and its words in ☰ > Docket
// settings > Talk mode. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRecord, stamp, actOn, dropRec, fixDo, logRow, cleanRow, rowWords, TEXT_MAX } from '../talk-log.mjs';
import { actName } from '../talk-grammar.mjs';

const T = Date.parse('2026-11-20T20:00:00Z');
const state = { status: 'idle', unread: true, unreadWhy: 'result', asksYou: false, label: 'merge', pr: 1180, viewed: false, needs: true, extra: 'not kept' };

test('a record: the event, the session as it found it, each step once, and what the user did', () => {
  const r = newRecord({ event: 'settled', at: T, session: 'abc', title: 'Read aloud Off', why: 'merge', state });
  assert.deepEqual(r.state, { status: 'idle', unread: true, unreadWhy: 'result', asksYou: false, label: 'merge', pr: 1180, viewed: false }, 'only the snapshot fields');
  stamp(r, 'announced', T + 4000); stamp(r, 'queued', T + 4001); stamp(r, 'queued', T + 9999);
  assert.equal(r.queued, T + 4001, 'the first time counts');
  actOn(r, 'merged', T + 1200);
  fixDo(r, 'drop: you acted', false); fixDo(r, 'drop: you acted', false);
  stamp(r, 'started', T + 4300); stamp(r, 'ended', T + 6000);
  r.text = 'Read aloud Off wants to merge #1180.';
  assert.deepEqual(logRow(r), {
    at: '2026-11-20T20:00:00.000Z', event: 'settled', session: 'abc', title: 'Read aloud Off', why: 'merge',
    state: { status: 'idle', unread: true, unreadWhy: 'result', asksYou: false, label: 'merge', pr: 1180, viewed: false },
    text: 'Read aloud Off wants to merge #1180.', announced: 4000, queued: 4001, started: 4300, ended: 6000,
    acts: [{ act: 'merged', after: 1200 }], would: ['drop: you acted'],
  });
});

// #1181: the open session's turn that needs nothing is logged as dropped, with the label the turn declared.
test('a turn that needs nothing: dropped as not waiting, with the label from the turn', () => {
  const r = newRecord({ event: 'turnEnded', at: T, session: 'o', title: 'Coordinator', state: { ...state, label: 'reply', pr: null, said: 'reply' } });
  dropRec(r, 'not waiting', T);
  const row = cleanRow(logRow(r));
  assert.deepEqual(row.dropped, { after: 0, why: 'not waiting' });
  assert.equal(row.state.said, 'reply');
  assert.equal('said' in newRecord({ event: 'settled', state }).state, false, 'no label declared: left out');
  assert.ok(rowWords(row).includes('(not waiting)'));
});

test('a dropped record says when and why; text is cut to 80 characters', () => {
  const r = newRecord({ event: 'childReport', at: T, session: 'k', title: 'x'.repeat(200) });
  r.text = 'word '.repeat(50);
  dropRec(r, 'rechecked', T + 2000); dropRec(r, 'stopped', T + 3000);
  const row = logRow(r);
  assert.deepEqual(row.dropped, { after: 2000, why: 'rechecked' }, 'the first reason counts');
  assert.equal(row.title.length, TEXT_MAX);
  assert.ok(row.text.length <= TEXT_MAX && row.text.endsWith('…'));
  assert.equal(row.started, null);
  assert.equal('would' in row, false, 'nothing the fixes would do: left out');
  assert.equal('did' in row, false, 'nothing the fixes did: left out');
  assert.equal(dropRec(newRecord({ event: 'settled' }), 'made up').dropped.why, 'replaced', 'only the known reasons');
});

test('the app keeps only the known fields, of the known kinds', () => {
  const r = newRecord({ event: 'turnEnded', at: T, session: 's', title: 'T', why: 'done', state: { ...state, viewed: true } });
  stamp(r, 'started', T + 500);
  const row = logRow(r);
  assert.deepEqual(cleanRow(row), row, 'a row the page made comes through as it is');
  assert.equal(cleanRow({ ...row, event: 'nonsense' }), null);
  assert.equal(cleanRow({ ...row, at: 'yesterday' }), null);
  assert.equal(cleanRow(null), null);
  const odd = cleanRow({ ...row, started: -5, queued: 'soon', audio: 'AAAA', acts: [{ act: 'merged', after: 3 }, null], dropped: { after: 1, why: '<b>' } });
  assert.equal(odd.started, null); assert.equal(odd.queued, null);
  assert.equal('audio' in odd, false, 'no audio, nor anything else unknown');
  assert.deepEqual(odd.acts, [{ act: 'merged', after: 3 }, { act: '', after: null }]);
  assert.equal(odd.dropped.why, 'replaced');
});

test('its words in the settings: event → spoken in X s, and the user’s actions before it spoke', () => {
  const base = { title: 'Relay fix', event: 'settled', acts: [] };
  assert.equal(rowWords({ ...base, started: 4300, acts: [{ act: 'merged', after: 3100 }] }), 'Relay fix · settled → spoken in 4.3 s · you merged 1.2 s before it spoke');
  assert.equal(rowWords({ ...base, started: 4300, acts: [{ act: 'merged', after: 5000 }] }), 'Relay fix · settled → spoken in 4.3 s', 'an action after it spoke is not "before"');
  assert.equal(rowWords({ ...base, started: null, dropped: { after: 4000, why: 'you acted' }, acts: [{ act: 'merged', after: 1100 }] }), 'Relay fix · settled → dropped after 4.0 s (you acted) · you merged at 1.1 s');
  assert.equal(rowWords({ ...base, started: 4000, would: ['drop: no longer needs you'] }), 'Relay fix · settled → spoken in 4.0 s · the fixes would: drop: no longer needs you');
  assert.equal(rowWords({ ...base, started: null, dropped: { after: 0, why: 'viewed' }, did: ['skip: session being viewed'] }), 'Relay fix · settled → dropped after 0.0 s (viewed) · the fixes: skip: session being viewed');
});

// #1258: the line fixes are on by default, so a record carries what they did; "would" only with them switched off.
test('with the line fixes on, a record carries what they did, and the app keeps it', () => {
  const r = newRecord({ event: 'turnEnded', at: T, session: 'o', title: 'Coordinator', why: 'merge', state: { ...state, viewed: true } });
  fixDo(r, 'skip: session being viewed'); fixDo(r, 'skip: session being viewed');
  dropRec(r, 'viewed', T);
  const row = logRow(r);
  assert.deepEqual(row.did, ['skip: session being viewed'], 'once');
  assert.equal('would' in row, false, 'nothing under would with the fixes on');
  assert.deepEqual(cleanRow(row), row, 'the app keeps did and the viewed reason');
  assert.deepEqual(cleanRow({ ...row, did: Array(9).fill('x') }).did.length, 5, 'at most five');
});

test("the user's actions, named for the log", () => {
  assert.equal(actName('/api/sessions/a/send', { text: 'merge' }), 'merged');
  assert.equal(actName('/api/sessions/a/send', { text: 'Q3 yes' }), 'answered');
  assert.equal(actName('/api/sessions/a/send', { text: 'carry on' }), 'sent a message');
  assert.equal(actName('/api/sessions/a/permission', { allow: true }), 'allowed');
  assert.equal(actName('/api/sessions/a/permission', { allow: false }), 'denied');
  assert.equal(actName('/api/sessions/a/permission', { allow: true, answers: { q: 'a' } }), 'answered');
  assert.equal(actName('/api/sessions/a/interrupt', {}), 'stopped');
  assert.equal(actName('/api/sessions/a/archive', { archived: true }), 'archived');
  assert.equal(actName('/api/sessions/a/rename', { title: 'x' }), '');
});

test('a sign-in line is logged as its own event (#1260)', () => {
  const r = newRecord({ event: 'signin', at: 1e12, session: 's', title: 'T', why: 'signin' });
  assert.equal(cleanRow(logRow(r))?.event, 'signin');
});
