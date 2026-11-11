// Tests for the autopilot's rules (pilot.mjs, #821): the rules check and the hard stops. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, STOPS, DEFAULT_RULES, cleanRules, permissionStops, itemStops, ruleFor, mayAnswer, logLine, runLine, pilotDeskEntry, pilotSessionRefusal, OWN_DESK, runStep, runDone, pilotSetting, pilotSettingRefusal, runsToArchive, RUN_KEEP_MS, pilotState,
  JUDGMENT, upgradeRules, maySuggest, sameAnswer, answerLabel, learnLine, confidence, promotable, setDeskLevel, pastAnswers, LEARN, stricter } from '../pilot.mjs';
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

// ---------- the autopilot's own desk (#875) ----------
test("what waits on the autopilot's own desk stays with the person, whatever the rules say", () => {
  const all = { kinds: Object.fromEntries(Object.keys(KINDS).map((k) => [k, 'allow'])), stops: Object.fromEntries(Object.keys(STOPS).map((k) => [k, 'allow'])) };
  for (const kind of Object.keys(KINDS)) {
    const own = mayAnswer(all, { kind, desk: 'autopilot' }, KINDS[kind].answers[0], undefined, 'autopilot');
    assert.equal(own.ok, false, kind);
    assert.match(own.why, /autopilot's own desk: it stays with the person/, kind);
    if (KINDS[kind].decline) assert.equal(mayAnswer(all, { kind, desk: 'autopilot' }, KINDS[kind].decline, undefined, 'autopilot').ok, false, `${kind}: not even a decline`);
  }
  assert.equal(ruleFor(all, perm('ls', { desk: 'autopilot' }), 'autopilot').level, 'ask');
  assert.equal(ruleFor(all, perm('ls', { desk: 'autopilot' }), 'autopilot').why, OWN_DESK);
  // Every other desk on this computer still goes by the rules, and the hard stops still hold there.
  assert.equal(mayAnswer(DEFAULT_RULES, perm('npm test'), 'allow', undefined, 'autopilot').ok, true);
  assert.equal(mayAnswer(DEFAULT_RULES, perm('gh pr merge 12'), 'allow', undefined, 'autopilot').ok, false);
  assert.equal(mayAnswer(DEFAULT_RULES, { kind: 'merge', desk: 'acme' }, 'merge', undefined, 'autopilot').ok, false);
  // No autopilot desk (as before #875): the rules alone.
  assert.equal(mayAnswer(DEFAULT_RULES, perm('npm test', { desk: 'autopilot' }), 'allow').ok, true);
  // An item on a remote desk that only shares the id is that computer's, not this autopilot's own.
  assert.equal(mayAnswer(DEFAULT_RULES, perm('npm test', { desk: 'autopilot', there: 'permission:9' }), 'allow', 'allow', 'autopilot').ok, true);
});

test("only a session of the autopilot's desk can be the pilot, and the refusal says why", () => {
  const desk = { id: 'autopilot', name: 'Autopilot' };
  assert.equal(pilotSessionRefusal({ id: 's1', desk: 'autopilot', deskName: 'Autopilot' }, desk), '');
  const no = pilotSessionRefusal({ id: 's2', desk: 'acme', deskName: 'Acme' }, desk);
  assert.match(no, /on the desk Acme/);
  assert.match(no, /autopilot's own desk, Autopilot/);
  assert.match(pilotSessionRefusal({ id: 's2', desk: 'acme', deskName: 'Acme' }, null), /no desk yet/);
  assert.equal(pilotSessionRefusal(null, desk), '', 'no pilot is always allowed');
});

test('the Autopilot desk is filled in the way Add a desk fills a new one', () => {
  const roots = { claude: '/home/a/Docket desks', grok: '/home/a/Docket desks/grok_home', docket: '/home/a/Docket', sep: '/' };
  assert.deepEqual(pilotDeskEntry(roots, []), { name: 'Autopilot', folder: '/home/a/Docket desks/Autopilot', home: '/home/a/Docket desks/Autopilot/claude-home', grokHome: '/home/a/Docket desks/grok_home/Autopilot', defaultEngine: 'grok' });
  // A name or folder another desk uses is passed over.
  const taken = [{ name: 'autopilot', home: '/elsewhere/claude-home' }, { name: 'Other', home: '/home/a/Docket desks/Autopilot 2/claude-home' }];
  assert.equal(pilotDeskEntry(roots, taken).name, 'Autopilot 3');
  // No Grok root of its own: grok_home beside the Claude homes, as Add a desk does.
  assert.equal(pilotDeskEntry({ claude: '/w', docket: '/opt/docket', sep: '/' }, []).grokHome, '/w/grok_home/Autopilot');
  // Windows paths keep their separator.
  assert.equal(pilotDeskEntry({ claude: 'C:\\Work', grok: 'C:\\Work\\grok_home', docket: 'C:\\Docket', sep: '\\' }, []).home, 'C:\\Work\\Autopilot\\claude-home');
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

test("the pilot's brand: Claude unless picked, always on that brand's top gear, and only a brand its desk has signed in", () => {
  assert.deepEqual(pilotSetting(undefined, GEARS), { brand: 'claude', gear: 'opus' });
  assert.deepEqual(pilotSetting({ brand: 'grok' }, GEARS), { brand: 'grok', gear: 'full' });
  assert.deepEqual(pilotSetting({ brand: 'codex', gear: 'luna' }, GEARS), { brand: 'codex', gear: 'astra' }, 'a gear saved before is not used');
  assert.deepEqual(pilotSetting({ brand: 'nope' }, GEARS), { brand: 'claude', gear: 'opus' });
  const offered = [{ brand: 'claude', signedIn: false }, { brand: 'grok', signedIn: true }];
  assert.equal(pilotSettingRefusal({ brand: 'grok' }, offered, GEARS), '');
  assert.match(pilotSettingRefusal({ brand: 'claude' }, offered, GEARS), /not signed in to claude/);
  assert.match(pilotSettingRefusal({ brand: 'codex' }, offered, GEARS), /does not use codex/);
  assert.match(pilotSettingRefusal({ brand: 'x' }, offered, GEARS), /not a brand/);
});

test('finished runs stay a week in the list, then are archived', () => {
  const now = 100 * RUN_KEEP_MS, old = now - RUN_KEEP_MS - 1, fresh = now - 1000;
  const sessions = { a: { client: 'ap', createdAt: old }, b: { client: 'ap', createdAt: fresh }, c: { client: 'ap', createdAt: old, archived: true },
    d: { client: 'acme', createdAt: old }, e: { client: 'ap', createdAt: old }, f: { client: 'ap' } };
  assert.deepEqual(runsToArchive(sessions, 'ap', 'e', now), ['a'], 'only old, unarchived runs of that desk, never the one going now');
  assert.deepEqual(runsToArchive(undefined, 'ap', null, now), []);
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
