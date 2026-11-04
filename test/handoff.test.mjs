// Tests for handoff.mjs: handing a session off to a fresh one. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleFromBrief, matchHandoff, handoffFromTurn, handoffPlace, handoffChildren, cleanHandoffPattern, weaveCards } from '../handoff.mjs';

const PATTERN = { marker: '^ACME: handoff - ', block: 'first fenced block after the marker' };
const BRIEF = [
  'Title: COSCRYPTO-893 ripple-integration - step G8 DEV sweep and gas posting',
  'If you can rename this session, set its title to the Title line above.',
  'Resume at: the next open G item in COSCRYPTO-893-dev-testing-plan.md (G8).',
].join('\n');
const REPLY = `Step G7 is finished and the plan is updated.\n\nACME: handoff - Step: G7 finished\n\n\`\`\`\n${BRIEF}\n\`\`\`\n`;
// One finished turn after an earlier one: the earlier turn's events end with its result.
const turn = (...evs) => [{ k: 'text', text: 'an earlier turn' }, { k: 'result' }, { k: 'user', text: 'go on' }, ...evs];

test('root session: the replacement goes to the top level, in the group the old one chose', () => {
  assert.deepEqual(handoffPlace({ groupId: 'g_1' }, null), { parentId: null, reportsTo: null, groupId: 'g_1' });
  assert.deepEqual(handoffPlace({}, null), { parentId: null, reportsTo: null, groupId: undefined });
});

test('child session: the replacement goes under the same parent and reports where the old one did', () => {
  assert.deepEqual(handoffPlace({ reportsTo: 'p1', groupId: 'g_1' }, 'p1'), { parentId: 'p1', reportsTo: 'p1', groupId: undefined });
});

test("the old session's children move under the new one and report to it", () => {
  const { moved, context } = handoffChildren([
    { id: 'c1', title: 'Fix the parser', rec: { client: 'acme', parentId: 'old', reportsTo: 'old', groupId: 'g_1' }, running: true },
    { id: 'c2', title: 'Look up the docs', rec: { client: 'acme', reportsTo: 'old', replyTo: 'old' }, running: false },
    { id: 'c3', title: '', rec: undefined, running: false }, // known only to the desktop app
    { id: 'c4', title: 'Sent by another', rec: { parentId: 'old', reportsTo: 'old', replyTo: 'other' }, running: true },
  ], 'old', 'new');
  assert.deepEqual(moved, [
    { id: 'c1', rec: { client: 'acme', parentId: 'new', reportsTo: 'new', groupId: 'g_1' }, running: true },
    { id: 'c2', rec: { client: 'acme', parentId: 'new', reportsTo: 'new' }, running: false },
    { id: 'c3', rec: { parentId: 'new', reportsTo: 'new' }, running: false },
    { id: 'c4', rec: { parentId: 'new', reportsTo: 'new', replyTo: 'other' }, running: true }, // work another session sent still reports there
  ]);
  assert.ok(context.includes('"Fix the parser" (id c1, still running); "Look up the docs" (id c2, not running); "Untitled" (id c3, not running)'));
});

test('no children: nothing moves and the first message says nothing about them', () => {
  assert.deepEqual(handoffChildren([], 'old', 'new'), { moved: [], context: '' });
});

test('the title comes from a Title: line in the brief', () => {
  assert.equal(titleFromBrief(BRIEF), 'COSCRYPTO-893 ripple-integration - step G8 DEV sweep and gas posting');
  assert.equal(titleFromBrief('no title here'), '');
});

test('pattern match: the first fenced block after the marker is the brief', () => {
  assert.equal(matchHandoff(REPLY, PATTERN), BRIEF);
  const h = handoffFromTurn(turn({ k: 'text', text: REPLY }, { k: 'tool', name: 'Read' }), PATTERN);
  assert.equal(h.brief, BRIEF);
  assert.equal(h.title, 'COSCRYPTO-893 ripple-integration - step G8 DEV sweep and gas posting');
  // a fenced block before the marker is not the brief
  assert.equal(matchHandoff('```\nnot this\n```\n' + REPLY, PATTERN), BRIEF);
});

test('pattern miss: no card without the marker, without a block after it, or with no pattern set', () => {
  assert.equal(matchHandoff('All done.\n\n```\n' + BRIEF + '\n```', PATTERN), null);
  assert.equal(matchHandoff('Text that mentions ACME: handoff - inline\n\n```\nx\n```', PATTERN), null); // marker must start a line
  assert.equal(matchHandoff('ACME: handoff - Step: G7 finished, but no block', PATTERN), null);
  assert.equal(handoffFromTurn(turn({ k: 'text', text: REPLY }), undefined), null);
  assert.equal(handoffFromTurn(turn({ k: 'text', text: REPLY }), { marker: '(' }), null); // a broken pattern does nothing
  // a handoff block from an earlier turn does not raise a card again
  assert.equal(handoffFromTurn([{ k: 'text', text: REPLY }, { k: 'result' }, { k: 'text', text: 'Carrying on here.' }], PATTERN), null);
});

test('tool and pattern in the same turn: no second card', () => {
  const evs = turn({ k: 'handoff', id: 'handoff_1', state: 'open' }, { k: 'text', text: REPLY });
  assert.equal(handoffFromTurn(evs, PATTERN), null);
  // the tool's card in an earlier turn does not stop this turn's match
  assert.equal(handoffFromTurn([{ k: 'handoff' }, { k: 'result' }, { k: 'text', text: REPLY }], PATTERN).brief, BRIEF);
});

test('cleanHandoffPattern keeps a usable pattern and drops a broken one', () => {
  assert.deepEqual(cleanHandoffPattern({ marker: '^ACME: handoff - ', block: 'first fenced block after the marker' }), PATTERN);
  assert.equal(cleanHandoffPattern({ marker: '(' }), undefined);
  assert.equal(cleanHandoffPattern({}), undefined);
  assert.equal(cleanHandoffPattern({ marker: '  ' }), undefined);
  assert.equal(cleanHandoffPattern(undefined), undefined);
});

// a chat read again from the conversation file gets its saved handoff cards back.
const card = (id) => ({ k: 'handoff', id, title: 'Next', brief: 'b', state: 'open' });

test('a saved card goes back right after the propose_handoff call that raised it', () => {
  const evs = [{ k: 'user', text: 'hi' }, { k: 'tool', id: 't1', result: 'Shown to the user as a handoff card (handoff_ab12) in this chat' }, { k: 'text', text: 'Done.' }, { k: 'result' }];
  const out = weaveCards(evs, [{ ev: card('handoff_ab12'), anchor: '' }]);
  assert.deepEqual(out.map((e) => e.k), ['user', 'tool', 'handoff', 'text', 'result']);
});

test('a card raised by a reply pattern goes back after that reply, and an open one with no place at the end, marked earlier', () => {
  const evs = [{ k: 'text', text: 'Step G7 is finished. ACME: handoff - ...' }, { k: 'result' }, { k: 'user', text: 'more' }, { k: 'text', text: 'ok' }];
  const placed = card('handoff_p1'); const lost = card('handoff_x');
  const out = weaveCards(evs, [{ ev: placed, anchor: 'Step G7 is finished.' }, { ev: lost, anchor: 'not in the chat' }]);
  assert.deepEqual(out.map((e) => e.id || e.k), ['text', 'handoff_p1', 'result', 'user', 'text', 'handoff_x']);
  assert.equal(placed.earlier, undefined);
  assert.equal(lost.earlier, true);
});

// after a compaction the chat holds only what follows the last boundary, so cards made before it have no place.
test('answered cards whose tool call and anchor were compacted away go at the top, never after the last reply', () => {
  const evs = [{ k: 'user', text: 'what is left?' }, { k: 'tool', id: 'toolu_new', result: 'ok' }, { k: 'text', text: 'Nothing more tonight.' }, { k: 'result' }];
  const started = { k: 'proposal', id: 'prop_1', title: 'Old work', brief: 'b', state: 'started', startedId: 's1' };
  const dismissed = { k: 'proposal', id: 'prop_2', title: 'Other', brief: 'b', state: 'dismissed' };
  const folder = { ev: { k: 'folder-offer', id: 'fold_1', state: 'moved' }, anchor: 'gone' };
  const out = weaveCards(evs, [folder, { ev: started, anchor: 'No good reason for most of it.', tool: 'toolu_old' }, { ev: dismissed, anchor: 'gone too', tool: 'toolu_old2' }]);
  assert.deepEqual(out.map((e) => e.id || e.k), ['fold_1', 'prop_1', 'prop_2', 'user', 'toolu_new', 'text', 'result']);
  const lastReply = out.findLastIndex((e) => e.k === 'text');
  assert.ok(out.findIndex((e) => e.id === 'prop_1') < lastReply);
  assert.equal(started.earlier, true);
});

test('a handoff still offering to archive counts as open, and a placed card keeps the top cards in order', () => {
  const evs = [{ k: 'text', text: 'Earlier reply' }, { k: 'text', text: 'last' }];
  const hoff = { k: 'handoff', id: 'handoff_a', state: 'continued', archive: 'offered' };
  const out = weaveCards(evs, [{ ev: { k: 'proposal', id: 'prop_a', state: 'withdrawn' } }, { ev: { k: 'proposal', id: 'prop_b', state: 'started' }, anchor: 'Earlier reply' }, { ev: { k: 'proposal', id: 'prop_c', state: 'dismissed' } }, { ev: hoff }]);
  assert.deepEqual(out.map((e) => e.id || e.k), ['prop_a', 'prop_c', 'text', 'prop_b', 'text', 'handoff_a']);
});

test('a card saved with its tool call goes back right after that call, even with no result naming it', () => {
  const evs = [{ k: 'text', text: 'Earlier reply' }, { k: 'user', text: 'offer it' }, { k: 'tool', id: 'toolu_1', result: 'fetch failed' }, { k: 'text', text: 'It failed.' }];
  const out = weaveCards(evs, [{ ev: { k: 'offer', id: 'offer_1', state: 'pending' }, anchor: 'Earlier reply', tool: 'toolu_1' }]);
  assert.deepEqual(out.map((e) => e.id || e.k), ['text', 'user', 'toolu_1', 'offer_1', 'text']);
});

test('a card already in the chat is not added twice, and no saved cards changes nothing', () => {
  const c = card('handoff_ab12');
  const evs = [{ k: 'user', text: 'hi' }, c];
  assert.equal(weaveCards(evs, [{ ev: c }]).length, 2);
  assert.deepEqual(weaveCards(evs, undefined), evs);
});
