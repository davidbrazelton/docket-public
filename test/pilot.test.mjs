// Tests for the autopilot's rules (pilot.mjs, #821): the rules check and the hard stops. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, STOPS, DEFAULT_RULES, cleanRules, permissionStops, itemStops, ruleFor, mayAnswer, logLine, runLine, OWN_RUN, runStep, runSteps, runBrief, ofDesk, runDone, runsToArchive, RUN_KEEP_MS, pilotState,
  JUDGMENT, upgradeRules, quickEngaged, busyKeys, deskStatus, migratePilot, topGear, resetLine, holdLine, deskKinds, kindChoiceRefusal, offerDesks, runsByDay, maySuggest, sameAnswer, answerLabel, learnLine, confidence, promotable, setDeskLevel, pastAnswers, LEARN, stricter } from '../pilot.mjs';
import { GEARS } from '../gears.mjs';

const perm = (command, extra = {}) => ({ id: 'permission:1', kind: 'permission', desk: 'acme', tool: 'Bash', input: { command }, ...extra });

test('the safe defaults let the pilot answer prompts, suggest for the judgment kinds, and keep merges and sign-ins with the person', () => {
  assert.equal(mayAnswer(DEFAULT_RULES, perm('npm test'), 'allow').ok, true);
  for (const kind of JUDGMENT) {
    const a = mayAnswer(DEFAULT_RULES, { kind, desk: 'acme' }, KINDS[kind].answers[0]);
    assert.equal(a.ok, false, kind);
    assert.match(a.why, /only suggests/, kind);
    assert.equal(maySuggest(DEFAULT_RULES, { kind, desk: 'acme' }, KINDS[kind].answers[0]).ok, true, kind);
  }
  for (const kind of ['inbox', 'cross', 'merge', 'signin', 'remote']) {
    const a = mayAnswer(DEFAULT_RULES, { kind, desk: 'acme' }, KINDS[kind].answers[0]);
    assert.equal(a.ok, false, kind);
    assert.match(a.why, /stays with the person/, kind);
  }
  for (const st of Object.keys(STOPS)) assert.equal(DEFAULT_RULES.stops[st], 'ask', st);
});

test('a merge is refused for the pilot unless the rules name it', () => {
  const merge = { id: 'merge:s1:12', kind: 'merge', desk: 'acme' };
  assert.equal(mayAnswer(DEFAULT_RULES, merge, 'merge').ok, false);
  // allowing the kind alone is not enough: the hard stop still holds it
  const kindOnly = { kinds: { merge: 'allow' } };
  const r = mayAnswer(kindOnly, merge, 'merge');
  assert.equal(r.ok, false);
  assert.match(r.why, /hard stop: merging/);
  assert.equal(mayAnswer({ kinds: { merge: 'allow' }, stops: { merge: 'allow' } }, merge, 'merge').ok, true);
});

test('a permission prompt that hits a hard stop stays with the person', () => {
  const cases = {
    'gh pr merge 12 --squash': 'merge',
    'git push origin master': 'merge',
    'rm -rf build': 'delete',
    'Remove-Item -Recurse C:/x': 'delete',
    'git reset --hard origin/master': 'delete',
    'git push --force': 'delete',
    'gh auth token -u someone': 'secrets',
    'cat .env': 'secrets',
    'curl -X POST https://example.com/hook -d x': 'outside',
    'git push -u origin autopilot': 'outside',
    'gh pr create --title x --body y': 'outside',
    'gh issue comment 3 --body hi': 'outside',
    'npm publish': 'outside',
    'stripe charges create': 'money',
  };
  for (const [command, stop] of Object.entries(cases)) {
    assert.ok(permissionStops('Bash', { command }).includes(stop), `${command} -> ${stop}`);
    assert.equal(mayAnswer({ kinds: { permission: 'allow' } }, perm(command), 'allow').ok, false, command);
  }
  for (const command of ['npm test', 'git status', 'ls -la', 'node --test test/pilot.test.mjs', 'git log --oneline -5', 'gh pr view 12', 'git diff']) {
    assert.deepEqual(permissionStops('Bash', { command }), [], command);
  }
});

test('connected services that send, spend or delete are hard stops; reading them is not', () => {
  assert.ok(permissionStops('mcp__claude_ai_Gmail__send_message', {}).includes('outside'));
  assert.ok(permissionStops('mcp__claude_ai_Slack__slack_send_message', {}).includes('outside'));
  assert.ok(permissionStops('mcp__claude_ai_Google_Drive__trash_file', {}).includes('delete'));
  assert.ok(permissionStops('mcp__portal__recycle', { paths: ['C:/x'] }).includes('delete'));
  assert.ok(permissionStops('mcp__portal__ask_desk', {}).includes('remote'));
  assert.deepEqual(permissionStops('mcp__claude_ai_Gmail__search_threads', {}), []);
  assert.deepEqual(permissionStops('mcp__portal__list_sessions', {}), []);
  assert.deepEqual(permissionStops('mcp__playwright__browser_click', {}), []);
  assert.ok(permissionStops('Write', { file_path: 'C:/work/.env' }).includes('secrets'));
  assert.ok(permissionStops('Read', { file_path: '/home/x/.ssh/id_rsa' }).includes('secrets'));
  assert.deepEqual(permissionStops('Edit', { file_path: 'C:/work/server.mjs' }), []);
});

test('deny lets the pilot only decline; a hard stop set to deny lets it decline that too', () => {
  const card = { kind: 'card', desk: 'acme' };
  const rules = { kinds: { card: 'deny' } };
  assert.equal(mayAnswer(rules, card, 'dismiss').ok, true);
  assert.equal(mayAnswer(rules, card, 'start').ok, false);
  const rm = perm('rm -rf build');
  const declineOnly = { kinds: { permission: 'allow' }, stops: { delete: 'deny' } };
  assert.equal(mayAnswer(declineOnly, rm, 'deny').ok, true);
  assert.equal(mayAnswer(declineOnly, rm, 'allow').ok, false);
  assert.equal(mayAnswer({ stops: { delete: 'allow' } }, rm, 'allow').ok, true);
});

test('a desk\'s own rules lie over the general ones', () => {
  const rules = { kinds: { permission: 'allow' }, desks: { globex: { kinds: { permission: 'ask' } }, acme: { stops: { outside: 'allow' } } } };
  assert.equal(mayAnswer(rules, perm('npm test', { desk: 'globex' }), 'allow').ok, false);
  assert.equal(mayAnswer(rules, perm('npm test', { desk: 'acme' }), 'allow').ok, true);
  assert.equal(mayAnswer(rules, perm('git push -u origin x', { desk: 'acme' }), 'allow').ok, true);
  assert.equal(mayAnswer(rules, perm('git push -u origin x', { desk: 'other' }), 'allow').ok, false);
});

test('a rules file in any shape is made safe', () => {
  assert.deepEqual(cleanRules(null), { ...DEFAULT_RULES, desks: {} });
  const r = cleanRules({ kinds: { permission: 'yes', merge: 'allow', bogus: 'allow' }, stops: { merge: 'allow', other: 'allow' }, desks: { a: { kinds: { card: 'allow', x: 'allow' }, stops: 'no' } } });
  assert.equal(r.kinds.permission, 'allow', 'a level it does not know keeps the default');
  assert.equal(r.kinds.merge, 'allow');
  assert.equal(r.kinds.bogus, undefined);
  assert.equal(r.stops.merge, 'allow');
  assert.equal(r.stops.other, undefined);
  assert.deepEqual(r.desks.a, { kinds: { card: 'allow' }, stops: {} });
});

test('every item kind maps to its hard stops, and answers are checked', () => {
  assert.deepEqual(itemStops({ kind: 'merge' }), ['merge']);
  assert.deepEqual(itemStops({ kind: 'signin' }), ['signin']);
  assert.deepEqual(itemStops({ kind: 'cross' }), ['remote']);
  assert.deepEqual(itemStops({ kind: 'remote' }), ['remote']);
  assert.deepEqual(itemStops({ kind: 'offer' }), []);
  assert.match(mayAnswer(DEFAULT_RULES, perm('ls'), 'maybe').why, /not an answer/);
  assert.match(mayAnswer(DEFAULT_RULES, { kind: 'nope' }, 'x').why, /Unknown kind/);
  assert.equal(ruleFor(DEFAULT_RULES, perm('ls')).level, 'allow');
  for (const k of Object.values(KINDS)) assert.ok(k.decline === null || k.answers.includes(k.decline));
});

test('a log line keeps what was answered and why', () => {
  const l = logLine({ at: 5, item: { id: 'permission:1', kind: 'permission', desk: 'acme', session: 's1', title: 'T', what: 'Bash: ls' }, answer: 'allow', ok: true, why: 'w' });
  assert.deepEqual(l, { at: 5, id: 'permission:1', kind: 'permission', desk: 'acme', session: 's1', title: 'T', what: 'Bash: ls', answer: 'allow', ok: true, why: 'w' });
});

// ---------- the pilot never approves itself (#875, #914) ----------
test('what a pilot run raised itself stays with the person, whatever the rules say', () => {
  const all = { kinds: Object.fromEntries(Object.keys(KINDS).map((k) => [k, 'allow'])), stops: Object.fromEntries(Object.keys(STOPS).map((k) => [k, 'allow'])) };
  const runs = new Set(['run1']), own = (i) => runs.has(i.session);
  for (const kind of Object.keys(KINDS)) {
    const mine = mayAnswer(all, { kind, desk: 'acme', session: 'run1' }, KINDS[kind].answers[0], undefined, own);
    assert.equal(mine.ok, false, kind);
    assert.match(mine.why, /raised by a pilot run itself: it stays with the person/, kind);
    if (KINDS[kind].decline) assert.equal(mayAnswer(all, { kind, desk: 'acme', session: 'run1' }, KINDS[kind].decline, undefined, own).ok, false, `${kind}: not even a decline`);
    assert.equal(maySuggest({ kinds: { [kind]: 'suggest' } }, { kind, desk: 'acme', session: 'run1' }, KINDS[kind].answers[0], undefined, own).ok, false, `${kind}: no suggestion either`);
  }
  assert.equal(ruleFor(all, perm('ls', { desk: 'acme', session: 'run1' }), own).why, OWN_RUN);
  // The same desk's other sessions go by the rules, now that runs work on the desks themselves, and the hard stops hold.
  assert.equal(mayAnswer(DEFAULT_RULES, perm('npm test', { desk: 'acme', session: 'work' }), 'allow', undefined, own).ok, true);
  assert.equal(mayAnswer(DEFAULT_RULES, perm('gh pr merge 12', { desk: 'acme', session: 'work' }), 'allow', undefined, own).ok, false);
  assert.equal(mayAnswer(DEFAULT_RULES, { kind: 'merge', desk: 'acme' }, 'merge', undefined, own).ok, false);
  // No runs: the rules alone.
  assert.equal(mayAnswer(DEFAULT_RULES, perm('npm test', { session: 'run1' }), 'allow').ok, true);
});

// ---------- per desk (#973) ----------
test('the quick actions engage every desk signed in to a brand, or all but the one open now, or none', () => {
  const desks = [{ id: 'a', signedIn: true }, { id: 'b', signedIn: true }, { id: 'c', signedIn: false }];
  assert.deepEqual(quickEngaged('others', desks, 'a'), ['b'], 'all but this desk, and never one with no brand signed in');
  assert.deepEqual(quickEngaged('all', desks, 'a'), ['a', 'b']);
  assert.deepEqual(quickEngaged('none', desks, 'a'), []);
  assert.deepEqual(quickEngaged('nope', desks, 'a'), []);
  assert.deepEqual(quickEngaged('all', undefined), []);
});

test("the pilot holds back in a session the person is answering, typing in or using (#942, #965, #973)", () => {
  assert.deepEqual(busyKeys({ id: 'permission:k', session: 's1' }), ['permission:k', 'typing:s1', 'active:s1']);
  assert.deepEqual(busyKeys({ id: 'inbox:k', session: null }), ['inbox:k'], 'an item with no session: only itself');
});

test("each desk's line in the drop-down says what the rules let the pilot do there", () => {
  assert.equal(deskStatus(DEFAULT_RULES, 'acme'), 'answers prompts, suggests for forms, plans, offers, cards, handoffs');
  const rules = { kinds: { permission: 'allow', question: 'suggest', plan: 'ask', offer: 'ask', card: 'allow', handoff: 'ask' }, desks: { acme: { kinds: { permission: 'suggest' } } } };
  assert.equal(deskStatus(rules, 'acme'), 'answers cards, suggests for prompts, forms', "the desk's own rules first");
  assert.equal(deskStatus(rules, 'globex'), 'answers prompts, cards, suggests for forms');
  assert.equal(deskStatus({ kinds: Object.fromEntries(JUDGMENT.concat('permission').map((k) => [k, 'ask'])) }, 'x'), 'leaves everything to you');
});

test('the move to per desk: enabled stays, no desk engaged, the Autopilot desk archived and dropped, runs on desks kept (#973)', () => {
  const sessions = { a1: { client: 'ap', pilotRun: 't1' }, a2: { client: 'ap' }, a3: { client: 'ap', archived: true }, r1: { client: 't1', pilotRun: 't1' }, w1: { client: 't1' } };
  const old = { on: true, desk: 'ap', brand: 'grok', gear: 'full', session: null, going: { t1: { id: 'r1', at: 1, host: 't1' }, t2: { id: 'a1', at: 1, host: 'ap' } },
    runs: [{ id: 'r1' }], suggestions: { 'card:1': { answer: 'start' } }, history: { at: 1, count: 3 } };
  const m = migratePilot(old, sessions);
  assert.equal(m.changed, true);
  assert.deepEqual(m.archive, ['a1', 'a2'], "every session of the Autopilot desk not archived yet, none of another desk's");
  assert.equal(m.dropDesk, 'ap');
  assert.deepEqual(m.pilot, { on: true, going: { t1: { id: 'r1', at: 1, host: 't1' } }, runs: [{ id: 'r1' }], suggestions: { 'card:1': { answer: 'start' } }, history: { at: 1, count: 3 },
    engaged: {}, perDesk: true, movedNote: true }, 'enabled, no desk engaged, the brand gone, a note to show once');
  // Run again on its own result: nothing changes.
  assert.deepEqual(migratePilot(m.pilot, sessions), { pilot: m.pilot, archive: [], dropDesk: null, changed: false });
  // Off before: disabled, and no note.
  const off = migratePilot({ on: false }, {});
  assert.deepEqual([off.pilot.on, off.pilot.movedNote, off.dropDesk, off.archive], [false, undefined, null, []]);
  // Never used: nothing to move.
  assert.deepEqual(migratePilot(undefined, sessions).changed, false);
});

// ---------- runs (#881) ----------
const item = (id, may = 'allow') => ({ id, may });
test('a run starts once the batch delay is up, with every item that came in meanwhile', () => {
  const offered = new Set();
  // Nothing the pilot may answer: no run.
  assert.deepEqual(runStep({ items: [item('a', 'ask')], offered, since: null, now: 0, delay: 1000 }), { act: 'idle' });
  // The first item starts the batch delay...
  assert.deepEqual(runStep({ items: [item('a')], offered, since: null, now: 0, delay: 1000 }), { act: 'wait', ms: 1000 });
  // ...a second close behind it waits out the rest of the same delay...
  assert.deepEqual(runStep({ items: [item('a'), item('b')], offered, since: 0, now: 400, delay: 1000 }), { act: 'wait', ms: 600 });
  // ...and both go in one run; what stays with the person does not.
  const go = runStep({ items: [item('a'), item('b', 'deny'), item('c', 'ask')], offered, since: 0, now: 1000, delay: 1000 });
  assert.equal(go.act, 'start');
  assert.deepEqual(go.items.map((i) => i.id), ['a', 'b']);
});

test('one run at a time: what comes in during a run waits for the next, and nothing is offered twice', () => {
  const offered = new Set(['a']);
  const busy = runStep({ items: [item('a'), item('b')], offered, running: true, since: 0, now: 5000, delay: 1000 });
  assert.equal(busy.act, 'busy');
  assert.deepEqual(busy.items.map((i) => i.id), ['b'], 'a was offered already');
  // The run ended: b starts the next batch.
  assert.deepEqual(runStep({ items: [item('a'), item('b')], offered, running: false, since: null, now: 6000, delay: 1000 }), { act: 'wait', ms: 1000 });
  assert.deepEqual(runStep({ items: [item('a'), item('b')], offered, since: 6000, now: 7000, delay: 1000 }).items.map((i) => i.id), ['b']);
  // An item a run was given and left for the person never starts another run.
  assert.deepEqual(runStep({ items: [item('a')], offered, since: null, now: 0 }), { act: 'idle' });
});

test('items from several desks make one run per desk, each desk one run at a time (#914)', () => {
  const it = (id, desk, may = 'allow') => ({ id, desk, may });
  const items = [it('a1', 'a'), it('b1', 'b'), it('a2', 'a'), it('c1', 'c', 'ask')];
  // Each desk with something fresh fills its own batch; a desk with only ask items has none.
  assert.deepEqual(runSteps({ items, since: new Map(), now: 0, delay: 1000 }).map((s) => [s.desk, s.act]), [['a', 'wait'], ['b', 'wait']]);
  // When the delay is up, each desk's run gets that desk's items only.
  const go = runSteps({ items, since: new Map([['a', 0], ['b', 500]]), now: 1000, delay: 1000 });
  assert.deepEqual(go.map((s) => [s.desk, s.act, s.items?.map((i) => i.id) || s.ms]), [['a', 'start', ['a1', 'a2']], ['b', 'wait', 500]]);
  // A desk with a run going waits for it; another desk starts its own meanwhile.
  const busy = runSteps({ items, going: new Set(['a']), since: new Map([['b', 0]]), now: 1000, delay: 1000 });
  assert.deepEqual(busy.map((s) => [s.desk, s.act]), [['a', 'busy'], ['b', 'start']]);
  assert.deepEqual(busy[1].items.map((i) => i.id), ['b1']);
  // What a run was given is not offered to another.
  assert.deepEqual(runSteps({ items, offered: new Set(['a1', 'a2']), since: new Map([['b', 0]]), now: 1000, delay: 1000 }).map((s) => s.desk), ['b']);
});

test("a desk's run always runs on its brand's top gear", () => {
  assert.deepEqual(['claude', 'grok', 'codex'].map((b) => topGear(b, GEARS)), ['opus', 'full', 'astra']);
});

// ---------- keeping clients apart (#914) ----------
test("a run's brief holds its own desk's items, notes, log and past answers, and nothing of another desk's", () => {
  const items = [
    { id: 'permission:a1', kind: 'permission', desk: 'acme', what: 'Bash: npm test ACME_ITEM', may: 'allow' },
    { id: 'question:a2', kind: 'question', desk: 'acme', what: 'Which colour ACME_FORM?', may: 'suggest' },
    { id: 'permission:g1', kind: 'permission', desk: 'globex', what: 'Bash: GLOBEX_ITEM', may: 'allow' },
    { id: 'question:g2', kind: 'question', desk: 'globex', what: 'Which colour GLOBEX_FORM?', may: 'suggest' },
  ];
  const log = [
    { at: 3, kind: 'permission', desk: 'globex', answer: 'allow', ok: true, what: 'GLOBEX_LOG' },
    { at: 2, kind: 'permission', desk: 'acme', answer: 'allow', ok: true, what: 'ACME_LOG' },
    { at: 1, kind: 'run', desk: 'globex', run: 'r9', answer: 'started', what: 'GLOBEX_RUN' },
  ];
  const learn = [
    { at: 1, kind: 'question', desk: 'acme', what: 'Which colour ACME_PAST?', user: { answer: 'answer', answers: { q: 'Blue' } }, suggested: null, how: 'user' },
    { at: 2, kind: 'question', desk: 'globex', what: 'Which colour GLOBEX_PAST?', user: { answer: 'answer', answers: { q: 'Red' } }, suggested: null, how: 'user' },
    { at: 3, kind: 'question', desk: 'globex', what: 'Which colour GLOBEX_HISTORY?', user: { answer: 'skip' }, source: 'history', how: 'user' },
  ];
  const text = runBrief({ desk: 'acme', deskName: 'Acme', items, notes: '- ACME_NOTE', notesFile: '/data/pilot-notes/acme.md', log, learn, rulesFile: '/data/pilot-rules.json', screen: false });
  for (const own of ['ACME_ITEM', 'ACME_FORM', 'ACME_NOTE', 'ACME_LOG', 'ACME_PAST', '/data/pilot-notes/acme.md']) assert.ok(text.includes(own), own);
  assert.doesNotMatch(text, /GLOBEX|globex/, "nothing of another desk's");
  assert.doesNotMatch(text, /pilot-log|pilot-learn/, 'the shared logs are not named, so the run has no path to them');
  assert.match(text, /^You are Docket's autopilot on this computer, in one short run for the desk Acme\. This run is a session of Acme, on its own sign-in/);
  assert.deepEqual(ofDesk(items, 'globex').map((i) => i.id), ['permission:g1', 'question:g2']);
});

test('a run is done when its turn ends with nothing left, or its session ends, or it runs too long', () => {
  const s = (o) => ({ status: 'idle', events: [{ k: 'result' }], pendingAsks: new Map(), ...o });
  assert.equal(runDone(null), 'its session ended');
  assert.equal(runDone(s({ status: 'ended' })), 'its session ended');
  assert.equal(runDone(s({ status: 'starting', events: [] }), { at: 0, now: 1000 }), '', 'not started yet');
  assert.equal(runDone(s({ status: 'idle', events: [] }), { at: 0, now: 1000 }), '', 'idle before its first turn');
  assert.equal(runDone(s({ status: 'running' }), { at: 0, now: 1000 }), '', 'still working');
  assert.equal(runDone(s({ pendingAsks: new Map([['k', {}]]) }), { at: 0, now: 1000 }), '', 'asking the person');
  assert.equal(runDone(s({}), { tasks: 1, at: 0, now: 1000 }), '', 'a job still running');
  assert.equal(runDone(s({}), { at: 0, now: 1000 }), 'its turn ended');
  assert.match(runDone(s({ status: 'running' }), { at: 0, now: 31 * 60000 }), /more than 30 minutes/);
});

test('finished runs stay a week in the list, then are archived', () => {
  const now = 100 * RUN_KEEP_MS, old = now - RUN_KEEP_MS - 1, fresh = now - 1000;
  const sessions = { a: { client: 'ap', createdAt: old }, b: { client: 'ap', createdAt: fresh }, c: { client: 'ap', createdAt: old, archived: true },
    d: { client: 'acme', createdAt: old }, e: { client: 'ap', createdAt: old }, f: { client: 'ap' } };
  assert.deepEqual(runsToArchive(sessions, [], now), [], "a desk's own work is never archived as a run");
  // Runs are marked pilotRun (#914): the old ones are archived, never the one going now.
  const desks = { ...sessions, g: { client: 'acme', createdAt: old, pilotRun: 'acme' }, h: { client: 'acme', createdAt: old, pilotRun: 'acme' }, i: { client: 'acme', createdAt: fresh, pilotRun: 'acme' } };
  assert.deepEqual(runsToArchive(desks, ['e', 'h'], now), ['g']);
  assert.deepEqual(runsToArchive(desks, 'h', now), ['g']);
  assert.deepEqual(runsToArchive(undefined, null, now), []);
});

test('what the autopilot is doing: off, idle, waking while a batch fills, working while a run goes', () => {
  assert.equal(pilotState({ flying: false, running: true, filling: true }), 'off');
  assert.equal(pilotState({ flying: true, running: false, filling: false }), 'idle');
  assert.equal(pilotState({ flying: true, running: false, filling: true }), 'waking');
  assert.equal(pilotState({ flying: true, running: true, filling: true }), 'working');
});

test('the log links each run: its answers carry the run, and the run has lines of its own', () => {
  assert.equal(logLine({ at: 1, item: { id: 'permission:k', kind: 'permission', desk: 'acme' }, answer: 'allow', ok: true, why: '', run: 'r1' }).run, 'r1');
  assert.equal('run' in logLine({ at: 1, item: { id: 'x', kind: 'card', desk: 'acme' }, answer: 'start', ok: true, why: '' }), false);
  assert.deepEqual(runLine({ at: 2, run: 'r1', answer: 'started', what: '2 items', brand: 'grok', gear: 'fast' }), { at: 2, kind: 'run', run: 'r1', answer: 'started', what: '2 items', ok: true, brand: 'grok', gear: 'fast' });
  // Tagged with the desk it judged and ran on (#914, #973).
  assert.equal(runLine({ run: 'r2', desk: 'acme', answer: 'ended' }).desk, 'acme');
});

test('suggest: only for kinds a card can show it on, never past a hard stop, and checked like an answer', () => {
  const rules = { kinds: { merge: 'suggest', permission: 'suggest' } };
  assert.equal(ruleFor(rules, { kind: 'merge', desk: 'acme' }).level, 'ask', 'a merge cannot be suggested');
  assert.equal(ruleFor(rules, perm('npm test')).level, 'suggest');
  assert.equal(ruleFor(rules, perm('git push origin main')).level, 'ask', 'hard stops stay as they are');
  assert.equal(maySuggest(rules, perm('npm test'), 'allow').ok, true);
  assert.match(maySuggest(rules, perm('npm test'), 'nope').why, /not an answer/);
  assert.match(maySuggest(DEFAULT_RULES, perm('npm test'), 'allow').why, /answer it with pilot_answer/);
  assert.match(maySuggest(DEFAULT_RULES, { kind: 'merge', desk: 'acme' }, 'merge').why, /no suggestion/);
  assert.equal(ruleFor({ desks: { acme: { kinds: { plan: 'allow' } } } }, { kind: 'plan', desk: 'acme' }).level, 'allow', 'a desk promoted');
  assert.equal(stricter('suggest', 'allow'), 'suggest');
  assert.equal(stricter('suggest', 'ask'), 'ask');
  assert.equal(stricter('deny', 'suggest'), 'suggest');
});

test('a rules file from before keeps the levels the person chose, and its old defaults become suggest once', () => {
  const old = { kinds: { permission: 'allow', question: 'allow', plan: 'deny', offer: 'allow', card: 'ask' }, desks: { acme: { kinds: { question: 'allow' } } } };
  const { rules, changed } = upgradeRules(old);
  assert.equal(changed, true);
  assert.deepEqual(rules.kinds, { permission: 'allow', question: 'suggest', plan: 'deny', offer: 'suggest', card: 'suggest', handoff: 'suggest' });
  assert.deepEqual(rules.desks, old.desks, 'per-desk choices are kept');
  assert.equal(rules.version, 2);
  assert.equal(upgradeRules(rules).changed, false, 'only once');
  assert.equal(upgradeRules(null).changed, false);
});

test('a suggestion is compared with what the person answered, and logged', () => {
  assert.equal(sameAnswer({ answer: 'new' }, { answer: 'new' }), true);
  assert.equal(sameAnswer({ answer: 'new' }, { answer: 'here' }), false);
  assert.equal(sameAnswer({ answer: 'answer', answers: { 'Which?': 'A, B' } }, { answer: 'answer', answers: { 'Which? ': 'B,A' } }), true, 'multi-select in any order');
  assert.equal(sameAnswer({ answer: 'answer', answers: { 'Which?': 'A' } }, { answer: 'answer', answers: { 'Which?': 'B' } }), false);
  assert.equal(sameAnswer({ answer: 'answer', answers: { q: 'A' } }, { answer: 'answer', answers: { q: 'A', r: 'B' } }), false);
  assert.equal(answerLabel('handoff', { answer: 'here' }), 'Keep going here');
  assert.equal(answerLabel('offer', { answer: 'here' }), 'Do it here');
  assert.equal(answerLabel('question', { answer: 'answer', answers: { a: 'Yes', b: 'Later' } }), 'Yes · Later');
  const item = { id: 'offer:o1', kind: 'offer', desk: 'acme', session: 's1', what: 'Fix the login' };
  assert.deepEqual(learnLine({ at: 5, item, suggested: { answer: 'new' }, user: { answer: 'new' } }),
    { at: 5, id: 'offer:o1', kind: 'offer', desk: 'acme', session: 's1', what: 'Fix the login', suggested: { answer: 'new' }, user: { answer: 'new' }, match: true, how: 'user' });
  assert.equal(learnLine({ item, suggested: { answer: 'new' }, user: { answer: 'here' } }).match, false);
  assert.equal(learnLine({ item, user: { answer: 'here' } }).match, null, 'nothing to compare without a suggestion');
  assert.equal(learnLine({ item, suggested: { answer: 'new' }, how: 'miss' }).match, false);
});

test('"I got this" is offered once the last suggestions agree, and a miss holds it back', () => {
  const line = (match, kind = 'plan', desk = 'acme') => ({ desk, kind, match, user: { answer: 'allow' }, suggested: { answer: 'allow' } });
  const nine = Array.from({ length: 9 }, () => line(true));
  assert.deepEqual(confidence(nine, 'acme', 'plan'), { ready: false, matched: 9, total: 9, need: 10, history: 0 }, 'not enough yet');
  assert.equal(confidence([...nine, line(true)], 'acme', 'plan').ready, true);
  assert.equal(confidence([line(false), ...nine], 'acme', 'plan').ready, true, '9 of 10, the miss long ago');
  assert.equal(confidence([...nine.slice(0, 8), line(false), line(true)], 'acme', 'plan').ready, false, 'a recent miss holds it back');
  assert.equal(confidence([line(false), line(false), ...Array.from({ length: 8 }, () => line(true))], 'acme', 'plan').ready, false, 'under 90%');
  const ten = Array.from({ length: LEARN.n }, () => line(true));
  assert.deepEqual(promotable([...ten, line(null, 'card'), line(true, 'plan', 'beta')], DEFAULT_RULES), [{ desk: 'acme', kind: 'plan', matched: 10, total: 10, history: 0 }]);
  // Promoted: the desk's plan is allow, so it is not offered again; a miss sets it back to suggest.
  const up = setDeskLevel(DEFAULT_RULES, 'acme', 'plan', 'allow');
  assert.equal(ruleFor(up, { kind: 'plan', desk: 'acme' }).level, 'allow');
  assert.equal(ruleFor(up, { kind: 'plan', desk: 'beta' }).level, 'suggest', 'other desks keep learning');
  assert.deepEqual(promotable(ten, up), []);
  const down = setDeskLevel(up, 'acme', 'plan', 'suggest');
  assert.equal(ruleFor(down, { kind: 'plan', desk: 'acme' }).level, 'suggest');
  assert.deepEqual(down.stops, DEFAULT_RULES.stops, 'the rest of the file is kept');
  assert.equal(promotable([...ten, line(false)], down).length, 0, 'the miss holds it back');
});

test("each run's brief carries the person's own past answers for its kinds and desks", () => {
  const lines = [
    { at: Date.UTC(2026, 10, 1), desk: 'acme', kind: 'offer', what: 'Fix login', user: { answer: 'here' }, suggested: { answer: 'new' }, match: false, how: 'user' },
    { at: Date.UTC(2026, 10, 2), desk: 'acme', kind: 'offer', what: 'Add tests', user: { answer: 'new' }, suggested: null, match: null, how: 'user' },
    { at: Date.UTC(2026, 10, 3), desk: 'beta', kind: 'offer', what: 'Other desk', user: { answer: 'new' }, match: null, how: 'user' },
    { at: Date.UTC(2026, 10, 4), desk: 'acme', kind: 'plan', what: 'A plan', suggested: { answer: 'allow' }, match: false, how: 'miss' },
  ];
  const text = pastAnswers(lines, [{ kind: 'offer', desk: 'acme' }, { kind: 'plan', desk: 'acme' }, { kind: 'permission', desk: 'acme' }], (d) => d.toUpperCase());
  assert.deepEqual(text, [
    '- 2026-11-02 offer on ACME: "Add tests": the user picked New session',
    '- 2026-11-01 offer on ACME: "Fix login": the user picked Do it here (you suggested New session: missed)',
    '- 2026-11-04 plan on ACME: "A plan": the pilot answered Allow and the user marked it as not their pick',
  ]);
});

// ---------- a desk's Autopilot tab (#974) ----------
test('Train on a kind starts its count over on that desk only', () => {
  const l = (desk, match) => ({ desk, kind: 'card', match, user: { answer: 'start' }, suggested: { answer: 'start' } });
  const lines = Array.from({ length: 10 }, () => l('acme', true)).concat(Array.from({ length: 10 }, () => l('globex', true)));
  assert.equal(confidence(lines, 'acme', 'card').ready, true);
  const reset = [...lines, resetLine({ at: 1, desk: 'acme', kind: 'card' })];
  assert.deepEqual([confidence(reset, 'acme', 'card').ready, confidence(reset, 'acme', 'card').total], [false, 0], 'started over');
  assert.equal(confidence(reset, 'globex', 'card').ready, true, 'another desk keeps its count');
  assert.equal(confidence([...reset, ...Array.from({ length: 10 }, () => l('acme', true))], 'acme', 'card').ready, true, 'and earns it again');
});

test("what it handles on a desk: each kind it learns with its level and progress, and Answer only once earned", () => {
  const rules = { kinds: { permission: 'allow', question: 'suggest', plan: 'ask', offer: 'suggest', card: 'suggest', handoff: 'suggest' }, desks: { acme: { kinds: { handoff: 'allow' } } } };
  const lines = Array.from({ length: 10 }, () => ({ desk: 'acme', kind: 'card', match: true, user: { answer: 'start' } })).concat([{ desk: 'acme', kind: 'question', match: true }]);
  const rows = deskKinds(rules, lines, 'acme');
  assert.deepEqual(rows.map((r) => [r.kind, r.level, r.ready]), [['permission', 'allow', false], ['question', 'suggest', false], ['plan', 'ask', false], ['offer', 'suggest', false], ['card', 'suggest', true], ['handoff', 'allow', false]]);
  assert.deepEqual([rows[1].matched, rows[1].need], [1, 10]);
  const row = (k) => rows.find((r) => r.kind === k);
  assert.equal(kindChoiceRefusal(row('card'), 'allow'), '', 'earned: Answer is I got this');
  assert.match(kindChoiceRefusal(row('question'), 'allow'), /not earned that yet: 1 of the last 1 matched, and it needs 10/);
  assert.equal(kindChoiceRefusal(row('permission'), 'allow'), '', 'it answers already');
  assert.equal(kindChoiceRefusal(row('permission'), 'suggest'), '');
  assert.equal(kindChoiceRefusal(row('plan'), 'suggest'), '', 'Suggest from anything');
  assert.equal(kindChoiceRefusal(row('plan'), 'train'), '', 'Train from anything');
  assert.match(kindChoiceRefusal(row('plan'), 'ask'), /Pick Suggest, Answer or Train/);
  assert.match(kindChoiceRefusal(undefined, 'allow'), /does not learn/);
});

test('Suggest on a kind that answers keeps its count, and Answer can be picked again until Train or a miss (#1004)', () => {
  const rules = (level) => ({ kinds: { permission: 'allow', question: 'suggest', plan: 'suggest', offer: 'suggest', card: 'suggest', handoff: 'suggest' }, desks: { acme: { kinds: { permission: level, card: level } } } });
  const l = (match) => ({ desk: 'acme', kind: 'card', match, user: { answer: 'start' }, suggested: { answer: 'start' } });
  const lines = Array.from({ length: 10 }, () => l(true));
  const row = (lines, k = 'card', level = 'suggest') => deskKinds(rules(level), lines, 'acme').find((r) => r.kind === k);
  assert.equal(row(lines, 'card', 'allow').held, false, 'answering is not held');
  const paused = [...lines, holdLine({ desk: 'acme', kind: 'card' }), holdLine({ desk: 'acme', kind: 'permission' })];
  assert.deepEqual([row(paused).matched, row(paused).total, row(paused).held], [10, 10, true], 'Suggest keeps the count');
  assert.equal(kindChoiceRefusal(row(paused), 'allow'), '');
  assert.equal(row(paused, 'permission').total, 0);
  assert.equal(kindChoiceRefusal(row(paused, 'permission'), 'allow'), '', 'a default answer with no count can go back too');
  assert.equal(deskKinds(rules('suggest'), paused, 'globex').find((r) => r.kind === 'card').held, false, 'that desk only');
  const trained = [...paused, resetLine({ desk: 'acme', kind: 'permission' })];
  assert.match(kindChoiceRefusal(row(trained, 'permission'), 'allow'), /not earned that yet/, 'Train ends the hold');
  const missed = [...paused, { desk: 'acme', kind: 'card', how: 'miss', match: false }];
  assert.equal(row(missed).held, false, 'a miss after it ends the hold');
});

test('the offer to engage counts what has waited long enough on desks not engaged, that the pilot could take', () => {
  const now = 100 * 60000, seen = new Map([['a', 0], ['b', 0], ['c', now - 60000], ['d', 0], ['e', 0], ['f', 0]]);
  const items = [{ id: 'a', desk: 'acme', may: 'allow' }, { id: 'b', desk: 'acme', may: 'suggest' }, { id: 'c', desk: 'acme', may: 'allow' },
    { id: 'd', desk: 'globex', may: 'ask' }, { id: 'e', desk: 'initech', may: 'allow' }, { id: 'f', desk: 'eng', may: 'allow' }, { id: 'g', desk: 'acme', may: 'allow' }];
  assert.deepEqual(offerDesks(items, seen, { eng: 1 }, now), [{ desk: 'acme', count: 2 }, { desk: 'initech', count: 1 }],
    'not too new, not one never seen, not one kept with the person, not on an engaged desk');
  assert.deepEqual(offerDesks(items, seen, {}, now, 120 * 60000), []);
});

test("a desk's runs by day, newest first, each day with its cost", () => {
  const day = (t) => `d${Math.floor(t / 10)}`;
  const days = runsByDay([{ id: 'a', at: 1, cost: 0.1 }, { id: 'b', at: 12, cost: 0.2 }, { id: 'c', at: 15, cost: 0.05 }, { id: 'd', at: 3 }], day);
  assert.deepEqual(days.map((d) => [d.day, d.cost, d.runs.map((r) => r.id)]), [['d1', 0.25, ['c', 'b']], ['d0', 0.1, ['d', 'a']]]);
  assert.deepEqual(runsByDay(undefined), []);
});
