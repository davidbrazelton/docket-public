// A decision task marked done without a saved answer is settled (#990): the plan panel lists it under Answered with
// its done note, not under "Decisions waiting on you", and the plan's decisions say when it was done.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPlanStore, decisions, decisionSettled } from '../plans.mjs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const a = page.indexOf('function planDecisionsHtml(p) {'), b = page.indexOf('\n}', a);
assert.ok(a > 0 && b > a, 'planDecisionsHtml has moved');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const qWhen = (at) => (at ? `at ${at}` : '');
const planDecisionsHtml = new Function('esc', 'qWhen', page.slice(a, b + 2) + '\nreturn planDecisionsHtml;')(esc, qWhen);

const counter = (start = 0) => { let n = start; return () => ++n; };
const tasks = [
  { kind: 'decision', title: 'Answer the spec questions', for_user: true },
  { kind: 'decision', title: 'Keep both exports?', for_user: true, options: ['Keep both', 'XLSX only'] },
  { kind: 'decision', title: 'Rename the tab?', for_user: true },
];

test('a decision set done with only a note is settled, and says when and why', () => {
  const s = createPlanStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'plan-dec-')) });
  const p = s.create({ title: 'Scope', tasks, coordinator: 'c1', nextQ: counter() });
  s.update(p.id, 'T1', { state: 'done', note: 'All questions answered by the user.' }, 'c1');
  s.answerDecision(p.id, 2, 'Keep both');
  const back = s.read(p.id), d = decisions(back);
  assert.deepEqual(d.map((x) => [x.q, x.state, x.answer, x.note]), [[1, 'done', '', 'All questions answered by the user.'], [2, 'done', 'Keep both', ''], [3, 'open', '', '']]);
  assert.match(d[0].doneAt, /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.equal(d[2].doneAt, '');
  assert.deepEqual(back.tasks.map(decisionSettled), [true, true, false]);

  const html = planDecisionsHtml(back), wait = html.indexOf('Decisions waiting on you'), ans = html.indexOf('Answered');
  assert.match(html, /Decisions waiting on you · 1/);
  assert.match(html, /Answered · 2/);
  const waiting = html.slice(wait, ans), answered = html.slice(ans);
  assert.match(waiting, /Rename the tab\?/);
  assert.doesNotMatch(waiting, /spec questions/);
  assert.match(answered, /spec questions.*<b>All questions answered by the user\.<\/b> · at \d{4}-/);
  assert.match(answered, /<b>Keep both<\/b>/);

  // done with no note says "done"; an answer given afterwards still saves
  s.update(p.id, 'T3', { state: 'done' }, 'c1');
  assert.doesNotMatch(planDecisionsHtml(s.read(p.id)), /waiting on you/);
  assert.match(planDecisionsHtml(s.read(p.id)), /Rename the tab\?.*<b>done<\/b>/);
  assert.equal(s.answerDecision(p.id, 1, 'Go with the spec').task.answer, 'Go with the spec');
});
