// Tests for questions.mjs: question numbers that carry on across a whole session (#928). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { questionNumbers, messageNumbers, afterMessage, nextQuestion, questionPart, questionLine, JUMP } from '../questions.mjs';
import { stateLine } from '../waits.mjs';
import { ruleText } from '../session-rules.mjs';
import { DOCKET_BLOCK } from '../touches.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = (t) => ({ type: 'text', text: t });
const form = (...qs) => ({ type: 'tool_use', name: 'AskUserQuestion', input: { questions: qs.map(([header, question]) => ({ header, question, options: [] })) } });

test('Q numbers are read from text, and quarters with a year are not questions', () => {
  assert.deepEqual(questionNumbers('**Q1.** Which one?\nQ2: and this?\n(Q3) last'), [1, 2, 3]);
  assert.deepEqual(questionNumbers('Q12 yes, Q9 the second one'), [12, 9]);
  assert.deepEqual(questionNumbers('sales for Q4 2026, Q3 \'26, Q1-2027 and Q2 2025'), []);
  assert.deepEqual(questionNumbers('FAQ1, Q&A, SQ5, Q0, Q1234, plain text'), []);
  assert.deepEqual(questionNumbers(''), []);
  assert.deepEqual(questionNumbers(undefined), []);
});

test('a form counts by its questions and headers; other tools do not count', () => {
  assert.deepEqual(messageNumbers([form(['Q4 Approach', 'Which approach?'], ['Library', 'Q5: Which library?'])]), [4, 5]);
  assert.deepEqual(messageNumbers([{ type: 'tool_use', name: 'Bash', input: { command: 'echo Q40' } }]), []);
  assert.deepEqual(messageNumbers([text('Q2?'), form(['', 'Q3: and?'])]), [2, 3]);
});

test('numbering carries on across turns: Q1-Q3, then Q4-Q5', () => {
  let last = 0;
  assert.equal(questionLine(last), '(From Docket: your next question to the user is Q1.)');
  last = afterMessage(last, [text('Q1. One?\nQ2. Two?\nQ3. Three?')]);
  assert.equal(last, 3);
  assert.equal(questionPart(last), 'next question Q4');
  last = afterMessage(last, [text('Thanks. Q4: four?'), form(['Q5 Pick', 'Q5: Pick one'])]);
  assert.equal(last, 5);
  assert.equal(nextQuestion(last), 6);
});

test('the count never goes back: an answer that refers to an old question, or a summary that restarts at Q1', () => {
  let last = 5;
  last = afterMessage(last, [text('On Q2, the second option: done.')]);
  assert.equal(last, 5);
  last = afterMessage(last, [text('Q1. A question after a context summary that forgot the count')]);
  assert.equal(last, 5, 'Docket still says Q6 next');
  assert.equal(afterMessage(7, []), 7);
  assert.equal(afterMessage(undefined, [text('Q1?')]), 1);
});

test('one stray far-off number is passed over, the rest of the message still counts', () => {
  assert.equal(afterMessage(3, [text('Q4: a?\nQ5: b?\nSee section Q500 of the spec?')]), 5);
  assert.equal(afterMessage(0, [text(`Q${JUMP}: ok?`)]), JUMP);
  assert.equal(afterMessage(0, [text(`Q${JUMP + 1}: ok?`)]), 0);
});

test('the state line on notes names the next question, and alone it still makes a line', () => {
  const at = new Date(2026, 10, 11, 14, 41).getTime();
  assert.match(stateLine({ branch: 'q', question: questionPart(17), at }), /: branch q; next question Q18\.\)$/);
  assert.match(stateLine({ question: questionPart(0), at }), /^\(Docket state at .*: next question Q1\.\)$/);
  assert.equal(stateLine({ at }), '');
});

test('the line on other turns stays out of the chat read back from the transcript', () => {
  assert.ok(DOCKET_BLOCK.test(questionLine(4)));
});

test('every session, a child too, is told to number its questions and that the user may answer by number', () => {
  const dir = path.join(root, 'prompts');
  for (const child of [false, true]) {
    const rules = ruleText(dir, { child });
    assert.ok(rules.includes('# Numbering questions'), `child ${child}`);
    assert.ok(/never starts again at 1/.test(rules));
    assert.ok(/AskUserQuestion/.test(rules) && /answer by number/.test(rules));
  }
});

test('the server keeps the count per session in its saved record and sends it each turn', () => {
  const server = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8');
  assert.ok(server.includes("from './questions.mjs'"));
  assert.ok(/noteQuestions\(s\.id, m\.message\?\.content\)/.test(server), 'live replies');
  assert.ok(/noteQuestions\(id, m\.message\?\.content\)/.test(server), 'transcripts read back');
  assert.ok(server.includes('question: questionPart(state.sessions[s.id]?.lastQ)'), 'the state line');
  assert.ok(server.includes('questionLine(state.sessions[s.id]?.lastQ)'), 'other turns');
  assert.ok(!fs.readFileSync(path.join(root, 'runner.mjs'), 'utf8').includes('questions.mjs'), 'not in the runner');
});
