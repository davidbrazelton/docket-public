// A task session keeps the Plan section in its details after its task is done or dropped (#941): the plan summary
// carries members (every session that held a task) beside holders (sessions holding an open task, which the plan's
// motion and anything counting working sessions still use).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const a = server.indexOf('function plansSummary(client)'), b = server.indexOf('function planDetail(client', a);
assert.ok(a > 0 && b > a, 'plansSummary has moved');
const summary = server.slice(a, b);
const field = (name) => {
  const m = summary.match(new RegExp(`\\b${name}: (\\[\\.\\.\\.new Set\\(.*?\\)\\])`));
  assert.ok(m, `plansSummary has no ${name} field`);
  return new Function('p', `return ${m[1]};`);
};
const task = (id, state, holder = '') => ({ id, state, holder });
const plan = { tasks: [task('T1', 'claimed', 'open-1'), task('T2', 'done', 'done-1'), task('T3', 'dropped', 'drop-1'), task('T4', 'open'), task('T5', 'done', 'open-1'), task('T6', 'sent_back', 'back-1')] };

test('holders are still only the sessions holding a task that is not done or dropped', () => {
  assert.deepEqual(field('holders')(plan), ['open-1', 'back-1']);
});

test('members are every session that held a task, done and dropped ones too, each once', () => {
  assert.deepEqual(field('members')(plan), ['open-1', 'done-1', 'drop-1', 'back-1']);
});

test('the Plan section shows for members and the sessions under them; the row badge stays the coordinator\'s', () => {
  assert.match(page, /const ties = new Map\(S\.plans\.plans\.map\(\(p\) => \[p\.id, planTie\(p, id\)\]\)/);
  assert.match(page, /planHtml\(p, id, ctx, ties\.get\(p\.id\) \?\? id\)/);
  assert.match(page, /const ownPlan = \(id\) => S\.plans\.folder \? [^:]+: S\.plans\.plans\.find\(\(p\) => p\.coordinator === id\);/);
});

test('in the Plan section a session\'s own steps show and are marked even when done, and their phase does not fold itself', () => {
  assert.match(page, /const pass = \(t\) => base\(t\) \|\| mine\(t\) \|\|/);
  assert.match(page, /!!mark && t\.holder === mark && 'mine'\]/);
  assert.match(page, /const auto = complete && !u\.done && !ph\.steps\.some\(mine\)/);
});

// Sub-sessions (#1282): a session under a task session or the coordinator shows the plan too.
const tieSrc = page.match(/function planTie\(p, id, parentOf = parentOfRow\) \{[\s\S]*?\n\}/);
assert.ok(tieSrc, 'planTie has moved');
const planTie = new Function(`${tieSrc[0].replace(' = parentOfRow', '')}; return planTie;`)();
const parents = { kid: 'holder', grand: 'kid', helper: 'coord', deep: 'helper', bkid: 'both', both: 'holder', donekid: 'done-1', loopA: 'loopB', loopB: 'loopA', stray: 'nobody' };
const up = (id) => parents[id] || null;
const tied = { coordinator: 'coord', holders: ['holder', 'both'], members: ['holder', 'both', 'done-1'] };

test('a session holding a task marks its own, even under another task session', () => {
  assert.equal(planTie(tied, 'holder', up), 'holder');
  assert.equal(planTie(tied, 'both', up), 'both');
  assert.equal(planTie(tied, 'bkid', up), 'both');
});

test('children and grandchildren of a task session mark that session\'s task, a finished one too', () => {
  assert.equal(planTie(tied, 'kid', up), 'holder');
  assert.equal(planTie(tied, 'grand', up), 'holder');
  assert.equal(planTie(tied, 'donekid', up), 'done-1');
});

test('under the coordinator with no task session between, the plan shows with nothing marked', () => {
  assert.equal(planTie(tied, 'coord', up), '');
  assert.equal(planTie(tied, 'helper', up), '');
  assert.equal(planTie(tied, 'deep', up), '');
});

test('a session with no tie to the plan, or caught in a parent loop, shows no plan', () => {
  assert.equal(planTie(tied, 'stray', up), null);
  assert.equal(planTie(tied, 'loopA', up), null);
  assert.equal(planTie({ coordinator: 'coord', holders: ['holder'] }, 'kid', up), 'holder');
});

test('rows mark the tied session\'s steps, while "open now" stays the session whose details these are', () => {
  assert.match(page, /const mine = \(t\) => !!mark && t\.holder === mark;/);
  assert.match(page, /planRowHtml\(t, p, me, u, v, depth\(t\), mark\)/);
});
