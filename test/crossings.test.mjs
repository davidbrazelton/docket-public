// Tests for crossings.mjs: asking another company, and handing work to another company. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { canPair, isApproved, approve, crossingLog, insideCompany, answerInstructions, addToInbox, settleInbox, openInbox, crossReport, inboxContext } from '../crossings.mjs';

test('every pair of different companies may talk today; a company never pairs with itself', () => {
  assert.equal(canPair('acme', 'globex'), true);
  assert.equal(canPair('globex', 'acme'), true);
  assert.equal(canPair('initech', 'globex'), true);
  assert.equal(canPair('globex', 'globex'), false);
  assert.equal(canPair('', 'globex'), false);
  assert.equal(canPair('acme', undefined), false);
});

test('a second crossing to the same company from the same session goes through without asking', () => {
  const session = { id: 's1' };
  assert.equal(isApproved(session, 'globex'), false, 'the first crossing asks');
  approve(session, 'globex');
  assert.equal(isApproved(session, 'globex'), true, 'the second one does not');
  assert.equal(isApproved(session, 'globex'), true, 'nor the third');
});

test('a new session asks again, and so does a different target company', () => {
  const first = { id: 's1' };
  approve(first, 'globex');
  const next = { id: 's2' };
  assert.equal(isApproved(next, 'globex'), false, 'another session asks again');
  assert.equal(isApproved(first, 'initech'), false, 'another company asks again');
  // The same session picked up again after it ended is a new record in Docket's memory, so it asks again too.
  const resumed = { id: 's1' };
  assert.equal(isApproved(resumed, 'globex'), false);
});

test('approvals are kept in memory only: nothing about them survives being written to disk', () => {
  const session = { id: 's1', title: 'Work' };
  approve(session, 'globex');
  assert.deepEqual(JSON.parse(JSON.stringify(session)).crossOk, {}, 'a Set is saved as an empty object, so a saved copy holds no approval');
});

test('the log line names from company, to company and the exact text', () => {
  const l = crossingLog({ kind: 'ask', from: 'acme', to: 'globex', session: 'abc', title: 'Pricing', text: 'How did I set up the\ndiscount price?' });
  assert.equal(l.what, 'crossing: question acme -> globex');
  assert.match(l.detail, /from session: "Pricing" \(abc\)/);
  assert.match(l.detail, /How did I set up the\ndiscount price\?/);
  assert.equal(crossingLog({ kind: 'answer', from: 'globex', to: 'acme', text: 'x' }).what, 'crossing: answer globex -> acme');
  assert.equal(crossingLog({ kind: 'handoff', from: 'acme', to: 'globex', text: 'x' }).what, 'crossing: handoff acme -> globex');
  assert.equal(crossingLog({ kind: 'start', from: 'acme', to: 'globex', text: 'x' }).what, 'crossing: handoff started acme -> globex');
});

test('the answering session reads only inside its own company', () => {
  const globex = { id: 'globex', home: path.resolve('/claude/Globex/home'), folder: path.resolve('/projects/Globex') };
  assert.equal(insideCompany(path.resolve('/projects/Globex/notes.md'), globex), true);
  assert.equal(insideCompany(path.resolve('/claude/Globex/home/projects/x.jsonl'), globex), true);
  assert.equal(insideCompany('notes/plan.md', globex), true, 'a relative path is inside its own folder');
  assert.equal(insideCompany(undefined, globex), true, 'no path means its own folder');
  assert.equal(insideCompany(path.resolve('/claude/Acme/home/memory/x.md'), globex), false, "another company's home");
  assert.equal(insideCompany(path.resolve('/projects/Globex-other/x.md'), globex), false, 'a folder that only starts with the same name');
  assert.equal(insideCompany('../Acme/secret.txt', globex), false, 'climbing out of its folder');
});

test('the answering session is told who asks and that only its answer goes back', () => {
  const t = answerInstructions('Acme', 'Globex');
  assert.match(t, /desk "Acme" sent to the desk "Globex"/);
  assert.match(t, /search_past_sessions/);
  assert.match(t, /Only your final reply goes back to Acme/);
});

test('a handed-over card waits in the list until Start or Dismiss, once only', () => {
  const inbox = [];
  const it = addToInbox(inbox, { id: 'inbox_1', from: 'acme', title: 'File this', brief: 'Do X' });
  assert.equal(it.state, 'open');
  assert.deepEqual(openInbox(inbox).map((x) => x.id), ['inbox_1']);
  assert.equal(settleInbox(inbox, 'inbox_1', 'started', 'sess_9').startedId, 'sess_9');
  assert.equal(settleInbox(inbox, 'inbox_1', 'dismissed'), null, 'an answered card cannot be answered again');
  assert.deepEqual(openInbox(inbox), []);
  assert.deepEqual(openInbox(undefined), []);
});

test('old answered cards are dropped, open ones never', () => {
  const inbox = [];
  for (let i = 0; i < 40; i++) { addToInbox(inbox, { id: 'i' + i }); if (i % 2) settleInbox(inbox, 'i' + i, 'dismissed'); }
  assert.equal(inbox.length, 30);
  assert.equal(openInbox(inbox).length, 20, 'all twenty open cards are still there');
});

// Report back (#904): the sending chat's card follows the work, and only status and the closing reply cross.
const handed = (report) => {
  const inbox = [];
  const it = addToInbox(inbox, { id: 'inbox_7', from: 'docket', fromName: 'Docket', fromSession: 's1', fromTitle: 'Invoice triage', title: 'Fix the export', brief: 'Do X' });
  it.report = report;
  return { inbox, it };
};

test('report back on: the card moves to Started, then Done with the closing reply as news', () => {
  const { inbox, it } = handed(true);
  const start = crossReport(it, 'start', { at: 1000, childId: 'c1', toName: 'Acme' });
  assert.deepEqual(start.card, { state: 'started', report: true, startedAt: 1000, childId: 'c1' });
  assert.match(start.note, /Acme started "Fix the export"\. It reports back/);
  assert.equal(crossReport(it, 'turn', { reply: 'too early' }), null, 'nothing goes back before it has started');
  settleInbox(inbox, 'inbox_7', 'started', 'c1');
  const turn = crossReport(it, 'turn', { at: 2000, reply: 'Fixed in pull request #212.', childId: 'c1', toName: 'Acme' });
  assert.deepEqual(turn.card, { state: 'done', doneAt: 2000, text: 'Fixed in pull request #212.' });
  assert.deepEqual(turn.news, { childId: 'c1', title: 'Fix the export', text: 'Fixed in pull request #212.', desk: 'Acme', at: 2000 });
  assert.equal(crossReport(it, 'turn', { reply: 'x'.repeat(1000) }).news.text.length, 400, 'only a clipped closing reply crosses, never the chat');
});

test('report back off: only "started, not reporting" goes back, and no turn ever does', () => {
  const { inbox, it } = handed(false);
  const start = crossReport(it, 'start', { at: 1000, childId: 'c1', toName: 'Acme' });
  assert.equal(start.card.report, false);
  assert.match(start.note, /chose not to report back/);
  settleInbox(inbox, 'inbox_7', 'started', 'c1');
  assert.equal(crossReport(it, 'turn', { reply: 'secret progress' }), null);
});

test('Stop reporting turns it off from then on', () => {
  const { inbox, it } = handed(true);
  settleInbox(inbox, 'inbox_7', 'started', 'c1');
  const q = crossReport(it, 'quiet', { toName: 'Acme' });
  assert.deepEqual(q.card, { report: false });
  assert.match(q.note, /stopped reporting back/);
  it.report = false;
  assert.equal(crossReport(it, 'turn', { reply: 'more' }), null);
  assert.equal(crossReport(it, 'quiet'), null, 'stopping twice says nothing');
});

test('Take it back: the card leaves the other desk while open, and cannot be started after', () => {
  const { inbox, it } = handed(true);
  assert.equal(settleInbox(inbox, 'inbox_7', 'withdrawn').state, 'withdrawn');
  assert.deepEqual(openInbox(inbox), [], "gone from the other desk's list");
  assert.equal(crossReport(it, 'withdrawn', { at: 5 }).card.state, 'withdrawn');
  assert.equal(settleInbox(inbox, 'inbox_7', 'started', 'c1'), null, 'a taken-back card cannot be started');
  const { inbox: b } = handed(true);
  settleInbox(b, 'inbox_7', 'started', 'c1');
  assert.equal(settleInbox(b, 'inbox_7', 'withdrawn'), null, 'started work cannot be taken back');
});

test('the started session is told what goes back, or that nothing does', () => {
  const on = inboxContext({ fromName: 'Docket', fromTitle: 'Invoice triage', report: true }, 'Acme');
  assert.match(on, /closing reply .* goes back to the session "Invoice triage" in Docket/);
  assert.match(on, /never this chat/);
  assert.doesNotMatch(on, /Nothing you write here goes back/);
  const off = inboxContext({ fromName: 'Docket', report: false }, 'Acme', 'pilot');
  assert.match(off, /nothing you write here goes back to Docket/);
  assert.match(off, /Docket's autopilot pressed Start/);
});
