// Tests for the setup wizard's sign-in step: one button, bottom right, makes the next move. Run with: npm test
// signinAction() lives inside companyWizard in index.html; it is read out of the page and run against a made-up w.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.indexOf('    function signinAction() {');
const end = page.indexOf('    function buttons() {');
assert.ok(start > 0 && end > start, 'signinAction has moved out of companyWizard');
const actionOf = (w) => new Function('w', page.slice(start, end) + '\nreturn signinAction();')({ code: '', si: null, ...w });
const wizard = page.slice(page.indexOf('function companyWizard('), page.indexOf('const signinLink = '));
const stepBody = page.slice(page.indexOf('    function claudeSignin() {'), start); // what shows above the bottom row

test('Claude: Sign in first, then Check code, which turns on only once a code is pasted', () => {
  assert.deepEqual(actionOf({ kind: 'claude' }).slice(0, 2), ['login', 'Sign in']);
  assert.deepEqual(actionOf({ kind: 'claude', si: { url: 'u' } }), ['code', 'Check code', 'w-check-code', false]);
  assert.equal(actionOf({ kind: 'claude', si: { url: 'u' }, code: ' abc ' })[3], true);
  assert.deepEqual(actionOf({ kind: 'claude', already: { email: 'a@b' } }).slice(0, 2), ['login', 'Sign in']);
});

test('Bedrock: Check and sign in, then nothing to press while AWS finishes on its own', () => {
  assert.deepEqual(actionOf({ kind: 'bedrock' }).slice(0, 2), ['aws', 'Check and sign in']);
  assert.equal(actionOf({ kind: 'bedrock', si: { url: 'u' } }), null);
});

test('busy, signed in, or unable to sign in here: the button is a plain Next', () => {
  assert.equal(actionOf({ kind: 'claude', si: { busy: 'x' } }), null);
  assert.equal(actionOf({ kind: 'claude', signedIn: true }), null);
  assert.equal(actionOf({ kind: 'claude', forced: 'no' }), null);
});

test('no sign-in button sits in the middle of the step any more', () => {
  for (const a of ['code', 'login', 'aws', 'keep']) assert.ok(!stepBody.includes(`data-w="${a}"`),`a data-w="${a}" button is still in the step's body`);
  assert.ok(!page.includes("'w-finish'") && !/>Finish</.test(wizard), 'the old Finish button or its tip is back');
});

test('Enter in a box presses the one main button', () => {
  assert.match(wizard, /e\.key === 'Enter'[^\n]*\[data-main\]:not\(\[disabled\]\)/);
});
