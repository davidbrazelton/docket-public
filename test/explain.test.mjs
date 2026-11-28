// Explain more and Side chat on questions (#1113): what the explainer reads, how its follow-ups are split off, and
// the clipped chat the session gets with the answer. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextText, explainPrompt, questionText, splitFollowUps, sideChatText, sideChatNote, CHAT_SEND_CHARS, EXPLAIN_SYSTEM } from '../explain.mjs';
import { count, payload, COUNTS, QUESTION_KEYS } from '../usage.mjs';
import { cleanPing } from '../usage-worker/src/clean.js';

const turn = (i) => [
  { k: 'user', text: `message ${i}` },
  { k: 'tool', id: `t${i}`, name: 'Bash', label: `npm test ${i}`, result: `ok ${i}` },
  { k: 'text', id: `r${i}`, text: `reply ${i}` },
];

test('the explainer reads the reply that asked whole, and the turns before it up to the window', () => {
  const events = [...Array.from({ length: 30 }, (_, i) => turn(i)).flat(), { k: 'text', id: 'later', text: 'after the question' }];
  const t = contextText(events, 'r29');
  assert.match(t, /The reply that asked the question:\nreply 29/);
  assert.match(t, /\[Tool Bash\] npm test 28 → ok 28/); // tool steps and their results
  assert.match(t, /\[Person\] message 10/); // the last 20 turns
  assert.doesNotMatch(t, /message 9\b/);
  assert.doesNotMatch(t, /after the question/); // nothing after it was asked
  assert.match(t, /^\(Earlier conversation left out\.\)/);
  // clipped to the budget, the newest kept
  const small = contextText(events, 'r29', { chars: 300 });
  assert.ok(small.length < 600, small.length);
  assert.match(small, /reply 29/);
  // a form: its own event is where it was asked; the steps of the reply that asked are listed
  const form = [...turn(1), { k: 'tool', id: 'x', name: 'Read', label: 'Read server.mjs', result: 'const a = 1' }, { k: 'text', id: 'y', text: 'Two choices:' }, { k: 'permission', id: 'p1', tool: 'AskUserQuestion', input: { questions: [{ question: 'Which?' }] }, state: 'pending' }];
  const f = contextText(form, 'p1');
  assert.match(f, /Steps the session ran in the reply that asked:\n\[Tool Bash\] npm test 1 → ok 1\n\[Tool Read\] Read server.mjs → const a = 1/);
  assert.match(f, /The reply that asked the question:\nreply 1\n\nTwo choices:/);
});

test('the prompt names the question and its options, and a fork is told it is a thrown-away copy', () => {
  const question = { q: 3, text: 'Which fix?', header: 'Fix', options: [{ label: 'One hold', description: 'one place' }, { label: 'Debounce' }] };
  assert.equal(questionText(question), 'Q3: Which fix?\n(Heading: Fix)\nOptions:\n- One hold: one place\n- Debounce\n- Other: the person types their own answer');
  const p = explainPrompt({ mode: 'chat', question, context: 'CTX', thread: [{ who: 'you', text: 'Why?' }, { who: 'ai', text: 'Because.', model: 'sonnet' }], ask: 'And the cost?' });
  assert.match(p, /^CTX\n\nThe question the session asked the person:\nQ3: Which fix\?/);
  assert.match(p, /Person: Why\?\n\nSonnet: Because\./);
  assert.match(p, /The person asks: And the cost\?$/);
  const f = explainPrompt({ mode: 'explain', question, fork: true });
  assert.match(f, /^\(From Docket: this is a read-only side question/);
  assert.ok(f.includes(EXPLAIN_SYSTEM));
  assert.match(EXPLAIN_SYSTEM, /Never pick an option for the person/);
});

test('follow-ups are split off the answer', () => {
  assert.deepEqual(splitFollowUps('It is asked because X.\n\nFollow-ups: What breaks? | How long? | "Can it wait?" | A fourth one'),
    { text: 'It is asked because X.', followUps: ['What breaks?', 'How long?', 'Can it wait?'] });
  assert.deepEqual(splitFollowUps('**Follow-ups:** One more?'), { text: '', followUps: ['One more?'] });
  assert.deepEqual(splitFollowUps('No follow-ups here.'), { text: 'No follow-ups here.', followUps: [] });
});

test('the chat sent with an answer is clipped, the newest kept, and names who said what', () => {
  assert.equal(sideChatText({ thread: [] }), '');
  const t = sideChatText({ explanation: 'Asked because the store moved.', thread: [{ who: 'you', text: 'Why now?' }, { who: 'ai', text: 'The release.', model: 'haiku' }, { who: 'you', text: 'And Opus?' }, { who: 'ai', text: 'Same.', model: 'opus' }] });
  assert.equal(t, 'Explanation they read: Asked because the store moved.\nPerson: Why now?\nHaiku: The release.\nPerson: And Opus?\nOpus: Same.');
  const long = sideChatText({ thread: Array.from({ length: 20 }, (_, i) => ({ who: i % 2 ? 'ai' : 'you', model: 'sonnet', text: `answer ${i} `.repeat(30) })) });
  assert.ok(long.length <= CHAT_SEND_CHARS + 30, long.length);
  assert.match(long, /^\(earlier part left out\)\n/);
  assert.match(long, /answer 19/);
  assert.match(sideChatNote('Q3', 'Person: Why?'), /^\(From Docket: before answering Q3, .*\nPerson: Why\?\)$/s);
});


test('the questions field counts numbers only, and the counter keeps only its keys', () => {
  const env = {}, now = Date.parse('2026-11-19T10:00:00Z'), state = { usage: {} };
  for (const k of QUESTION_KEYS) assert.ok(COUNTS.includes('questions.' + k), k);
  count(state, 'questions.answered', { env, now, n: 3 }); count(state, 'questions.explainForm', { env, now }); count(state, 'questions.haiku', { env, now });
  assert.equal(count(state, 'questions.acme', { env, now }), false);
  const body = payload({ u: state.usage, day: state.usage.day, counts: state.usage.counts, version: '1.232.0', platform: 'windows', totals: {} });
  assert.deepEqual(body.questions, { answered: 3, explainForm: 1, haiku: 1 });
  const row = cleanPing({ ...body, id: '11111111-2222-3333-4444-555555555555', firstSeen: '2026-11-19', questions: { ...body.questions, sentChat: 'Acme', acme: 4, opus: 1e9 } }, now);
  assert.equal(row.questions, '{"answered":3,"explainForm":1,"haiku":1,"opus":100000}');
});
