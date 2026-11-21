// Tests for numbered questions that stand out (#989): the open-question record and its closing rule (questions.mjs),
// the page's copies of askedOn and answersIn, and the row's question count. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { askedOn, askedIn, openAfterAsk, openAfterReply, openWithout, openAfterTurn, questionsWord, answersIn, afterMessage, asksByNumber, QUESTION_LEVELS } from '../questions.mjs';

const text = (t) => ({ type: 'text', text: t });
const form = (...qs) => ({ type: 'tool_use', name: 'AskUserQuestion', input: { questions: qs.map(([header, question, options = []]) => ({ header, question, options: options.map((label) => ({ label })) })) } });
const nums = (open) => open.map((x) => x.q);

test('a line asks when it starts with its number; quotes, quarters and bare numbers do not', () => {
  assert.deepEqual(askedOn('Q5: Keep the old label?'), { q: 5, text: 'Keep the old label?' });
  assert.deepEqual(askedOn('**Q5.** Keep **it**?'), { q: 5, text: 'Keep it?' });
  assert.deepEqual(askedOn('- Q7 which port?'), { q: 7, text: 'which port?' });
  assert.deepEqual(askedOn('2. Q8 — drop the route?'), { q: 8, text: 'drop the route?' });
  for (const l of ['Q5 answered: rename it', 'Q5 already answered', 'Q4 2026 sales were up', "Q3 '26 plan", 'Q1-2027 roadmap', 'Q5', 'I think Q5 is hard', 'FAQ5: no']) assert.equal(askedOn(l), null, l);
});

test('a message asks by its lines (at the start or in a sentence that asks) and its form (with options)', () => {
  const a = askedIn([text('Intro\nQ5: Keep it?\nAlso, should I rename it (Q6)?\nAs you said in Q2, done.'), form(['Q7 Port', 'Which port?', ['4403', '4405']])]);
  assert.deepEqual(a.map((x) => [x.q, x.text]), [[5, 'Keep it?'], [6, 'Also, should I rename it (Q6)?'], [7, 'Which port?']]);
  assert.deepEqual(a.find((x) => x.q === 7).opts, ['4403', '4405']);
});

test('new numbers open; a number already used and closed is not opened again', () => {
  let open = openAfterAsk([], [text('Q5: Keep it?\nQ6: Rename it?')], 4, 1);
  assert.deepEqual(nums(open), [5, 6]);
  assert.equal(open[0].at, 1);
  const same = openAfterAsk(open, [text('Q5: Keep it, then?')], 6, 2);
  assert.equal(same, open, 'asked again while open and bright: unchanged');
  open = openWithout(open, [5]);
  assert.deepEqual(nums(openAfterAsk(open, [text('Q5: Keep it?')], 6, 3)), [6], 'Q5 was closed: a later mention does not reopen it');
  assert.deepEqual(nums(openAfterAsk([], [text('Q90: far past the count?')], 6)), [], 'a stray number far past the last one is not a question');
});

// #1006: a number only mentioned opened as a question, so the row said "needs you: question" on a turn marked done,
// the tray listed lines the chat never marked, and the mention used the number up.
test('a mention is not a question; a line or sentence that asks with its number is', () => {
  assert.equal(askedOn('Next question number is Q10.'), null);
  assert.equal(askedOn('Is the next question number Q10?'), null, 'about the numbering, though it ends with ?');
  assert.equal(askedOn('Q10 opened in the tray as a question.'), null, 'starts with the number but asks nothing');
  assert.equal(askedOn('Q10: no questions are open?'), null);
  assert.deepEqual(askedOn('Q10: Keep it?'), { q: 10, text: 'Keep it?' });
  assert.deepEqual(askedOn('Should we keep it (Q10)?'), { q: 10, text: 'Should we keep it (Q10)?' });
  assert.deepEqual(askedOn('Done with the label. Should we keep it (**Q10**)?'), { q: 10, text: 'Should we keep it (Q10)?' }, 'the sentence that asks');
  assert.equal(askedOn('Why did Q10 and Q11 both open?'), null, 'a sentence with two numbers is about them, not asking one');
  assert.equal(askedOn('Keep it (Q10)? Not sure. Q11 was about the port.').q, 10);
});

test('a prose reply that discusses question numbers opens none and uses none up', () => {
  const prose = [text([
    'Found it. The tray listed Q10 and Q11 as open, but nothing asked them.',
    'Next question number is Q10, so the next real question would come out as Q11.',
    'askedIn opened any number above the last one, so "the next question is Q12" opened Q12 too.',
    'Q13 is the number a summary would restart at; no questions are open now.',
    '- Q14 stays unused until something asks it.',
    'Turn marked done.',
  ].join('\n'))];
  assert.deepEqual(askedIn(prose), []);
  assert.deepEqual(openAfterAsk([], prose, 9), [], 'nothing opens');
  assert.equal(afterMessage(9, prose), 9, 'no number is used up');
  assert.equal(asksByNumber(prose[0].text), false, 'the turn does not count as asking');
  assert.deepEqual(nums(openAfterAsk([], [text('Next question number is Q10.\nQ10: Keep it?')], 9)), [10], 'a mention beside a real question');
  assert.equal(afterMessage(9, [text('Should we keep it (Q10)?')]), 10, 'a mid-sentence question uses its number');
});

test('closing rule: by number, by form, by ✓', () => {
  const open = openAfterAsk([], [text('Q5: Keep it?\nQ6: Rename it?'), form(['Q7', 'Which port?', ['a', 'b']])], 4);
  assert.deepEqual(nums(openAfterReply(open, 'Q5 keep it, Q6: rename')), [7], 'answered by number');
  assert.deepEqual(nums(openWithout(open, [7])), [5, 6], 'its form answered');
  assert.deepEqual(nums(openWithout(open, [6])), [5, 7], '✓ by hand');
  assert.equal(openWithout(open, [9]), open, 'nothing to close: the same list');
});

test('closing rule: a reply without the number fades it, and the next reply clears it unless it asks again', () => {
  let open = openAfterAsk([], [text('Q5: Keep it?\nQ6: Rename it?')], 4);
  open = openAfterReply(open, 'yeah go with the first one');
  assert.deepEqual(open.map((x) => !!x.faint), [true, true], 'both fade: you replied after them');
  assert.equal(openAfterReply(open, 'and another thing'), open, 'already faint: unchanged');
  open = openAfterAsk(open, [text('Done with the label.\n\nQ6: Still, rename it?\nQ8: And the route?')], 7);
  assert.deepEqual(open.map((x) => [x.q, !!x.faint]), [[5, true], [6, true], [8, false]], 'Q6 only restated stays faint (#1138); Q8 is new');
  open = openAfterTurn(open);
  assert.deepEqual(nums(open), [8], 'Q5 and Q6 clear when the reply ends');
  assert.equal(openAfterTurn(open), open, 'nothing faint: the same list');
});

test('a faint question asked again word for word stays faint and clears; with new options it is bright again (#1138)', () => {
  const faint = openAfterReply(openAfterAsk([], [form(['Q5', 'Keep it?', ['yes', 'no']])], 4), 'hmm');
  assert.equal(faint[0].faint, true);
  const same = openAfterAsk(faint, [form(['Q5', 'Keep it?', ['yes', 'no']])], 5);
  assert.equal(same, faint, 'the same form again: unchanged');
  assert.deepEqual(openAfterTurn(openAfterAsk(faint, [text('Q5: Keep it?')], 5)), [], 'restated in text: cleared at the turn end');
  const fresh = openAfterAsk(faint, [form(['Q5', 'Keep it?', ['yes', 'no', 'keep both']])], 5);
  assert.deepEqual([fresh[0].faint, fresh[0].opts], [undefined, ['yes', 'no', 'keep both']], 'new options: bright, with them');
});

// Lines that only point back at a question asked before (#1138, research in #1091).
const REFERENCES = [
  'Q39 (top up the batch as sessions finish?) is still waiting for your answer.',
  'Q41 is still open: should each person get their own login?',
  'Q1 (still open): Can you type /invite in the channel?',
  'Q2 still needs your answer: which tab look from the mock do you want, A, B, C or D?',
  '**Q2** still needs you: which tab look do you want?',
  '- Q7 is still pending: keep both?',
  'Q7 above: keep both?',
  'Q7 is yours: keep both?',
  'As before, Q41 is still open: should each person get their own login?',
];

test('a reference to an open question is not an ask: it opens nothing, brightens nothing and uses no number', () => {
  for (const l of REFERENCES) {
    assert.equal(askedOn(l), null, l);
    assert.equal(asksByNumber(l), false, l);
  }
  assert.equal(afterMessage(1, [text(REFERENCES[1])]), 1, 'Q41 is not used up');
  const faint = openAfterReply(openAfterAsk([], [text('Q2: Which tab look, A, B, C or D?')], 1), 'let me look');
  assert.equal(openAfterAsk(faint, [text(REFERENCES[3])], 2), faint, 'a faint Q2 stays faint');
  assert.deepEqual(openAfterAsk([], [text(REFERENCES[1])], 40), [], 'nothing opens');
  // still asks
  assert.deepEqual(askedOn('Q7: Is still open-ended pricing fine?'), { q: 7, text: 'Is still open-ended pricing fine?' });
  assert.deepEqual(askedOn('Q7: Is the old route still open to the public?'), { q: 7, text: 'Is the old route still open to the public?' });
});

test('answering one by number still fades the others', () => {
  const open = openAfterReply(openAfterAsk([], [text('Q5: a?\nQ6: b?')], 4), 'Q6 b');
  assert.deepEqual(open.map((x) => [x.q, !!x.faint]), [[5, true]]);
});

test('a faint question asked only in passing is not brought back', () => {
  const open = openAfterReply(openAfterAsk([], [text('Q5: Keep it?')], 4), 'sure');
  assert.equal(openAfterAsk(open, [text('As for Q5, I kept it.')], 5)[0].faint, true);
  assert.equal(openAfterAsk(open, [form(['Q5', 'Keep it?', ['yes', 'no']])], 5)[0].faint, undefined, 'its form asks again');
});

test('the row tag counts open questions', () => {
  assert.equal(questionsWord(0), 'question');
  assert.equal(questionsWord(1), '1 question');
  assert.equal(questionsWord(3), '3 questions');
  assert.deepEqual(QUESTION_LEVELS, ['off', 'highlight', 'track']);
});

// Answers by number (#1130): lowercase q, "and" / "&", shared answers, and quarters of a year that answer nothing.
const ANSWER_CASES = [
  ['q7 yes', [{ q: 7, answer: 'yes' }]],
  ['ok. q7 go ahead', [{ q: 7, answer: 'go ahead' }]],
  ['Q7 yes\nq9 no', [{ q: 7, answer: 'yes' }, { q: 9, answer: 'no' }]],
  ['Q7 yes and Q9 no', [{ q: 7, answer: 'yes' }, { q: 9, answer: 'no' }]],
  ['Q7 yes & q9 no', [{ q: 7, answer: 'yes' }, { q: 9, answer: 'no' }]],
  ['Q7, Q9: yes', [{ q: 7, answer: 'yes' }, { q: 9, answer: 'yes' }]],
  ['Q7 and Q9: yes', [{ q: 7, answer: 'yes' }, { q: 9, answer: 'yes' }]],
  ['Q7 & Q9 yes', [{ q: 7, answer: 'yes' }, { q: 9, answer: 'yes' }]],
  ['Q7 yes, Q9 no', [{ q: 7, answer: 'yes' }, { q: 9, answer: 'no' }]],
  ['Q7 yes. Q9 the second one', [{ q: 7, answer: 'yes.' }, { q: 9, answer: 'the second one' }]],
  ['Q7 - yes', [{ q: 7, answer: 'yes' }]],
  ['**Q7** yes', [{ q: 7, answer: 'yes' }]],
  ['- Q7 yes', [{ q: 7, answer: 'yes' }]],
  ['I think Q7 is hard', []],
  ['I think q7 and Q9 are hard', []],
  ['Q7 yes, we grew in Q3 and Q4 was flat', [{ q: 7, answer: 'yes, we grew in Q3 and Q4 was flat' }]],
  ['Q4 yes', [{ q: 4, answer: 'yes' }]],
  ['q2 the second one', [{ q: 2, answer: 'the second one' }]],
  ['Q3 2', [{ q: 3, answer: '2' }]],
  ['Q1 and Q2: keep both', [{ q: 1, answer: 'keep both' }, { q: 2, answer: 'keep both' }]],
  ...['Q4 sales were down', 'q1 2027 plan: hire two', 'Q4 2026', "Q4 '26", 'Q4-26', 'Q3 FY27', 'FY26 Q3', 'FY26. Q3 was slow', 'Q1/2027', 'Q1-Q4',
    'Q1–Q3', 'Q3/Q4', 'Q1 through Q4', 'Q2 to Q3', 'in Q4', 'by Q2 please', 'end of Q3', 'this Q', 'last Q1', 'q4 earnings beat',
    'Q2 revenue', 'Q3 revenues up', 'Q1 and Q2 sales were down'].map((t) => [t, []]),
];
test('answers by number: lowercase q, and / &, shared answers, not quarters (#1130)', () => {
  for (const [t, want] of ANSWER_CASES) assert.deepEqual(answersIn(t), want, t);
});
test('answers by number above the last asked number answer nothing (#1130)', () => {
  assert.deepEqual(answersIn('Q7 yes, Q9 no', 8), [{ q: 7, answer: 'yes' }]);
  assert.deepEqual(answersIn('Q7 yes', 0), []);
  assert.deepEqual(answersIn('Q7 yes'), [{ q: 7, answer: 'yes' }]);
  assert.deepEqual(answersIn('Q1 plan B', 9), [{ q: 1, answer: 'plan B' }]);
  assert.deepEqual(answersIn('Q2 numbers look right', 9), [{ q: 2, answer: 'numbers look right' }]);
  assert.deepEqual(answersIn('Q4 sales were down', 9), []);
});

// The page reads the chat's text with its own copies; they must agree with the server's.
const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cs = page.indexOf('const qPlain'), ce = page.indexOf('// end of the questions.mjs copies');
assert.ok(cs > 0 && ce > cs, 'the questions.mjs copies in index.html have moved or lost their markers');
const pageQ = new Function(page.slice(cs, ce) + '\nreturn { askedOn, answersIn, isReference };')();

test("the page's askedOn and answersIn agree with questions.mjs", () => {
  for (const l of ['Q5: Keep the old label?', '**Q5.** Keep **it**?', 'Q5 answered: x', 'Q4 2026 sales', 'Q5', 'hello', '- Q7 which port?', 'Q12 — ' + 'x'.repeat(300) + '?',
    'Next question number is Q10.', 'Q10 opened in the tray.', 'Should we keep it (Q10)?', 'Done. Keep it (Q10)?', 'Why did Q10 and Q11 open?', 'Is the next question number Q10?'])
    assert.deepEqual(pageQ.askedOn(l), askedOn(l), l);
  for (const l of REFERENCES) assert.deepEqual(pageQ.askedOn(l), askedOn(l), l);
  for (const t of ['Q7 keep both', 'Q7: keep both, Q9 flag it', 'I think Q7 is hard', 'Q1 a\nQ2: b\n- Q3 c', 'Q5 x. Q6 y'])
    assert.deepEqual(pageQ.answersIn(t), answersIn(t), t);
  for (const [t] of ANSWER_CASES) assert.deepEqual(pageQ.answersIn(t), answersIn(t), t);
  assert.deepEqual(pageQ.answersIn('Q7 yes, Q9 no', 8), answersIn('Q7 yes, Q9 no', 8));
});

// The row: on a Highlight + track desk, open questions keep it needing you and say how many.
const ns = page.indexOf('// ---------- needs you'), ne = page.indexOf('// end of needs you');
const S = { client: 'd1', qLevels: { d1: 'track' }, openQ: {} };
const inBackground = (s) => s.live && s.status === 'idle' && (s.runningTasks > 0 || s.background);
const { needsYou, needLabel, openQs } = new Function('inBackground', 'S', page.slice(ns, ne) + '\nreturn { needsYou, needLabel, openQs };')(inBackground, S);

test('open questions keep the row needing you, as a question, until they close', () => {
  const two = [{ q: 5, text: 'a' }, { q: 7, text: 'b' }];
  const read = { id: 's1', client: 'd1', live: true, status: 'idle', unread: false, openQ: two };
  assert.equal(needsYou(read), true, 'read, but two questions are open');
  assert.equal(needLabel(read), 'question');
  assert.equal(needLabel({ ...read, unread: true, unreadSaid: 'done' }), 'question', 'a turn marked done with questions open');
  assert.equal(needLabel({ ...read, unread: true }, true), 'merge', 'merge keeps its word (the count goes beside it)');
  assert.equal(needLabel({ ...read, unread: true, lastError: { text: 'x' } }), 'problem');
  assert.equal(needsYou({ ...read, status: 'running' }), false, 'working: not waiting on you yet');
  assert.equal(needsYou({ ...read, openQ: [] }), false, 'none open: read is read');
  assert.equal(needLabel({ ...read, unread: true, unreadSaid: 'done', openQ: [] }), 'done', 'a turn marked done with none open is not a question (#1006)');
  assert.equal(needsYou({ id: 's2', client: 'd1', live: false, openQ: two }), true, 'a saved session with questions open');
  assert.equal(needsYou({ id: 's2', client: 'd1', live: false, archived: true, openQ: two }), false, 'archived');
  S.openQ.s1 = []; assert.equal(needsYou(read), false, "a 'questions' message closed them"); delete S.openQ.s1;
  S.qLevels.d1 = 'highlight'; assert.equal(needsYou(read), false, 'Highlight only keeps no count'); assert.deepEqual(openQs(read), []);
  delete S.qLevels.d1; assert.equal(needsYou(read), false, 'a desk that has not answered the card is off');
  S.qLevels.d1 = 'track';
});

// #1010: several question lines joined by single line breaks are one paragraph in markdown; the page splits it so each
// line that starts a question is a block of its own (with its own options), and a line that only mentions one stays put.
const ls = page.indexOf('// ---------- question lines (#1010)'), le = page.indexOf('// end of question lines');
assert.ok(ls > 0 && le > ls, 'the question lines part of index.html has moved or lost its markers');
const { qLineBlocks } = new Function(page.slice(ls, le) + '\nreturn { qLineBlocks };')();
const qLine = new Function(/const Q_LINE = [^\n]+/.exec(page)[0] + '\nreturn Q_LINE;')();
const qReference = new Function('isReference', /function qReference\([\s\S]*?\n}\r?\n/.exec(page)[0] + '\nreturn qReference;')(pageQ.isReference);
const startsQ = new Function('askedOn', 'Q_LINE', 'qReference', /const startsQuestion = [^\n]+/.exec(page)[0] + '\nreturn startsQuestion;')(pageQ.askedOn, qLine, qReference);

// #1139: a line that only points at a question asked before is a reference: a chip in the chat, never a card.
test('a reference to a question is told from an ask', () => {
  for (const l of ['Q39 (top up the batch as sessions finish?) is still waiting for your answer.', 'Q41 is still open: should each person get their own settings in DEV?',
    'Q1 (still open): Can you type /invite in the channel?', 'Q2 still needs your answer: which tab look from the mock do you want, A, B, C or D?',
    'Q43 is still yours', '**Q43** is still yours.', '- Q7 above is the one to answer first.', 'Q5 still pending: keep it?'])
    assert.equal(qReference(l)?.q, Number(/Q(\d+)/.exec(l)[1]), l);
  for (const l of ['Q42: Post the reply to the thread as drafted above?', 'Q5: Keep it?', 'Q6 (the export): keep the CSV?', 'Q7 — still want the flag?', 'Should I keep it (Q5)?', 'Q4 2026 sales'])
    assert.equal(qReference(l), null, l);
});

test('several Qn lines joined by single line breaks each start their own question block', () => {
  const lines = ['Q1: OrderEventConsumer: fail-open Retry', 'Q2: ABC-1138: post one fresh testing comment', '**Q3:** Keep the CSV export?', 'Q4 — drop the route'];
  assert.deepEqual(qLineBlocks(lines, startsQ), [[0], [1], [2], [3]]);
  const decs = new Set([1, 2]), startsDec = (t) => decs.has(Number(t.match(qLine)?.[1])) || !!pageQ.askedOn(t);
  assert.deepEqual(qLineBlocks(lines.slice(0, 2), startsDec), [[0], [1]], 'plan decisions split without a ?');
});

test('a line that only mentions a number stays with the line above it', () => {
  const lines = ['Q1: Keep it?', 'as we said in Q2, it is done', 'Next question number is Q3.', 'Q4 opened in the tray.', 'Q4 2026 sales were up', 'Q5: Rename it?', 'more about Q5'];
  assert.deepEqual(qLineBlocks(lines, startsQ), [[0, 1, 2, 3, 4], [5, 6]]);
  assert.equal(qLineBlocks(['Intro line', 'I think Q5 is hard'], startsQ), null, 'nothing to split');
  assert.deepEqual(qLineBlocks(['Done with the deploy.', 'Q43 is still yours.'], startsQ), [[0], [1]], 'a reference is a line of its own, for its chip');
});
