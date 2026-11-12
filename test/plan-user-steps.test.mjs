// Plans (#652): steps only the user can do ("Owner: the user"), and tasks waiting on something outside Docket that
// is not the user ("waiting outside Docket" with a "Waits on" line), both kept in the plan file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlan, formatPlan, readyTasks, sessionReady, userSteps, whyNoneReady, createPlanStore, decisions } from '../plans.mjs';
import { answersIn } from '../questions.mjs';
import { parseChecklist } from '../plan-folder.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plans-user-'));
const fileOf = (id) => id + '.md';
const tasks = [
  { kind: 'build', title: 'Build the webhook' },
  { kind: 'decision', title: 'Merge the pull request', for_user: true, after: [1] },
  { kind: 'build', title: 'Send the first text', after: [2] },
];

test("a user's step is kept in the file as its owner and reads back the same", () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'Hub', tasks, coordinator: 'c1' });
  const text = fs.readFileSync(p.file, 'utf8');
  assert.match(text, /^- \[ \] T2 Merge the pull request\n {2}- Kind: decision\n {2}- Owner: the user\n {2}- Question: Q1\n {2}- State: open\n {2}- After: T1$/m);
  assert.equal((text.match(/Owner:/g) || []).length, 1);
  const back = s.read(p.id);
  assert.deepEqual(back.tasks.map((t) => t.forUser), [false, true, false]);
  assert.equal(formatPlan(back, fileOf), formatPlan(parsePlan(formatPlan(back, fileOf)), fileOf));
});

test("no session claims a user's step; the next task skips it and the coordinator marks it done", () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'Hub', tasks, coordinator: 'c1' });
  s.claim(p.id, 'T1', 'w1');
  s.update(p.id, 'T1', { state: 'done' }, 'w1');
  const now = s.read(p.id);
  assert.deepEqual(readyTasks(now).map((t) => t.id), ['T2']);
  assert.deepEqual(sessionReady(now), []);
  assert.deepEqual(userSteps(now).map((t) => t.id), ['T2']);
  assert.match(whyNoneReady(now), /T2 is the user's to do/);
  assert.throws(() => s.claim(p.id, 'T2', 'w2'), /T2 is the user's to do, so no session claims it/);
  assert.equal(s.claim(p.id, null, 'w2').task, null);
  const r = s.update(p.id, 'T2', { state: 'done', note: 'The user merged it.' }, 'c1');
  assert.deepEqual(r.nowReady.map((t) => t.id), ['T3']);
  assert.deepEqual(userSteps(r.plan), []);
});

test("the coordinator can make a task the user's step or give it back, and no one else can", () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'Hub', tasks: [{ kind: 'build', title: 'A' }, { kind: 'build', title: 'B' }], coordinator: 'c1' });
  s.claim(p.id, 'T1', 'w1');
  assert.throws(() => s.update(p.id, 'T1', { forUser: true }, 'w1'), /Only the plan's coordinator says whose step T1 is/);
  assert.throws(() => s.update(p.id, 'T1', { forUser: true }, 'c1'), /held by w1; set it open first/);
  assert.equal(s.update(p.id, 'T1', { state: 'open', forUser: true }, 'c1').task.forUser, true);
  assert.match(fs.readFileSync(p.file, 'utf8'), /^- \[ \] T1 A\n {2}- Kind: build\n {2}- Owner: the user\n/m);
  assert.equal(s.update(p.id, 'T1', { forUser: false }, 'c1').task.forUser, false);
  assert.doesNotMatch(fs.readFileSync(p.file, 'utf8'), /Owner:/);
});

test('waiting outside Docket says on what, is not waiting on the user, and clears when the task moves on', () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'Hub', tasks: [{ kind: 'build', title: 'Text from the Hub number' }, { kind: 'test', title: 'Check', after: [1] }], coordinator: 'c1' });
  assert.throws(() => s.update(p.id, 'T1', { state: 'waiting_outside' }, 'c1'), /Say what T1 waits on outside Docket/);
  assert.throws(() => s.update(p.id, 'T1', { waitsOn: 'Quo' }, 'c1'), /only with the state waiting_outside/);
  const r = s.update(p.id, 'T1', { state: 'waiting_outside', waitsOn: "Quo to issue the Hub's phone number" }, 'c1');
  assert.equal(r.task.state, 'waiting_outside');
  const text = fs.readFileSync(p.file, 'utf8');
  assert.match(text, /^ {2}- State: waiting outside Docket since .*\n {2}- Waits on: Quo to issue the Hub's phone number$/m);
  const back = s.read(p.id);
  assert.equal(back.tasks[0].state, 'waiting_outside');
  assert.equal(back.tasks[0].waitsOn, "Quo to issue the Hub's phone number");
  assert.equal(formatPlan(back, fileOf), text.replace(/\r\n/g, '\n'));
  assert.match(whyNoneReady(back), /T1 is waiting outside Docket on Quo to issue the Hub's phone number/);
  assert.doesNotMatch(whyNoneReady(back), /waiting on the user/);
  assert.throws(() => s.claim(p.id, 'T1', 'w1'), /T1 is waiting outside Docket on Quo/);
  // The note can change what it waits on while it still waits.
  assert.equal(s.update(p.id, 'T1', { waitsOn: 'Quo, due Friday' }, 'c1').task.waitsOn, 'Quo, due Friday');
  // When it arrives the task goes back to open, and the line goes.
  s.update(p.id, 'T1', { state: 'open' }, 'c1');
  assert.equal(s.read(p.id).tasks[0].waitsOn, '');
  assert.doesNotMatch(fs.readFileSync(p.file, 'utf8'), /Waits on:/);
  assert.equal(s.claim(p.id, null, 'w1').task.id, 'T1');
  // A session holding a task can set it waiting outside, and carry on later.
  s.update(p.id, 'T1', { state: 'waiting_outside', waitsOn: 'the vendor' }, 'w1');
  assert.equal(s.claim(p.id, 'T1', 'w1').already, true);
  assert.equal(s.update(p.id, 'T1', { state: 'claimed' }, 'w1').task.waitsOn, '');
});

test('a plan file from before these lines reads and writes back unchanged, with no user steps and no outside waits', () => {
  const old = '# Old\n\n- Plan: p-0c0c0c\n- Coordinator: c1\n\n## Tasks\n\n- [x] T1 One\n  - Kind: build\n  - State: done since 2026-11-01 09:00\n- [ ] T2 Two\n  - State: waiting on the user since 2026-11-01 10:00\n  - Held by: w1 (Worker)\n  - After: T1\n';
  const p = parsePlan(old);
  assert.deepEqual(p.tasks.map((t) => [t.state, t.forUser, t.waitsOn]), [['done', false, ''], ['waiting_on_user', false, '']]);
  assert.equal(formatPlan(p, fileOf), old);
});

test("the read-only plan folder reads a user's step and an outside wait from a Docket plan file", () => {
  const dir = tmp();
  const f = path.join(dir, 'p-1d1d1d-hub.md');
  fs.writeFileSync(f, '# Hub\n\n## Tasks\n\n- [ ] T1 Merge it\n  - Owner: the user\n- [ ] T2 Text\n  - State: waiting outside Docket since 2026-11-04 10:00\n  - Waits on: Quo\n');
  const p = parseChecklist(fs.readFileSync(f, 'utf8'), f);
  assert.deepEqual(p.items.map((i) => [i.id, i.state, i.forUser, i.waitsOn]), [['T1', 'open', true, ''], ['T2', 'waiting_outside', false, 'Quo']]);
});

test("the coordinator setting a user's step done does not record itself as the one who did it", () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'Hub', tasks: [{ kind: 'decision', title: 'Merge it', for_user: true }], coordinator: 'c1' });
  const t = s.update(p.id, 'T1', { state: 'done' }, 'c1').task;
  assert.equal(t.state, 'done');
  assert.equal(t.holder, '');
});

// ---------- decisions asked in the chat, and their answers (#929) ----------
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const counter = (start = 0) => { let n = start; return () => ++n; };
const decisionTasks = [
  { kind: 'build', title: 'Split the exporter' },
  { kind: 'decision', title: 'Keep the CSV export next to the new XLSX one?', for_user: true, options: ['Keep both', 'XLSX only'] },
  { kind: 'build', title: 'Wire the writer', after: [2] },
];

test("a user's decision takes the coordinator's next question number, and keeps its options in the file", () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'Billing', tasks: decisionTasks, coordinator: 'c1', nextQ: counter(6) });
  assert.deepEqual(p.tasks.map((t) => t.q), [0, 7, 0]);
  const text = fs.readFileSync(p.file, 'utf8');
  assert.match(text, /^- \[ \] T2 Keep the CSV export next to the new XLSX one\?\n {2}- Kind: decision\n {2}- Owner: the user\n {2}- Question: Q7\n {2}- Options: Keep both \| XLSX only\n {2}- State: open$/m);
  const back = s.read(p.id);
  assert.deepEqual(decisions(back), [{ q: 7, id: 'T2', title: 'Keep the CSV export next to the new XLSX one?', options: ['Keep both', 'XLSX only'], answer: '', answeredAt: '', state: 'open', note: '', doneAt: '' }]);
  assert.equal(formatPlan(back, fileOf), formatPlan(parsePlan(formatPlan(back, fileOf)), fileOf));
  // more decisions count on; one already asked by number keeps it; a number twice is refused
  const r = s.addTasks(p.id, [{ kind: 'decision', title: 'Date format?', for_user: true }, { kind: 'decision', title: 'Flag first?', for_user: true, q: 12 }], 'c1', counter(7));
  assert.deepEqual(r.added.map((t) => t.q), [8, 12]);
  assert.throws(() => s.addTasks(p.id, [{ kind: 'decision', title: 'Again?', for_user: true, q: 7 }], 'c1', counter(20)), /Q7 is already a decision in this plan \(T2\)/);
  // only a user's decision has options or a number
  assert.throws(() => s.addTasks(p.id, [{ kind: 'build', title: 'Pick', options: ['A', 'B'] }], 'c1'), /only a decision for the user has/);
  assert.equal(s.addTasks(p.id, [{ kind: 'decision', title: 'A session decides', for_user: false }], 'c1', counter(30)).added[0].q, 0);
});

test("the user's answer is saved on its decision, which is done and frees the next task; a second answer replaces it", () => {
  const dir = tmp(), s = createPlanStore({ dir });
  const p = s.create({ title: 'Billing', tasks: decisionTasks, coordinator: 'c1', nextQ: counter(6) });
  s.claim(p.id, 'T1', 'w1'); s.update(p.id, 'T1', { state: 'done' }, 'w1');
  const r = s.answerDecision(p.id, 7, 'Keep both');
  assert.equal(r.task.id, 'T2'); assert.equal(r.task.state, 'done'); assert.equal(r.task.answer, 'Keep both'); assert.equal(r.had, '');
  assert.match(r.task.answeredAt, /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.deepEqual(r.nowReady.map((t) => t.id), ['T3']);
  assert.equal(r.task.holder, '', 'the user answered, not a session');
  // a new reader of the same folder (a coordinator after a context summary, or one that took the plan over) sees it
  const fresh = createPlanStore({ dir }).read(p.id);
  assert.deepEqual(decisions(fresh).map((d) => [d.q, d.answer, d.state]), [[7, 'Keep both', 'done']]);
  assert.match(fs.readFileSync(p.file, 'utf8'), /^- \[x\] T2 .*\n(?: {2}- .*\n)* {2}- Answer: Keep both\n {2}- Answered: \d{4}-/m);
  const again = s.answerDecision(p.id, 7, 'XLSX only,\nbut keep the CSV for a month');
  assert.equal(again.had, 'Keep both');
  assert.equal(s.read(p.id).tasks[1].answer, 'XLSX only,\nbut keep the CSV for a month');
  assert.throws(() => s.answerDecision(p.id, 9, 'yes'), /no decision Q9/);
  assert.throws(() => s.answerDecision(p.id, 7, '  '), /cannot be empty/);
});

test('the coordinator saves an answer given another way, makes a task a decision, and only it can', () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'Billing', tasks: [...decisionTasks, { kind: 'decision', title: 'Rename the tab?', after: [1] }], coordinator: 'c1', nextQ: counter(6) });
  assert.throws(() => s.update(p.id, 'T2', { answer: 'Keep both' }, 'w1'), /Only the session holding T2/);
  s.claim(p.id, 'T1', 'w1');
  assert.throws(() => s.update(p.id, 'T1', { answer: 'x' }, 'w1'), /Only the plan's coordinator sets the options or the answer/);
  const t = s.update(p.id, 'T2', { answer: 'Keep both', note: 'Said so in a call.' }, 'c1').task;
  assert.deepEqual([t.state, t.answer], ['done', 'Keep both']);
  assert.throws(() => s.update(p.id, 'T3', { options: ['A'] }, 'c1'), /T3 is not a decision for the user/);
  // T4 was a session's decision; made the user's, it gets the next number and its options
  const u = s.update(p.id, 'T4', { forUser: true, options: ['Rename it', 'Leave it'], nextQ: counter(9) }, 'c1').task;
  assert.deepEqual([u.q, u.options], [10, ['Rename it', 'Leave it']]);
  s.update(p.id, 'T4', { state: 'dropped', note: 'Out of scope.' }, 'c1');
  assert.throws(() => s.answerDecision(p.id, 10, 'Leave it'), /no decision Q10/);
});

test('answers given by number in a message are found, and other mentions of a number are not', () => {
  assert.deepEqual(answersIn('Q7 keep both, Q9 flag it'), [{ q: 7, answer: 'keep both' }, { q: 9, answer: 'flag it' }]);
  assert.deepEqual(answersIn('Q7: Keep both'), [{ q: 7, answer: 'Keep both' }]);
  assert.deepEqual(answersIn('**Q7** yes\n- Q8: ISO dates'), [{ q: 7, answer: 'yes' }, { q: 8, answer: 'ISO dates' }]);
  assert.deepEqual(answersIn('Thanks. Q8 ISO please'), [{ q: 8, answer: 'ISO please' }]);
  assert.deepEqual(answersIn('I think Q7 is hard, tell me more'), []);
  assert.deepEqual(answersIn('Q7 keep, Q7 drop it'), [{ q: 7, answer: 'drop it' }]);
  assert.deepEqual(answersIn('Q7'), []);
});

test('the server saves typed, button and form answers, lists decisions in plan_read, and the rules say not to ask again', () => {
  const server = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8');
  assert.ok(/saveAnswers\(s, answersIn\(text\)\)/.test(server), "the person's own message");
  assert.ok(/isForm && allow && by !== 'pilot'\) saveAnswers\(/.test(server), 'form answers');
  assert.ok(server.includes('Decisions for the user (asked in the chat by number'), 'plan_read lists them');
  assert.ok(/nextQ: \(\) => takeQuestion\(parent\.id/.test(server), "numbers from the coordinator's counter");
  assert.ok(server.includes('keepQuestionsAbove(parent.id, maxQuestion(p))'), 'a new coordinator counts on past the plan');
  const rules = fs.readFileSync(path.join(root, 'prompts', 'optional', 'plans.md'), 'utf8');
  assert.ok(/never ask an answered decision again/.test(rules) && /"Q7 answered: Keep both"/.test(rules));
  const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(page.includes('function decorateDecisions()') && page.includes('function planDecisionsHtml(p)'));
  assert.ok(page.includes('.qask:not(.qanswered)'), 'open decisions join the card strip');
});
