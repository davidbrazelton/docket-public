// Tests for the autopilot's rules (pilot.mjs, #821): the rules check and the hard stops. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, STOPS, DEFAULT_RULES, cleanRules, permissionStops, itemStops, ruleFor, mayAnswer, logLine, runLine, pilotDeskEntry, pilotSessionRefusal, OWN_DESK, runStep, runDone, pilotSetting, pilotSettingRefusal } from '../pilot.mjs';
import { GEARS } from '../gears.mjs';

const perm = (command, extra = {}) => ({ id: 'permission:1', kind: 'permission', desk: 'acme', tool: 'Bash', input: { command }, ...extra });

test('the safe defaults let the pilot answer prompts and forms, and keep cards, merges and sign-ins with the person', () => {
  assert.equal(mayAnswer(DEFAULT_RULES, perm('npm test'), 'allow').ok, true);
  assert.equal(mayAnswer(DEFAULT_RULES, { kind: 'question', desk: 'acme' }, 'answer').ok, true);
  assert.equal(mayAnswer(DEFAULT_RULES, { kind: 'offer', desk: 'acme' }, 'new').ok, true);
  for (const kind of ['card', 'handoff', 'inbox', 'cross', 'merge', 'signin', 'remote', 'plan']) {
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

test("the pilot's brand: Claude on its lowest gear by default, and only a brand its desk has signed in", () => {
  assert.deepEqual(pilotSetting(undefined, GEARS), { brand: 'claude', gear: 'haiku' });
  assert.deepEqual(pilotSetting({ brand: 'grok' }, GEARS), { brand: 'grok', gear: 'fast' });
  assert.deepEqual(pilotSetting({ brand: 'codex', gear: 'sol' }, GEARS), { brand: 'codex', gear: 'sol' });
  assert.deepEqual(pilotSetting({ brand: 'nope', gear: 'opus' }, GEARS), { brand: 'claude', gear: 'opus' });
  assert.deepEqual(pilotSetting({ brand: 'claude', gear: 'fast' }, GEARS), { brand: 'claude', gear: 'haiku' }, "another brand's gear is the lowest");
  const offered = [{ brand: 'claude', signedIn: false }, { brand: 'grok', signedIn: true }];
  assert.equal(pilotSettingRefusal({ brand: 'grok', gear: 'fast' }, offered, GEARS), '');
  assert.match(pilotSettingRefusal({ brand: 'claude', gear: 'haiku' }, offered, GEARS), /not signed in to claude/);
  assert.match(pilotSettingRefusal({ brand: 'codex', gear: 'luna' }, offered, GEARS), /does not use codex/);
  assert.match(pilotSettingRefusal({ brand: 'grok', gear: 'opus' }, offered, GEARS), /not a gear of grok/);
  assert.match(pilotSettingRefusal({ brand: 'x' }, offered, GEARS), /not a brand/);
});

test('the log links each run: its answers carry the run, and the run has lines of its own', () => {
  assert.equal(logLine({ at: 1, item: { id: 'permission:k', kind: 'permission', desk: 'acme' }, answer: 'allow', ok: true, why: '', run: 'r1' }).run, 'r1');
  assert.equal('run' in logLine({ at: 1, item: { id: 'x', kind: 'card', desk: 'acme' }, answer: 'start', ok: true, why: '' }), false);
  assert.deepEqual(runLine({ at: 2, run: 'r1', answer: 'started', what: '2 items', brand: 'grok', gear: 'fast' }), { at: 2, kind: 'run', run: 'r1', answer: 'started', what: '2 items', ok: true, brand: 'grok', gear: 'fast' });
});
