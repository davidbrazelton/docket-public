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

test('the Plan section shows for members; the row badge stays the coordinator\'s', () => {
  assert.match(page, /S\.plans\.plans\.filter\(\(p\) => \(p\.members \|\| p\.holders\)\.includes\(id\)\)/);
  assert.match(page, /const ownPlan = \(id\) => S\.plans\.folder \? [^:]+: S\.plans\.plans\.find\(\(p\) => p\.coordinator === id\);/);
});

test('in the Plan section a session\'s own steps show and are marked even when done, and their phase does not fold itself', () => {
  assert.match(page, /const pass = \(t\) => base\(t\) \|\| mine\(t\) \|\|/);
  assert.match(page, /t\.holder === me && 'mine'\]/);
  assert.match(page, /const auto = complete && !u\.done && !ph\.steps\.some\(mine\)/);
});
