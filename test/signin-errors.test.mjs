// Tests for spotting a turn that failed on its sign-in, and the periodic sign-in recheck. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signInFailure, retryText, recheckSignIns } from '../signin-errors.mjs';

// What Claude Code says on Bedrock once the AWS single sign-on token has run out (seen 2026-10-30).
const AWS_SSO = "Could not load AWS credentials · Token is expired. To refresh this SSO session run 'aws sso login' with the corresponding profile.";

test('a Bedrock turn that failed on expired AWS credentials is a sign-in failure', () => {
  assert.equal(signInFailure(AWS_SSO, true), true);
  for (const t of ['ExpiredToken: The security token included in the request is expired', 'The SSO session associated with this profile has expired or is otherwise invalid',
    'The security token included in the request is expired', 'Error: Token is expired', 'Run aws sso login to refresh'])
    assert.equal(signInFailure(t, true), true, t);
});

test('the AWS wording only counts on Bedrock', () => {
  assert.equal(signInFailure(AWS_SSO, false), false);
  assert.equal(signInFailure('ExpiredToken', false), false);
});

test('the Claude sign-in failures still count, on Bedrock or not', () => {
  for (const b of [false, true]) {
    assert.equal(signInFailure('Invalid API key · Please run /login', b), true);
    assert.equal(signInFailure('Not logged in', b), true);
    assert.equal(signInFailure('Failed to authenticate. API Error: 401', b), true);
  }
});

test('other errors are not sign-in failures', () => {
  for (const t of ['', undefined, 'API Error: 529 Overloaded', 'error_max_turns', 'Prompt is too long'])
    assert.equal(signInFailure(t, true), false, String(t));
});

test('the message to send again is the last one sent', () => {
  const events = [{ k: 'user', text: 'first' }, { k: 'text', text: 'reply' }, { k: 'user', text: '  fix the build \n' }, { k: 'error', text: AWS_SSO, login: true }];
  assert.equal(retryText(events), 'fix the build');
  assert.equal(retryText([{ k: 'text', text: 'hi' }]), '');
  assert.equal(retryText(undefined), '');
});

test('the recheck reports only the companies whose sign-in changed', async () => {
  const cache = new Map([['a', true], ['b', true], ['c', false]]);
  const answers = { a: true, b: false, c: true, d: false };
  const changed = [];
  await recheckSignIns(['a', 'b', 'c', 'd'], (c) => cache.get(c),
    async (c) => { cache.set(c, answers[c]); return answers[c]; }, // a fake auth check that stores its answer, as authInfo does
    (c, signedIn) => changed.push([c, signedIn]));
  assert.deepEqual(changed, [['b', false], ['c', true], ['d', false]]);
});

test('a check that fails is skipped, and the rest still run', async () => {
  const changed = [];
  await recheckSignIns(['a', 'b'], () => true, async (c) => { if (c === 'a') throw new Error('aws not found'); return false; }, (c, s) => changed.push([c, s]));
  assert.deepEqual(changed, [['b', false]]);
});
