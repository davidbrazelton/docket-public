// Tests for answers that close their questions as soon as they are sent (#1080): openAfterSend in questions.mjs, and
// sendToSession in server.mjs closing them before any wait (a pause, a budget stop, a session waking or reloading).
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openAfterAsk, openAfterSend, openAfterReply, openAfterTurn } from '../questions.mjs';

const text = (t) => ({ type: 'text', text: t });
const nums = (open) => open.map((x) => x.q);
const asked = () => openAfterAsk([], [text('Q35: Approve all three?\nQ36: Keep the old route?\nQ37: Rename it?\nQ38: Ship today?')], 34, 1000);

test('answers sent one message each close their questions at once, the rest stay bright', () => {
  let open = asked();
  open = openAfterSend(open, 'Q35 Approve all');
  open = openAfterSend(open, 'Q36 Drop it');
  open = openAfterSend(open, 'Q37 Drop it');
  assert.deepEqual(open.map((x) => [x.q, !!x.faint]), [[38, false]], 'only Q38 is still open, and it has not faded');
});

test('a message still waiting fades nothing, so a turn that ends before it goes cannot clear an open question', () => {
  const open = openAfterSend(asked(), 'Q35 Approve all');
  assert.deepEqual(nums(openAfterTurn(open)), [36, 37, 38]);
});

test('when the message goes, closing again is a no-op and the rest fade as before', () => {
  const sent = openAfterSend(asked(), 'Q35 Approve all');
  const went = openAfterReply(sent, 'Q35 Approve all');
  assert.deepEqual(went.map((x) => [x.q, !!x.faint]), [[36, true], [37, true], [38, true]]);
  assert.deepEqual(openAfterReply(asked(), 'Q35 Approve all'), went, 'the same as closing it only when it went');
});

test('a message that answers nothing changes nothing on send', () => {
  const open = asked();
  assert.equal(openAfterSend(open, 'and another thing'), open);
  assert.equal(openAfterSend(open, 'I think Q35 is hard'), open, 'a mention is not an answer');
});

test('sendToSession closes answers and saves decisions before any wait', () => {
  const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const start = src.indexOf('function sendToSession(');
  assert.ok(start > 0, 'sendToSession in server.mjs has moved');
  const body = src.slice(start, src.indexOf('\nfunction ', start + 10));
  const early = body.indexOf('trackSent(s, text); saveAnswers(s, answersIn(text, state.sessions[s.id]?.lastQ || 0));');
  assert.ok(early > 0, 'it closes answers on send');
  for (const wait of ['holdsMessage(', 'holdForBudget(', 's.resting', 's.reloading', 'if (!blocks.length) return'])
    assert.ok(early < body.indexOf(wait), `before ${wait}`);
});
