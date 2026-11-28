// Tests for talk mode's words (#1105): commands, spoken names, read-back text and priming. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, parse, route, clauses, READ_LEVELS, readLevelOf, levelAtLeast, inFamily, whyOf, turnWhy, whoLine, spokenLines, recheck, actedOn, actName, signinAct, LINE_QUIET_MS, nameScore, bestMatch, speakable, sentences, sayNumbers, labelNumber, primeText, isNoise, COMMAND_WORDS } from '../talk-grammar.mjs';
import { migrate, mayVoice, fixesOn } from '../talk.mjs';

test('normalize: punctuation, number words and Q numbers', () => {
  assert.equal(normalize('Go to the ACME desk.'), 'go to the acme desk');
  assert.equal(normalize('Q7, yes.'), 'q7 yes');
  assert.equal(normalize('Q 12 the second one'), 'q12 the second one');
  assert.equal(normalize('queue seven yes'), 'q7 yes');
  assert.equal(normalize('cue twenty three no'), 'q23 no');
  assert.equal(normalize("What's waiting?"), 'whats waiting');
});

test('navigation commands', () => {
  assert.deepEqual(parse('Go to the Acme desk.'), { kind: 'desk', name: 'acme' });
  assert.deepEqual(parse('Northwind desk'), { kind: 'desk', name: 'northwind' });
  assert.deepEqual(parse('Open the session about relay fix.'), { kind: 'open', name: 'relay fix' });
  assert.deepEqual(parse('Open relay fix'), { kind: 'open', name: 'relay fix' });
  assert.deepEqual(parse('show me the invoice one'), { kind: 'open', name: 'invoice' });
  assert.deepEqual(parse('Next waiting.'), { kind: 'next' });
  assert.deepEqual(parse("What's waiting?"), { kind: 'next' });
  assert.deepEqual(parse('Scroll down.'), { kind: 'scroll', dir: 'down' });
  assert.deepEqual(parse('scroll up'), { kind: 'scroll', dir: 'up' });
  assert.deepEqual(parse('Top.'), { kind: 'scroll', dir: 'top' });
  assert.deepEqual(parse('go to the bottom'), { kind: 'scroll', dir: 'bottom' });
  assert.equal(parse('up').kind, 'none', 'a lone "up" is not a scroll');
});

test('reading commands', () => {
  assert.equal(parse('Read it.').kind, 'read');
  assert.equal(parse('read again').kind, 'read');
  assert.equal(parse("Say that again").kind, "readBack", "not a dictation of \"that again\""); // what was heard (#1190)
  assert.equal(parse('More.').kind, 'more');
  assert.equal(parse('Stop.').kind, 'stop');
  assert.equal(parse('skip').kind, 'stop');
});

test('dictation keeps what was said, with its own capitals', () => {
  assert.deepEqual(parse('Tell it use the second option.'), { kind: 'dictate', text: 'Use the second option.' });
  assert.deepEqual(parse('tell it to merge after the tests pass'), { kind: 'dictate', text: 'To merge after the tests pass' });
  assert.deepEqual(parse('Reply, looks good to me.'), { kind: 'dictate', text: 'Looks good to me.' });
  assert.deepEqual(parse('Tell the session that the API key is in the vault'), { kind: 'dictate', text: 'The API key is in the vault' });
  assert.equal(parse('tell it').kind, 'none', 'nothing to say');
});

test('answers by question number', () => {
  assert.deepEqual(parse('Q7, yes.'), { kind: 'answer', n: 7, text: 'yes.' });
  assert.deepEqual(parse('Q9 the second one'), { kind: 'answer', n: 9, text: 'the second one' });
  assert.deepEqual(parse('queue seven keep the CSV export'), { kind: 'answer', n: 7, text: 'keep the CSV export' });
  assert.equal(parse('Q7').kind, 'none', 'a number with no answer');
});

test('acting commands are risky; send and cancel are not', () => {
  assert.deepEqual(parse('Merge.'), { kind: 'merge', risky: true });
  assert.deepEqual(parse('Merge it'), { kind: 'merge', risky: true });
  assert.deepEqual(parse('Archive this one.'), { kind: 'archive', risky: true });
  assert.deepEqual(parse('Stop the session.'), { kind: 'interrupt', risky: true });
  assert.deepEqual(parse('Send.'), { kind: 'send' });
  assert.deepEqual(parse('sent'), { kind: 'send' }, 'a common mishearing');
  assert.deepEqual(parse('Never mind'), { kind: 'cancel' });
});

test('new session in a desk called a title', () => {
  assert.deepEqual(parse('New session in Acme called invoice cleanup.'), { kind: 'new', desk: 'acme', title: 'invoice cleanup', risky: true });
  assert.deepEqual(parse('New session called Invoice cleanup in Acme'), { kind: 'new', desk: 'acme', title: 'Invoice cleanup', risky: true });
  assert.deepEqual(parse('new session'), { kind: 'new', desk: '', title: '', risky: true });
  assert.deepEqual(parse('Start a new session on the Northwind desk'), { kind: 'new', desk: 'northwind', title: '', risky: true });
});

test('yes and cancel answer what waits first', () => {
  assert.deepEqual(parse('Yes.', { pending: true }), { kind: 'yes' });
  assert.deepEqual(parse('Send', { pending: true }), { kind: 'yes' });
  assert.deepEqual(parse('Go ahead', { pending: true }), { kind: 'yes' });
  assert.deepEqual(parse('No.', { pending: true }), { kind: 'cancel' });
  assert.deepEqual(parse('Yes.'), { kind: 'none', heard: 'Yes.' }, 'nothing waits: not a command');
});

test('anything else is not a command, with what was heard', () => {
  assert.deepEqual(parse('I wonder what the weather is'), { kind: 'none', heard: 'I wonder what the weather is' });
  assert.equal(parse('').kind, 'none');
});

test('spoken names match titles fuzzily', () => {
  const items = [
    { id: 'a', label: 'Relay fix for the proxy' },
    { id: 'b', label: 'Invoice cleanup' },
    { id: 'c', label: '#1082 Research: talk mode by voice' },
    { id: 'd', label: 'Release notes' },
  ];
  assert.equal(bestMatch('relay fix', items).id, 'a');
  assert.equal(bestMatch('the relay one', items).id, 'a');
  assert.equal(bestMatch('invoice clean up', items).id, 'b');
  assert.equal(bestMatch('talk mode', items).id, 'c');
  assert.equal(bestMatch('research', items).id, 'c');
  assert.equal(bestMatch('release notes', items).id, 'd');
  assert.equal(bestMatch('quarterly taxes', items), null);
  assert.ok(nameScore('acme', 'Acme') > 0.95);
  assert.ok(nameScore('acne', 'Acme') >= 0.62, 'one letter misheard still fits');
});

test('speakable: first paragraph and Q lines first, code, tables, links and paths shortened', () => {
  const md = [
    'I fixed the **relay** in `server.mjs`. See [the PR](https://github.com/x/y/pull/1).',
    '',
    '```js',
    'const a = 1;',
    '```',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '| 3 | 4 |',
    '',
    'The file is at C:\\Work\\acme\\src\\talk.mjs and also https://example.com/page.',
    '',
    '**Q7: Keep the CSV export?**',
    'Q8: Merge now?',
  ].join('\n');
  const { head, rest } = speakable(md);
  assert.deepEqual(head, ['I fixed the relay in server.mjs. See the PR.', 'Q7: Keep the CSV export?', 'Q8: Merge now?']);
  assert.deepEqual(rest, ['Code block skipped.', 'A table with 2 rows.', 'The file is at talk.mjs and also a link']);
});

test('speakable: lists and headings read as their own lines', () => {
  const { head, rest } = speakable('## Done\n\n- one thing\n- *another* thing\n');
  assert.deepEqual(head, ['Done']);
  assert.deepEqual(rest, ['one thing', 'another thing']);
});

test('primeText: command words, then desks and titles, cut short', () => {
  const p = primeText(['Acme', 'Northwind'], ['Relay fix', 'Invoice cleanup', 'Relay fix']);
  assert.equal(p, `${COMMAND_WORDS} Desks: Acme, Northwind. Sessions: Relay fix, Invoice cleanup.`);
  const long = primeText(['Acme'], Array.from({ length: 100 }, (_, i) => `Session number ${i}`));
  assert.ok(long.length <= 400, long.length);
  assert.match(long, /Session number 0/);
});

test('isNoise: what Whisper says for silence', () => {
  for (const t of ['', '[BLANK_AUDIO]', ' (silence) ', 'Thank you.', 'you']) assert.ok(isNoise(t), t);
  assert.ok(!isNoise('Send.'));
});

// ---------- where a sentence goes (#1148) ----------
const via = (text, { pending = false, known } = {}) => route(text, parse(text, { pending }), { known });
const local = (text, ctx) => assert.deepEqual(via(text, ctx), { via: 'local' }, text);
const msg = (text, out = text, ctx) => assert.deepEqual(via(text, ctx), { via: 'message', text: out }, text);

test('a whole sentence that is one screen command stays here', () => {
  for (const t of ['Stop.', 'Read it again.', 'More.', 'Next waiting.', "What's waiting?", 'Scroll down.', 'Go to the bottom.',
    'Send.', 'Cancel.', 'Q7 yes.', 'Queue twelve the second one', 'Merge.', 'Archive this one.', 'Interrupt.']) local(t);
  local('Yes.', { pending: true });
  local('Go to the Docket desk.');
  local('Open relay fix.');
  local('show me the invoice one');
  local('New session.');
  local('New session in the Acme desk called invoice fix');
});

test('everything else goes to the session as a message, as said', () => {
  msg('Start a new session in the Docket group and file an issue that the talk strip takes too much room.');
  msg('Open the logs and check the 9:40 restart.', 'Open the logs and check the 9:40 restart.'); // only starts with a command word
  msg('Go to the Docket desk and open relay fix.');
  msg('Open relay fix. Then read it.');
  msg('Write a test for the parser.'); // keeps its "write"
  msg('Use the second option.');
  msg('Move the file to my desk.');
  msg('Yes.'); // nothing waits on a yes, so it is an answer for the session
  msg('Tell it to use the second option.', 'To use the second option.');
  msg('tell the session that the build passed', 'The build passed');
});

test('a long name stays a command only when it fits a session or desk well', () => {
  const t = 'Open the plans and phases rework for the coordinator';
  msg(t);
  local(t, { known: (c) => c.kind === 'open' && c.name.startsWith('plans and phases') });
  msg('Open relay fix. Then read it.', 'Open relay fix. Then read it.', { known: () => true }); // two sentences are never one command
});

test('clauses: sentences and "and then"', () => {
  assert.deepEqual(clauses('Go to the Acme desk. Open relay fix'), ['Go to the Acme desk', 'Open relay fix']);
  assert.deepEqual(clauses('go to acme and then open relay fix'), ['go to acme', 'open relay fix']);
  assert.deepEqual(clauses('open the logs and check the restart'), ['open the logs and check the restart']);
});

// ---------- Read aloud's levels (#1148) ----------
test('the levels, in order, Off by default', () => {
  assert.deepEqual(READ_LEVELS.map(([k]) => k), ['off', 'who', 'open', 'family']);
  assert.equal(READ_LEVELS[0][1], 'Off');
  assert.equal(readLevelOf(undefined), 'off');
  assert.equal(readLevelOf('loud'), 'off');
  assert.equal(readLevelOf('chimes'), 'off'); // its old name (#1177)
  assert.equal(levelAtLeast('open', 'who'), true);
  assert.equal(levelAtLeast('who', 'open'), false);
  assert.equal(levelAtLeast('family', 'family'), true);
});

test('everyone starts on Off, those who had Read aloud on too, and a saved Chimes is Off', () => {
  const run = (saved) => { const m = new Map(Object.entries({ lineFixesOn: true, ...saved })); migrate((k, d) => (m.has(k) ? m.get(k) : d), (k, v) => m.set(k, v)); m.delete('lineFixesOn'); return Object.fromEntries(m); };
  assert.deepEqual(run({ listen: true, read: true }), { listen: true, read: true, readLevel: 'off' });
  assert.deepEqual(run({ on: true }), { on: true, listen: true, readLevel: 'off' }); // before #1145
  assert.deepEqual(run({ listen: true, readLevel: 'chimes' }), { listen: true, readLevel: 'off' }); // before #1177
  assert.deepEqual(run({ listen: false, readLevel: 'open' }), { listen: false, readLevel: 'open' }); // picked since: kept
});

test('the line fixes are on by default, a false stored before #1258 counts as unset once, and one set since is kept', () => {
  const store = (saved) => { const m = new Map(Object.entries(saved)); return { m, get: (k, d) => (m.has(k) ? m.get(k) : d), set: (k, v) => m.set(k, v) }; };
  assert.equal(fixesOn(store({}).get), true, 'nothing stored: on');
  for (const saved of [{}, { lineFixes: false }, { lineFixes: true }]) {
    const s = store(saved); migrate(s.get, s.set);
    assert.equal(fixesOn(s.get), true, `${JSON.stringify(saved)}: on after the migration`);
    assert.equal(s.get('lineFixesOn'), true, 'the migration is marked done');
  }
  const s = store({ lineFixes: false }); migrate(s.get, s.set);
  s.set('lineFixes', false); // talk.setLineFixes(false), to troubleshoot
  migrate(s.get, s.set);
  assert.equal(fixesOn(s.get), false, 'switched off since: stays off, the migration runs once');
});

test("at Off nothing is voiced, talk mode's answers to the microphone included (#1177)", () => {
  const at = (level, more = {}) => mayVoice({ level, prompt: true, micAgo: 1000, locked: true, screenLocked: false, canSpeak: true, ...more });
  assert.equal(at('off'), false);
  assert.equal(at('off', { prompt: false }), false);
  assert.equal(at('who'), true);
  assert.equal(at('who', { prompt: false }), true);
  assert.equal(at('who', { micAgo: 11000 }), false); // a prompt only answers the microphone
  assert.equal(at('family', { screenLocked: true }), false); // #1173
  assert.equal(at('open', { locked: false }), false);
});

test('only the open session and the sessions under it get lines', () => {
  const parents = { kid: 'open', grandkid: 'kid', other: 'top', loop1: 'loop2', loop2: 'loop1' };
  const parentOf = (id) => parents[id] || null;
  assert.equal(inFamily('open', 'open', parentOf), true);
  assert.equal(inFamily('kid', 'open', parentOf), true);
  assert.equal(inFamily('grandkid', 'open', parentOf), true);
  assert.equal(inFamily('other', 'open', parentOf), false);
  assert.equal(inFamily('top', 'open', parentOf), false);
  assert.equal(inFamily('loop1', 'open', parentOf), false);
  assert.equal(inFamily('kid', null, parentOf), false);
});

test('who and why: one line, no reply text', () => {
  assert.equal(whyOf('question'), 'question'); assert.equal(whyOf('card'), 'waiting'); assert.equal(whyOf('problem'), 'waiting');
  assert.equal(whyOf('merge'), 'merge'); assert.equal(whyOf('reply'), 'done'); assert.equal(whyOf('done'), 'done');
  assert.equal(whoLine({ title: 'Relay fix', why: 'done' }), 'Relay fix is done');
  assert.equal(whoLine({ title: 'Relay fix', why: 'question' }), 'Relay fix has a question');
  assert.equal(whoLine({ title: 'Relay fix', why: 'waiting' }), 'Relay fix is waiting on you');
  assert.equal(whoLine({ title: 'Relay fix', why: 'merge', pr: 12 }), 'Relay fix wants to merge #12');
});

test('a sign-in says the site, comes first, and stays while its session keeps working (#1253)', () => {
  assert.equal(whyOf('signin'), 'signin');
  assert.equal(whoLine({ title: 'Relay fix', why: 'signin', site: 'example.com' }), 'Relay fix needs you to sign in to example.com');
  const s = { id: 's', title: 'Relay fix', why: 'signin', site: 'example.com' }, d = { id: 'd', title: 'Docs', why: 'done' };
  assert.deepEqual(spokenLines([d, s], { level: 'who', now: 1e6 }).parts, ['Relay fix needs you to sign in to example.com, and Docs is done.']);
  const now = { needs: true, working: false, why: 'signin', site: 'example.com' }; // the page's needOf: not working while a sign-in waits
  assert.deepEqual(recheck([s], () => now).items, [s]);
  assert.deepEqual(recheck([s], () => ({ ...now, site: 'example.com and example.org' })).redone.map((x) => x.why), ['Relay fix needs you to sign in to example.com and example.org']);
  assert.deepEqual(recheck([s], () => ({ needs: false, working: true, why: 'done' })).dropped.map((x) => x.why), ['signed in'], 'signed in: the line goes');
});

// #1260: the turn-end line said "needs you to sign in" after the user had already signed in.
test("a sign-in line goes once signed in, and other lines say how the turn stands, not the sign-in", () => {
  const s = { id: 's', title: 'Relay fix', why: 'signin', site: 'example.com' };
  assert.deepEqual(recheck([s], () => ({ needs: true, working: false, why: 'done', turnWhy: 'done' })).dropped.map((x) => x.why), ['signed in'], 'the need cleared while it was idle');
  // the page's needOf for a session whose turn ended while its sign-in is still open
  const open = { needs: true, needsTurn: true, working: false, why: 'signin', site: 'example.com', turnWhy: 'done' };
  const d = { id: 's', title: 'Relay fix', why: 'done' };
  assert.deepEqual(recheck([d], () => open).items, [d], 'a done line stays done, not turned into a sign-in');
  assert.deepEqual(recheck([d], () => ({ ...open, turnWhy: 'question' })).redone.map((x) => x.why), ['Relay fix has a question']);
  assert.deepEqual(recheck([d], () => ({ ...open, needsTurn: false })).dropped.map((x) => x.why), ['no longer needs you'], 'only the sign-in waits');
  assert.deepEqual(recheck([d], () => ({ needs: true, working: false, why: 'done' })).items, [d], 'a page without turnWhy reads as before');
  assert.equal(turnWhy({ label: 'reply', said: 'reply', needs: false }), 'done', 'the turn line takes turnLabel, so a sign-in never reaches it');
});

// #1181: the open session's turn gets a line only when it needs you, and wants to merge only when the turn asked to.
test('a turn ending gets a line only when it needs you or declared something left for you', () => {
  assert.equal(turnWhy({ label: 'reply', said: 'reply' }), 'done');
  assert.equal(turnWhy({ label: 'question', said: 'question' }), 'question');
  assert.equal(turnWhy({ label: 'merge', said: 'merge' }), 'merge');
  assert.equal(turnWhy({ label: 'reply', needs: true }), 'done');
  assert.equal(turnWhy({ label: 'reply' }), '', 'declared nothing and does not need you');
  assert.equal(turnWhy({ label: 'done', said: 'done', needs: true }), '', 'marked done');
  assert.equal(turnWhy({ label: 'reply', said: 'reply', quiet: true }), '', 'quiet');
  // the page gives 'merge' only for a merge ask, so a reply in a session with an open pull request says reply
  assert.equal(turnWhy({ label: 'reply', said: 'reply', needs: true }), 'done');
  const read = spokenLines([{ id: 'o', title: 'Relay fix', ...speakable('Fixed it.') }], { level: 'open', now: 1e6 });
  assert.deepEqual(read.parts, ['Relay fix.', 'Fixed it.'], 'no line, the reply still read at Open session');
});

const reply = speakable('Fixed the relay. All tests pass.\n\nQ3: Merge it?\n\nDetails: the proxy kept the old port.');
const open = { id: 'open', title: 'Relay fix', why: 'done', ...reply };
const kid = (id, why = 'done', more = {}) => ({ id, title: `Kid ${id}`, why, ...more });

test('each level says what it should', () => {
  const items = [open, kid('a', 'done', { report: 'Filed issue 12. It has the steps.' })];
  assert.deepEqual(spokenLines(items, { level: 'off', now: 1e6 }).parts, []);
  assert.deepEqual(spokenLines(items, { level: 'who', now: 1e6 }).parts, ['Two sessions are done.']);
  assert.deepEqual(spokenLines(items, { level: 'who', now: 1e6, fixes: true }).parts, ['Kid a is done.'], 'with the line fixes, the session being viewed gets no status line (#1177)');
  const o = spokenLines(items, { level: 'open', now: 1e6 });
  assert.deepEqual(o.parts, ['Relay fix is done.', 'Fixed the relay. All tests pass.', 'Q3: Merge it?', 'Kid a is done.', 'Say more for the rest.']);
  assert.deepEqual(o.rest, ['Details: the proxy kept the old port.']);
  assert.deepEqual(spokenLines(items, { level: 'family', now: 1e6 }).parts,
    ['Relay fix is done.', 'Fixed the relay. All tests pass.', 'Q3: Merge it?', 'Kid a: Filed issue twelve.', 'Say more for the rest.']); // issue 12: a label number, said as people say it (#1157)
});

test('lines close together merge, as the chimes do, and a family that just finished stays quiet', () => {
  const now = 1e6;
  assert.deepEqual(spokenLines([kid('a'), kid('b'), kid('c')], { level: 'who', now }).parts, ['Three sessions are done.']);
  assert.deepEqual(spokenLines([kid('a'), kid('b', 'question'), kid('a', 'done')], { level: 'who', now }).parts, ['Kid b has a question, and Kid a is done.']);
  assert.deepEqual(spokenLines([kid('a'), kid('a')], { level: 'who', now }).parts, ['Kid a is done.'], 'the same session once');
  const first = spokenLines([kid('a')], { level: 'who', now });
  assert.equal(first.doneAt, now);
  assert.deepEqual(spokenLines([kid('b')], { level: 'who', now: now + 30000, doneAt: first.doneAt }).parts, [], 'quiet for a minute after a done line');
  assert.deepEqual(spokenLines([kid('b', 'question')], { level: 'who', now: now + 30000, doneAt: first.doneAt }).parts, ['Kid b has a question.'], 'a question skips the wait');
  assert.deepEqual(spokenLines([kid('b')], { level: 'who', now: now + LINE_QUIET_MS, doneAt: first.doneAt }).parts, ['Kid b is done.']);
  assert.deepEqual(spokenLines([open], { level: 'open', now: now + 1000, doneAt: now }).parts.slice(0, 2), ['Relay fix is done.', 'Fixed the relay. All tests pass.'], "the open session's reply is always read");
  assert.deepEqual(spokenLines([{ ...open, why: 'merge', pr: 12 }], { level: 'open', now, fixes: true }).parts[0], 'Relay fix.', 'with the line fixes, no "wants to merge" for the session being viewed');
});

test('sentences: one piece per sentence for the natural voice, short ones joined, long ones and the first ones cut at a comma', () => {
  // a short title read first rides with the next sentence, so it does not play alone and leave a gap (#1216)
  assert.deepEqual(sentences(['Docket.', 'The tests pass. Version 3.5 is out! See talk.mjs for more. Ok. Done now, really done.']),
    ['Docket. The tests pass. Version 3.5 is out!', 'See talk.mjs for more. Ok.', 'Done now, really done.']);
  assert.deepEqual(sentences(['Fix read-aloud pause after session title.', 'I fixed it. Tests pass.', 'Say more for the rest.']),
    ['Fix read-aloud pause after session title.', 'I fixed it. Tests pass. Say more for the rest.']);
  // pieces stay short until 50 letters are queued, since nothing plays until the first is made, cut at a comma
  const long = sentences(['A ' + 'very long clause, '.repeat(20) + 'end.']);
  assert.equal(long.length, 4);
  assert.ok(long[0].length <= 50 && long[1].length <= 50 && long.every((x) => x.length <= 240) && long[0].endsWith(','));
  assert.deepEqual(sentences(['A short start, then the sentence goes on for quite a while longer than the first.']),
    ['A short start, then the sentence goes on for quite a while longer than the first.'], 'a comma too early is not a cut');
  assert.deepEqual(sentences(['Another sentence follows it here, and it goes on for quite a while longer than the first.']),
    ['Another sentence follows it here,', 'and it goes on for quite a while longer than the first.']);
  // never at a space to start sooner: that split a status line between the title and what happened (#1216)
  for (const line of ['Read-aloud pause between session title and action is done.', 'Fix missing tooltip on autopilot cap input wants to merge twelve thirteen.'])
    assert.deepEqual(sentences([line]), [line]);
  assert.deepEqual(sentences(['Docket.', 'I finished the change and opened PR eleven fifty-four at version one, two forty-five. Say merge when you are ready.']),
    ['Docket. I finished the change and opened PR eleven fifty-four at version one, two forty-five.', 'Say merge when you are ready.']);
  // one over the longest piece is cut at a space, never inside a number said in words
  const over = sentences([`${'word '.repeat(45)}PR eleven fifty-four and more words after it.`]);
  assert.ok(over.length === 2 && over.every((x) => x.length <= 240) && over[1].startsWith('eleven fifty-four'), JSON.stringify(over));
  assert.deepEqual(sentences(['', null, '  ']), []);
});

test('label numbers read in pairs: eleven forty-six, nine forty-two, eleven oh five, eleven hundred; five digits one by one', () => {
  assert.equal(labelNumber('1146'), 'eleven forty-six');
  assert.equal(labelNumber('1153'), 'eleven fifty-three');
  assert.equal(labelNumber('942'), 'nine forty-two');
  assert.equal(labelNumber('905'), 'nine oh five');
  assert.equal(labelNumber('1105'), 'eleven oh five');
  assert.equal(labelNumber('1100'), 'eleven hundred');
  assert.equal(labelNumber('2000'), 'two thousand');
  assert.equal(labelNumber('12345'), 'one two three four five');
  assert.equal(labelNumber('7'), 'seven');
  assert.equal(labelNumber('42'), 'forty-two');
});

test('issue and PR numbers after #, issue, PR, pull request, build and session', () => {
  assert.equal(sayNumbers('Fixes #1146 and #1153.'), 'Fixes eleven forty-six and eleven fifty-three.');
  assert.equal(sayNumbers('issue 1146, PR 1153, pull request 1153, build 1146, session 1146, PR #942'),
    'issue eleven forty-six, PR eleven fifty-three, pull request eleven fifty-three, build eleven forty-six, session eleven forty-six, PR nine forty-two');
  assert.equal(sayNumbers('C#1 and &#1234; stay'), 'C#1 and &#1234; stay');
});

test('versions part by part, a trailing .0 dropped', () => {
  assert.equal(sayNumbers('Bumped to version 1.243.0.'), 'Bumped to version one, two forty-three.');
  assert.equal(sayNumbers('was v1.242.1'), 'was version one, two forty-two, one');
});

test('a commit hash, after commit or in backticks, is "a commit"; other code in backticks stays', () => {
  assert.equal(sayNumbers('Pushed commit 9da00d3.'), 'Pushed a commit.');
  assert.equal(sayNumbers('the commit `d14b54c` and `9da00d3e1f2a`'), 'a commit and a commit');
  assert.equal(sayNumbers('`defaced` and `npm test`'), '`defaced` and `npm test`');
});

test('amounts stay: Qn, times, money, counts', () => {
  const t = 'Q7 yes. At 10:30, $1,153 for 3 sessions, 1153 lines.';
  assert.equal(sayNumbers(t), t);
  assert.deepEqual(speakable('Opened [PR #1154](https://github.com/x/pull/1154), commit `d14b54c`, version 1.245.0. Q7 yes.').head,
    ['Opened PR eleven fifty-four, a commit, version one, two forty-five. Q7 yes.']);
});

// ---------- stale and redundant lines (#1177) ----------
test('just before a line is spoken, each session in it is looked at again', () => {
  const merge = kid('m', 'merge', { pr: 12 }), q = kid('q', 'question');
  const now = (states) => (id) => ({ needs: true, why: { m: 'merge', q: 'question' }[id], pr: id === 'm' ? 12 : null, ...states[id] });
  assert.deepEqual(recheck([merge, q], now({})), { items: [merge, q], changed: false, dropped: [], redone: [] }, 'nothing changed: said as it was');
  const merged = recheck([merge, q], now({ m: { needs: false } }));
  assert.deepEqual(merged.items, [q], 'merged: no longer needs you');
  assert.deepEqual(merged.dropped, [{ item: merge, why: 'no longer needs you' }], 'in words, for the timing log');
  assert.deepEqual(recheck([merge], now({ m: { working: true } })).dropped.map((d) => d.why), ['working again']);
  assert.deepEqual(recheck([merge], now({ m: { gone: true } })).items, [], 'archived');
  assert.deepEqual(recheck([merge], now({ m: { muted: true } })).items, [], 'muted since');
  assert.deepEqual(recheck([merge], () => null).items, [], 'not known any more');
  const r = recheck([q], now({ q: { why: 'waiting' } }));
  assert.equal(r.changed, true);
  assert.deepEqual(r.redone.map((d) => d.why), ['Kid q is waiting on you']);
  assert.deepEqual(spokenLines(r.items, { level: 'who', now: 1e6 }).parts, ['Kid q is waiting on you.'], 'a new reason: the line is made again');
  const rep = kid('r', 'done', { report: 'Filed it.' });
  assert.deepEqual(recheck([rep], now({ r: { working: true, needs: false } })).items, [rep], 'a report stays while its session works on');
  assert.deepEqual(recheck([open], now({ open: { needs: false } })).items, [open], "the open session's reply stays once read");
  assert.deepEqual(recheck([open], now({ open: { working: true } })).items, [], '…and goes once a message was sent to it');
});

test("the user's own actions on a session name it, so its waiting lines go", () => {
  assert.deepEqual(actedOn('/api/sessions/abc/send?client=acme', { text: 'merge' }), ['abc'], 'a message, Merge, or a Q answer');
  assert.deepEqual(actedOn('/api/sessions/abc/permission', { reqId: 'r1', allow: true }), ['abc'], 'Allow, Deny or a form answer');
  assert.deepEqual(actedOn('/api/sessions/abc/interrupt', {}), ['abc'], 'Stop');
  assert.deepEqual(actedOn('/api/sessions/abc/archive?client=acme', { archived: true, alsoIds: ['k1', 'k2'] }), ['abc', 'k1', 'k2'], 'Archive, with the sessions under it');
  assert.deepEqual(actedOn('/api/sessions/abc/archive?client=acme', { archived: false, alsoIds: ['k1'] }), ['abc'], 'restore');
  assert.deepEqual(actedOn('/api/sessions/abc/send', undefined), [], 'a read, not an action');
  assert.deepEqual(actedOn('/api/sessions/abc/rename', { title: 'x' }), [], 'not an answer to it');
  assert.deepEqual(actedOn('/api/startup', {}), []);
  assert.deepEqual(actedOn('/api/clients/acme/browser-open', { url: 'https://example.com', session: 'abc' }), ['abc'], "a sign-in card's Sign in (#1260)");
  assert.deepEqual(actedOn('/api/clients/acme/browser-done', { session: 'abc' }), ['abc'], '…and its Done');
  assert.deepEqual(actedOn('/api/clients/acme/browser-open', { url: 'https://example.com' }), [], 'the 🌐 menu, for no session');
  assert.equal(actName('/api/clients/acme/browser-open', { session: 'abc' }), 'opened the sign-in');
  assert.equal(signinAct('/api/clients/acme/browser-done', { session: 'abc' }), 'done');
  assert.equal(signinAct('/api/sessions/abc/send', { text: 'hi' }), '');
});
