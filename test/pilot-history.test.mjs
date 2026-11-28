// The autopilot's head start from past sessions (#920): reading the person's answers from transcripts, adding them
// to the learning log once, and how far they may shorten the wait for "I got this".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { transcriptDecisions, cardDecisions, notByPilot, newHistory, historyFiles, readHistory } from '../pilot-history.mjs';
import { confidence, promotable, historyLean, pastAnswers, DEFAULT_RULES, LEARN } from '../pilot.mjs';

// A Claude Code transcript: the assistant's tool call, then the user line with its result.
const call = (id, name, input, ts = '2026-09-01T10:00:00Z') => ({ type: 'assistant', timestamp: ts, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, text, extra = {}, ts = '2026-09-01T10:01:00Z') => ({ type: 'user', timestamp: ts, ...extra, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, ...(extra.is_error ? { is_error: true } : {}) }] } });
const REJECT = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
const form = { questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red' }, { label: 'Blue' }] }] };

const sample = [
  { type: 'user', permissionMode: 'default', message: { role: 'user', content: 'go' } },
  call('t1', 'Bash', { command: 'git push origin feature' }), result('t1', REJECT, { is_error: true }),
  call('t2', 'Bash', { command: 'npm test' }), result('t2', 'ok, 12 passing'),
  call('t3', 'AskUserQuestion', form), result('t3', 'Your questions have been answered: "Which colour?"="Blue". You can now continue with these answers in mind.'),
  call('t4', 'AskUserQuestion', form), result('t4', 'x', { toolUseResult: { questions: form.questions, answers: { 'Which colour?': 'Red' } } }),
  call('t5', 'AskUserQuestion', form), result('t5', 'The user chose to answer in the chat instead of the form. Ask these questions again as plain text in your reply and wait for their answer.', { is_error: true }),
  call('t6', 'ExitPlanMode', { plan: '# Fix the login\n\nSteps...' }), result('t6', 'User has approved your plan. You can now start coding.'),
  call('t7', 'ExitPlanMode', { plan: '## Rewrite everything' }), result('t7', REJECT, { is_error: true }),
  call('t8', 'mcp__portal__start_session', { title: 'Build #44', initiation: 'offer', prompt: 'p' }), result('t8', 'The user chose a new session: started "Build #44" (id abc).'),
  call('t9', 'mcp__portal__start_session', { title: 'Small fix', initiation: 'offer', prompt: 'p' }), result('t9', 'The user chose to do it here. Do the work in this session. (Card x)'),
  call('t10', 'Edit', { file_path: 'a.js' }), result('t10', 'Invalid input', { is_error: true }),
  call('t11', 'Bash', { command: 'rm -rf build' }), result('t11', "Docket's autopilot declined this, under the rules the user set for it.", { is_error: true }),
];

test('reads allow, reject, question answers and plans from a transcript', () => {
  const got = transcriptDecisions(sample, { session: 's1', desk: 'acme' });
  const brief = got.map((d) => [d.id, d.kind, d.what, d.user]);
  assert.deepEqual(brief, [
    ['history:s1:t1', 'permission', 'Bash: git push origin feature', { answer: 'deny' }],
    ['history:s1:t3', 'question', 'Which colour? [Red | Blue]', { answer: 'answer', answers: { 'Which colour?': 'Blue' } }],
    ['history:s1:t4', 'question', 'Which colour? [Red | Blue]', { answer: 'answer', answers: { 'Which colour?': 'Red' } }],
    ['history:s1:t5', 'question', 'Which colour? [Red | Blue]', { answer: 'skip' }],
    ['history:s1:t6', 'plan', 'Fix the login', { answer: 'allow' }],
    ['history:s1:t7', 'plan', 'Rewrite everything', { answer: 'deny' }],
    ['history:s1:t8', 'offer', 'Build #44', { answer: 'new' }],
    ['history:s1:t9', 'offer', 'Small fix', { answer: 'here' }],
  ], 'a call that just ran says nothing (a rule may have let it through); errors and the autopilot\'s own declines are not the user\'s');
  assert.equal(got[0].desk, 'acme');
  assert.equal(got[0].at, Date.parse('2026-09-01T10:01:00Z'));
  assert.equal(got[0].tool, 'Bash');
});

test("Docket's own chat records (msg lines) read the same way", () => {
  const chat = [call('c1', 'ExitPlanMode', { plan: 'Plan A' }), result('c1', 'User has approved your plan.')].map((m, i) => ({ seq: i, at: 1000 + i, msg: m }));
  const [d] = transcriptDecisions(chat, { session: 'g1', desk: 'acme' });
  assert.equal(d.kind, 'plan');
  assert.deepEqual(d.user, { answer: 'allow' });
});

test('suggested-session and handoff cards come from the saved session records, not those the pilot answered', () => {
  const sessions = {
    p1: { client: 'acme', cards: [
      { ev: { k: 'proposal', id: 'prop_1', title: 'Spin off docs', state: 'started', at: 5 } },
      { ev: { k: 'proposal', id: 'prop_2', title: 'Other', state: 'dismissed', at: 6 } },
      { ev: { k: 'proposal', id: 'prop_3', title: 'Withdrawn', state: 'withdrawn', at: 7 } },
      { ev: { k: 'proposal', id: 'prop_4', title: 'By pilot', state: 'started', by: 'pilot', at: 8 } },
      { ev: { k: 'handoff', id: 'h_1', title: 'Fresh start', state: 'here', at: 9 } },
      { ev: { k: 'plan-offer', id: 'po', state: 'dismissed', at: 10 } },
    ] },
  };
  assert.deepEqual(cardDecisions(sessions).map((d) => [d.id, d.kind, d.user.answer, d.desk]), [
    ['history:card:prop_1', 'card', 'start', 'acme'], ['history:card:prop_2', 'card', 'dismiss', 'acme'], ['history:card:h_1', 'handoff', 'here', 'acme'],
  ]);
});

test('what the autopilot answered itself is left out', () => {
  const ds = [{ session: 's1', kind: 'question', at: 100000 }, { session: 's1', kind: 'question', at: 900000 }];
  assert.deepEqual(notByPilot(ds, [{ session: 's1', kind: 'question', at: 130000, ok: true }]), [ds[1]]);
});

test('a rerun adds nothing twice, and nothing after Docket started hearing answers itself', () => {
  const ds = transcriptDecisions(sample, { session: 's1', desk: 'acme' });
  const first = newHistory([], ds);
  assert.equal(first.length, 8);
  assert.ok(first.every((l) => l.source === 'history' && l.match === null && l.suggested === null));
  assert.deepEqual(newHistory(first, ds), [], 'the second run finds them all in the log');
  assert.deepEqual(newHistory([], [...ds, ...ds]).length, 8, 'the same answer twice in one read is kept once');
  const live = { at: Date.parse('2026-09-01T10:00:30Z'), id: 'question:x', kind: 'question', desk: 'acme', match: true };
  assert.deepEqual(newHistory([live], ds), [], 'answers from after the first live line were heard live');
  assert.equal(newHistory([], ds, 3).length, 3, 'capped to the newest');
});

test('reads the files under each desk home', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-history-'));
  try {
    fs.mkdirSync(path.join(home, 'projects', 'C--Work'), { recursive: true });
    fs.writeFileSync(path.join(home, 'projects', 'C--Work', 's9.jsonl'), sample.map((l) => JSON.stringify(l)).join('\n') + '\nnot json\n');
    const files = historyFiles([{ id: 'acme', home }, { id: 'none', home: path.join(home, 'missing') }], null, (s) => (s === 's9' ? 'beta' : null));
    assert.deepEqual(files.map((f) => [f.session, f.desk]), [['s9', 'beta']], "Docket's record of the session names its desk");
    assert.equal((await readHistory(files)).length, 8);
    assert.equal((await readHistory(files, { skipDesks: ['beta'] })).length, 0);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('history lowers the live matches "I got this" needs, but never to none', () => {
  const past = (answer, n, kind = 'plan') => Array.from({ length: n }, (_, i) => ({ at: i, desk: 'acme', kind, user: { answer }, suggested: null, match: null, how: 'user', source: 'history' }));
  const live = (n, answer = 'allow', kind = 'plan') => Array.from({ length: n }, () => ({ desk: 'acme', kind, user: { answer }, suggested: { answer }, match: true, how: 'user' }));
  const agrees = past('allow', 20);
  assert.deepEqual(historyLean(agrees, 'acme', 'plan'), { answer: 'allow', agree: 20, total: 20 });
  assert.equal(confidence(agrees, 'acme', 'plan').ready, false, 'history alone never makes it ready');
  assert.deepEqual(promotable(agrees, DEFAULT_RULES), []);
  assert.equal(confidence([...agrees, ...live(2)], 'acme', 'plan').ready, false, 'two live matches are not enough');
  const c = confidence([...agrees, ...live(3)], 'acme', 'plan');
  assert.deepEqual([c.ready, c.need, c.history], [true, 3, 20], 'three live matches are, where history agrees');
  assert.deepEqual(promotable([...agrees, ...live(3)], DEFAULT_RULES), [{ desk: 'acme', kind: 'plan', matched: 3, total: 3, history: 20 }]);
  assert.equal(confidence([...past('deny', 20), ...live(3)], 'acme', 'plan').ready, false, 'history that leans the other way does not help');
  assert.equal(confidence([...past('allow', 15), ...past('deny', 5), ...live(3)], 'acme', 'plan').ready, false, 'nor history that is split');
  assert.equal(confidence([...past('allow', 9), ...live(3)], 'acme', 'plan').ready, false, 'nor too little of it');
  assert.equal(confidence([...past('allow', 20, 'card'), ...live(3)], 'acme', 'plan').ready, false, 'nor another kind');
  assert.equal(confidence([...past('answer', 20, 'question'), ...live(3, 'answer', 'question')], 'acme', 'question').ready, false, 'question forms differ question by question');
  const missed = [...agrees, ...live(2), { desk: 'acme', kind: 'plan', user: { answer: 'deny' }, suggested: { answer: 'allow' }, match: false, how: 'user' }, ...live(3)];
  assert.equal(confidence(missed, 'acme', 'plan').ready, false, 'a live miss sends it back to the full count');
  assert.equal(confidence([...agrees, ...live(LEARN.n)], 'acme', 'plan').ready, true);
});

test("the brief lists past-session answers after the live ones, the most alike first", () => {
  const lines = [
    { at: Date.UTC(2026, 8, 1), desk: 'acme', kind: 'permission', tool: 'Bash', what: 'Bash: git push origin feature', user: { answer: 'deny' }, match: null, how: 'user', source: 'history' },
    { at: Date.UTC(2026, 8, 2), desk: 'acme', kind: 'permission', tool: 'WebFetch', what: 'WebFetch: https://x', user: { answer: 'deny' }, match: null, how: 'user', source: 'history' },
    { at: Date.UTC(2026, 8, 3), desk: 'acme', kind: 'offer', what: 'Build #44', user: { answer: 'new' }, match: null, how: 'user', source: 'history' },
    { at: Date.UTC(2026, 10, 1), desk: 'acme', kind: 'offer', what: 'Fix login', user: { answer: 'here' }, suggested: { answer: 'here' }, match: true, how: 'user' },
  ];
  const items = [{ kind: 'offer', desk: 'acme', what: 'Build #45' }, { kind: 'permission', desk: 'acme', tool: 'Bash', what: 'Bash: git push origin other', may: 'suggest' }];
  assert.deepEqual(pastAnswers(lines, items, (d) => d.toUpperCase(), 6, 1), [
    '- 2026-11-01 offer on ACME: "Fix login": the user picked Do it here (you suggested Do it here: matched)',
    '- 2026-09-03 offer on ACME (past session): "Build #44": the user picked New session',
    '- 2026-09-01 permission on ACME (past session): "Bash: git push origin feature": the user picked Deny',
  ]);
  assert.deepEqual(pastAnswers(lines, [{ ...items[1], may: 'allow' }]), [], 'permission prompts only where the run suggests');
});
