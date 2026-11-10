// Tests for the autopilot's rules (pilot.mjs, #821): the rules check and the hard stops. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, STOPS, DEFAULT_RULES, cleanRules, permissionStops, itemStops, ruleFor, mayAnswer, logLine, pilotDeskEntry, pilotSessionRefusal, OWN_DESK } from '../pilot.mjs';

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
