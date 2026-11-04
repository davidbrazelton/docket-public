// Tests for reports.mjs: whether a child's finished turn wakes its parent. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endsAsking, endsWithNextSteps, endsWaiting, awaitingAnswer, waitingOnUser, closeRefusal, reportRoute, turnStarter, wakeDecision, readyReports, heldNote, freedReply } from '../reports.mjs';

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

test('turnStarter: typed or button-pressed turns are the person\'s, sent work and Docket wake-ups are not', () => {
  assert.equal(turnStarter({}), 'person');
  assert.equal(turnStarter({ from: 'session' }), 'session');
  assert.equal(turnStarter({ system: true }), 'docket');
  assert.equal(turnStarter({ system: true, byPerson: true }), 'person'); // the plan notice: the person pressed it
});

test('wakeDecision: the limit holds reports from sessions keeping each other busy', () => {
  assert.deepEqual(wakeDecision({ autoWakes: 3, reports: [{ childId: 'c' }], limit: 8 }), { wake: true, autoWakes: 4 });
  assert.deepEqual(wakeDecision({ autoWakes: 8, reports: [{ childId: 'c' }], limit: 8 }), { wake: false, autoWakes: 8 });
});

test('wakeDecision: a child turn the person started wakes the parent at the limit and starts the count again', () => {
  assert.deepEqual(wakeDecision({ autoWakes: 8, reports: [{ childId: 'c', byPerson: true }], limit: 8 }), { wake: true, autoWakes: 0 });
  assert.deepEqual(wakeDecision({ autoWakes: 8, reports: [{ childId: 'a' }, { childId: 'c', byPerson: true }], limit: 8 }), { wake: true, autoWakes: 0 });
});

test('freed plan tasks wake an idle coordinator through the same limit', () => {
  const freed = { kind: 'plan', planId: 'p-1', title: 'Shop', tasks: [{ id: 'T10', title: 'Outbox' }] };
  assert.deepEqual(readyReports([freed], () => false), [freed]);
  assert.deepEqual(wakeDecision({ autoWakes: 2, reports: [freed], limit: 8 }), { wake: true, autoWakes: 3 });
  assert.equal(wakeDecision({ autoWakes: 8, reports: [freed], limit: 8 }).wake, false);
});

test('readyReports: tasks freed mid-turn wait for that turn\'s report and go with it', () => {
  const freed = { kind: 'plan', planId: 'p-1', title: 'Shop', tasks: [{ id: 'T10', title: 'Outbox' }], waitFor: 'c' };
  assert.deepEqual(readyReports([freed], (id) => id === 'c'), []); // c is still working
  const report = { childId: 'c', title: 'Child' };
  assert.deepEqual(readyReports([freed, report], (id) => id === 'c'), [freed, report]); // one wake-up for both
  assert.deepEqual(readyReports([freed], () => false), [freed]); // c's turn ended without a report
});

test('heldNote: a held report says what waits and why', () => {
  const t = heldNote([{ childId: 'c', title: 'Outbox work' }, { kind: 'plan', title: 'Shop', tasks: [{ id: 'T10' }, { id: 'T11' }] }], 8);
  assert.match(t, /"Outbox work"/);
  assert.match(t, /T10, T11 free to start/);
  assert.match(t, /after 8 wake-ups/);
  assert.match(t, /Write anything here/);
});

test('freedReply: a holder is told the coordinator starts the freed tasks; the coordinator is told to start them', () => {
  const nowReady = [{ id: 'T10', title: 'Outbox' }, { id: 'T11', title: 'Stop list' }];
  const holder = freedReply({ nowReady, isCoordinator: false, coordinatorTitle: 'Shop plan' });
  assert.match(holder, /"Shop plan", was told and starts them/);
  assert.match(holder, /nothing for you or the user to do/);
  assert.doesNotMatch(holder, /Now free to start/);
  assert.equal(freedReply({ nowReady, isCoordinator: true, coordinatorTitle: 'Shop plan' }), 'Now free to start: T10 Outbox; T11 Stop list.');
  assert.equal(freedReply({ nowReady, coordinatorTitle: '' }), 'Now free to start: T10 Outbox; T11 Stop list.');
  assert.equal(freedReply({ nowReady: [], coordinatorTitle: 'x' }), '');
});
