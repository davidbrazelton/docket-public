// Tests for waits.mjs: wait_until's conditions and the state line on Docket's notes (#749). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { WAITS, parseWait, parsePr, waitWhat, checksOf, prVerdict, sessionVerdict, portVerdict, portAnswers, timeoutLine, nextLook, waitInline, stateLine, branchPr } from '../waits.mjs';
import { ghBranchAnswer } from '../links.mjs';
import { freePorts } from './free-port.mjs';

test('a wait is checked and tidied', () => {
  assert.deepEqual(parseWait({ condition: 'pr_merged', pr: '749' }), { condition: 'pr_merged', minutes: WAITS.defaultMinutes, repo: '', number: 749 });
  assert.deepEqual(parseWait({ condition: 'pr_checks', pr: 'https://github.com/a/b/pull/12', minutes: 5 }), { condition: 'pr_checks', minutes: 5, repo: 'a/b', number: 12 });
  assert.equal(parseWait({ condition: 'pr_closed', pr: '#3', repo: 'o/n' }).repo, 'o/n');
  assert.equal(parseWait({ condition: 'port', port: 4401, minutes: 99999 }).minutes, WAITS.maxMinutes);
  assert.equal(parseWait({ condition: 'session_done', session: 'abc' }).session, 'abc');
  assert.match(parseWait({ condition: 'sleep' }).error, /condition must be/);
  assert.match(parseWait({ condition: 'pr_merged', pr: 'soon' }).error, /pr as a number/);
  assert.match(parseWait({ condition: 'port', port: 70000 }).error, /port/);
  assert.match(parseWait({ condition: 'port', port: 80, host: 'example.com' }).error, /this computer/);
  assert.match(parseWait({ condition: 'session_idle' }).error, /session/);
  assert.equal(parsePr('nope'), null);
});

test('what is waited for, in words', () => {
  assert.equal(waitWhat({ condition: 'pr_merged', number: 5 }), 'pull request #5 to be merged');
  assert.equal(waitWhat({ condition: 'port', port: 4401 }), 'port 4401 to answer');
  assert.equal(waitWhat({ condition: 'session_waiting', session: 'x', title: 'Fix it' }), 'session "Fix it" to wait on the user');
});

test("checks from GitHub's rollup state", () => {
  assert.equal(checksOf({ state: 'SUCCESS' }), 'pass');
  assert.equal(checksOf({ state: 'FAILURE' }), 'fail');
  assert.equal(checksOf({ state: 'ERROR' }), 'fail');
  assert.equal(checksOf({ state: 'PENDING' }), 'pending');
  assert.equal(checksOf(null), '');
});

test('pr_merged: met when merged, and when closed unmerged; open is not yet', () => {
  const c = { condition: 'pr_merged', number: 9, repo: 'o/n' };
  assert.deepEqual(prVerdict(c, { state: 'OPEN', checks: 'pass' }), { met: false, line: 'Pull request #9 (o/n) is still open, checks passed.' });
  assert.deepEqual(prVerdict(c, { state: 'MERGED', checks: '' }), { met: true, line: 'Pull request #9 (o/n) was merged.' });
  assert.equal(prVerdict(c, { state: 'CLOSED' }).met, true);
  assert.match(prVerdict(c, { state: 'CLOSED' }).line, /closed without merging/);
  assert.equal(prVerdict(c, null).error, true);
});

test('pr_closed: merged or closed', () => {
  const c = { condition: 'pr_closed', number: 9 };
  assert.equal(prVerdict(c, { state: 'OPEN' }).met, false);
  assert.equal(prVerdict(c, { state: 'MERGED' }).met, true);
  assert.equal(prVerdict(c, { state: 'CLOSED' }).met, true);
});

test('pr_checks: pass or fail ends it; running or not started waits; none at all ends it after a while', () => {
  const c = { condition: 'pr_checks', number: 9 };
  assert.deepEqual(prVerdict(c, { state: 'OPEN', checks: 'pass' }), { met: true, line: 'Pull request #9 checks passed; it is open.' });
  assert.match(prVerdict(c, { state: 'OPEN', checks: 'fail' }).line, /checks failed/);
  assert.equal(prVerdict(c, { state: 'OPEN', checks: 'pending' }, 10 * 60000).met, false);
  assert.equal(prVerdict(c, { state: 'OPEN', checks: '' }, 1000).met, false);
  assert.deepEqual(prVerdict(c, { state: 'OPEN', checks: '' }, WAITS.noChecksSec * 1000), { met: true, line: 'Pull request #9 has no checks; it is open.' });
  assert.equal(prVerdict(c, { state: 'MERGED', checks: 'pending' }).met, true);
});

test('session_idle, session_done and session_waiting', () => {
  const t = (condition) => ({ condition, session: 's1', title: 'Build it' });
  assert.equal(sessionVerdict(t('session_idle'), 'working').met, false);
  assert.equal(sessionVerdict(t('session_idle'), 'done').met, true);
  assert.equal(sessionVerdict(t('session_idle'), 'waiting').met, true);
  assert.equal(sessionVerdict(t('session_done'), 'done').line, 'Session "Build it" finished its turn and is done.');
  assert.equal(sessionVerdict(t('session_done'), 'waiting').met, false);
  assert.equal(sessionVerdict(t('session_waiting'), 'waiting').line, 'Session "Build it" finished its turn and is waiting on the user.');
  assert.equal(sessionVerdict(t('session_waiting'), 'working').met, false);
  assert.equal(sessionVerdict(t('session_waiting'), 'done').met, true); // it will not come to wait now: said rather than waited out
  assert.equal(sessionVerdict(t('session_done'), 'gone').error, true);
});

test('port: answers once something listens', async () => {
  const [port] = await freePorts(1);
  const c = { condition: 'port', port };
  assert.equal(await portAnswers(port), false);
  assert.deepEqual(portVerdict(c, false), { met: false, line: `Port ${port} does not answer yet.` });
  const srv = net.createServer().listen(port, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  try {
    assert.equal(await portAnswers(port), true);
    assert.deepEqual(portVerdict(c, true), { met: true, line: `Port ${port} answers.` });
  } finally { srv.close(); }
});

test('the wait inside the call looks on its own clock until met or out of its time', async () => {
  let t = 0, looks = 0;
  const opts = { ms: 60000, now: () => t, sleep: async (ms) => { t += ms; } };
  const c = { condition: 'port', port: 1 };
  const met = await waitInline(c, async () => ({ met: ++looks === 4, line: `look ${looks}` }), opts);
  assert.deepEqual([met.met, looks, t], [true, 4, 3 * WAITS.every.port * 1000]);
  t = 0; looks = 0;
  const gave = await waitInline({ condition: 'pr_merged' }, async () => ({ met: false, line: `look ${++looks}` }), opts);
  assert.equal(gave.met, false);
  assert.equal(looks, 1 + Math.floor(60 / WAITS.every.pr)); // a GitHub look a minute: at 0 and 60 seconds
  assert.equal(nextLook({ condition: 'pr_checks' }, 0), WAITS.every.checks * 1000);
  assert.equal(timeoutLine({ condition: 'port', port: 9, minutes: 5 }, 'Port 9 does not answer yet.'), 'Time ran out after 5 min waiting for port 9 to answer. Port 9 does not answer yet.');
});

test("pull requests by branch carry their checks", () => {
  const data = { b0: { pullRequests: { nodes: [{ number: 3, url: 'u', state: 'OPEN', headRefName: 'x', commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] } }] } } };
  assert.equal(ghBranchAnswer([{ repo: 'o/n', branch: 'x' }], data)[0][0].checks, 'pass');
});

test('the state line: branch, pull request, the sessions under it; a part with nothing is left out', () => {
  const at = new Date(2026, 10, 6, 14, 41).getTime();
  const pr = { number: 749, status: 'open', checks: 'pass', branch: 'wait-until' };
  const line = stateLine({ branch: 'wait-until', pr, kids: [{ title: 'Fix the thing', state: 'working' }, { title: 'Ask', state: 'waiting' }], at });
  assert.match(line, /^\(Docket state at 2:41\sPM: branch wait-until; PR #749 open, checks pass; sessions under you: 1 working \("Fix the thing"\), 1 waiting on the user \("Ask"\)\.\)$/);
  assert.match(stateLine({ branch: 'b', at }), /: branch b\.\)$/);
  assert.equal(stateLine({ at }), '');
  assert.match(stateLine({ branch: 'b', pr: { number: 1, status: 'merged' }, at }), /PR #1 merged\.\)$/);
  assert.match(stateLine({ branch: 'b', pr: { number: 1, status: 'open', draft: true }, at }), /PR #1 draft/);
});

test('the state line stays within about 200 characters', () => {
  const kids = Array.from({ length: 8 }, (_, i) => ({ title: `A long session title number ${i} that goes on`, state: i % 2 ? 'working' : 'waiting' }));
  const line = stateLine({ branch: 'feature/COSCRYPTO-1234-a-very-long-branch-name-indeed', pr: { number: 12345, status: 'conflict', checks: 'pending' }, kids });
  assert.ok(line.length <= 200, line.length + ' ' + line);
  assert.match(line, /4 working, 4 waiting on the user|4 working \(/);
});

test("the pull request named is the branch's open one, else its newest", () => {
  const prs = [{ number: 1, status: 'merged', branch: 'b' }, { number: 4, status: 'closed', branch: 'b' }, { number: 9, status: 'open', branch: 'other' }];
  assert.equal(branchPr(prs, 'b').number, 4);
  assert.equal(branchPr([...prs, { number: 2, status: 'open', branch: 'b' }], 'b').number, 2);
  assert.equal(branchPr([], 'b'), null);
});
