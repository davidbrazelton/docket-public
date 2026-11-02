// Tests for reports.mjs: whether a child's finished turn wakes its parent. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endsAsking, endsWithNextSteps, endsWaiting, awaitingAnswer, waitingOnUser, closeRefusal, reportRoute } from '../reports.mjs';

test('a reply ending in a question is waiting on the user', () => {
  assert.equal(endsAsking('I read the file.\n\nShould I delete the old copy?'), true);
  assert.equal(endsAsking('Done.\n\nWant me to open the pull request too?\n'), true);
});

test('a numbered question with option bullets under it counts', () => {
  const reply = 'The build works.\n\n1. **Which colour should the button be?**\n   - **Why it matters**: it shows on every page.\n   - **Blue (recommended)**: matches the rest.\n   - **Green**: stands out more.';
  assert.equal(endsAsking(reply), true);
  assert.equal(endsAsking(reply + '\n\n*Terms used: deploy. Say "define" and I\'ll explain any of them.*'), true);
});

test('a reply ending in a result wakes the parent as before', () => {
  assert.equal(endsAsking('Is the old test still needed? It was not, so I removed it.\n\nPull request #12 is open and the tests pass.'), false);
  assert.equal(endsAsking('Done:\n\n- Fixed the list\n- Added a test'), false);
  assert.equal(endsAsking(''), false);
});

test('an open form or permission ask is waiting on the user', () => {
  assert.equal(waitingOnUser({ pendingAsks: new Map([['r', {}]]) }, 'Working on it.'), true);
  assert.equal(waitingOnUser({ pendingAsks: new Map() }, 'All done.'), false);
});

test('closeRefusal: only an idle own child that is not waiting on the user can be closed', () => {
  const ok = { callerId: 'p', rec: { reportsTo: 'p' }, live: null, reply: 'Done. The file is at C:/x.txt.', busy: false };
  assert.equal(closeRefusal(ok), '');
  assert.match(closeRefusal({ ...ok, rec: { reportsTo: 'other' } }), /not a session you started/);
  assert.match(closeRefusal({ ...ok, rec: {} }), /not a session you started/);
  assert.match(closeRefusal({ ...ok, rec: { reportsTo: 'p', archived: true } }), /already archived/);
  assert.match(closeRefusal({ ...ok, busy: true }), /still working/);
  assert.match(closeRefusal({ ...ok, reply: 'Which folder should I use?' }), /waiting on the user/);
  assert.match(closeRefusal({ ...ok, live: { pendingAsks: new Map([['a', 1]]) } }), /waiting on the user/);
});

test('a reply ending with a next-steps list is waiting on the user', () => {
  const steps = 'Pull request #460 is open and the tests pass.\n\nNext steps:\n1. **Say merge** and I will merge pull request #460.';
  assert.equal(endsWithNextSteps(steps), true);
  assert.equal(endsWithNextSteps('Done.\n\n**Next steps**\n\n- **You review the page** so the wording is right.\n- **I deploy it** once you say so.'), true);
  assert.equal(endsWithNextSteps('Done.\n\n1. **Say merge** and I will merge it.\n2. **Tell me** which desk gets it next.'), true);
  assert.equal(endsWaiting(steps), true);
  assert.equal(endsWaiting('I read the file.\n\nShould I delete the old copy?'), true);
});

test('the Terms used footer after a next-steps list still counts', () => {
  const steps = 'Built.\n\nNext steps:\n1. **Say merge** and I will merge pull request #460.';
  assert.equal(endsWithNextSteps(steps + '\n\n> *Terms used: pull request, merge. Say "define" and I\'ll explain any of them.*'), true);
  assert.equal(endsWithNextSteps(steps + '\n\n*Terms used: merge. Say "define" and I\'ll explain any of them.*'), true);
});

test('a plain statement or a list of what was done is not waiting', () => {
  assert.equal(endsWaiting('Pull request #12 is merged and the tests pass.'), false);
  assert.equal(endsWaiting('Done:\n\n- Fixed the list\n- Added a test'), false);
  assert.equal(endsWaiting('Next steps were all done:\n\nThe page is live.'), false);
  assert.equal(endsWaiting(''), false);
});

test('awaitingAnswer: the latest reply waits and nothing was sent after it', () => {
  const you = (text) => ({ type: 'user', message: { content: [{ type: 'text', text }] } });
  const reply = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
  const tool = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }] } };
  const result = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] } };
  assert.equal(awaitingAnswer([you('Fix it'), tool, result, reply('Fixed.\n\nShould I open the pull request?')]), true);
  assert.equal(awaitingAnswer([you('Fix it'), reply('Fixed.\n\nNext steps:\n1. **Say merge** and I will merge it.')]), true);
  assert.equal(awaitingAnswer([you('Fix it'), reply('Fixed. The pull request is merged.')]), false);
  assert.equal(awaitingAnswer([reply('Which folder?'), you('C:/Work')]), false); // answered, reply not in yet
  assert.equal(awaitingAnswer([reply('Which folder?'), you('<system-reminder>x</system-reminder>')]), true);
  assert.equal(awaitingAnswer([reply('Which folder?'), { ...reply('Done.'), isSidechain: true }]), true);
  assert.equal(awaitingAnswer([]), false);
});

test('closeRefusal also leaves a session whose reply ends with next steps', () => {
  const ok = { callerId: 'p', rec: { reportsTo: 'p' }, live: null, reply: 'Done.', busy: false };
  assert.match(closeRefusal({ ...ok, reply: 'Built.\n\nNext steps:\n1. **Say merge** and I will merge pull request #460.' }), /waiting on the user/);
  assert.equal(waitingOnUser({}, 'Built.\n\nNext steps:\n1. **Say merge** and I will merge pull request #460.'), false); // a parent is still woken
});

test('a finished turn reports to the parent when no other session sent the work', () => {
  assert.deepEqual(reportRoute({ reportsTo: 'p' }), { to: 'p', waiting: false, sent: false, noteTo: null, clearReplyTo: false });
  assert.deepEqual(reportRoute({ reportsTo: 'p', replyTo: 'p' }), { to: 'p', waiting: false, sent: false, noteTo: null, clearReplyTo: true });
  assert.equal(reportRoute({}).to, null);
});

test('work sent by another session reports to the sender, and the parent gets a note', () => {
  assert.deepEqual(reportRoute({ reportsTo: 'p', replyTo: 's' }), { to: 's', waiting: false, sent: true, noteTo: 'p', clearReplyTo: true });
  assert.deepEqual(reportRoute({ replyTo: 's' }), { to: 's', waiting: false, sent: true, noteTo: null, clearReplyTo: true }); // a top-level session
});

test('a turn waiting on the user gives the sender a note and keeps the reply-to', () => {
  assert.deepEqual(reportRoute({ reportsTo: 'p', replyTo: 's', waiting: true }), { to: 's', waiting: true, sent: true, noteTo: null, clearReplyTo: false });
  assert.deepEqual(reportRoute({ reportsTo: 'p', waiting: true }), { to: 'p', waiting: true, sent: false, noteTo: null, clearReplyTo: false });
});
