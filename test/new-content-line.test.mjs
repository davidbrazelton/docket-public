// Tests for #672: the New since you last looked line, and a parent's quiet turns folded into one line. Runs those
// parts of index.html on their own, and quiet-turns.mjs. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { turnKey, keepQuiet, markQuiet } from '../quiet-turns.mjs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = page.indexOf('// ---------- new since you last looked, and folded quiet turns');
const end = page.indexOf('// end of new since you last looked');
assert.ok(start > 0 && end > start, 'the new-since-you-last-looked part of index.html has moved or lost its markers');
const { chatRuns, newIndex } = new Function(page.slice(start, end) + '\nreturn { chatRuns, newIndex };')();

const report = (at) => ({ k: 'child-report', childId: 'c', title: 'Child', text: 'done', at });
const reply = (id, at) => ({ k: 'text', id: `${id}:0`, text: 'ok', at });
const done = (at, quiet) => ({ k: 'result', at, ...(quiet ? { quiet: true } : {}) });

test('quiet turns side by side fold into one run; the others stay as they are', () => {
  const ev = [
    { k: 'user', text: 'build it', at: 1 }, reply('m1', 2), done(3),
    report(4), reply('m2', 5), done(6, true),
    report(7), reply('m3', 8), done(9, true),
    report(10), reply('m4', 11), done(12),
  ];
  const runs = chatRuns(ev);
  assert.deepEqual(runs.slice(0, 3), [{ i: 0 }, { i: 1 }, { i: 2 }]);
  assert.deepEqual(runs[3], { fold: [3, 8], turns: 2 }, 'two quiet turns, one line');
  assert.deepEqual(runs.slice(4).map((r) => r.i), [9, 10, 11], 'a turn that turned the parent orange never folds');
});

test('a quiet turn holding anything that needs the person does not fold', () => {
  for (const odd of [{ k: 'user', text: 'typed by the person', at: 2 }, { k: 'error', text: 'x', at: 2 }, { ...report(2), waiting: true },
    { k: 'permission', id: 'p', state: 'pending', at: 2 }, { k: 'proposal', id: 'q', state: 'open', at: 2 }]) {
    const runs = chatRuns([report(1), odd, reply('m', 3), done(4, true)]);
    assert.ok(runs.every((r) => !r.fold), `${odd.k} keeps the turn open`);
  }
  const fromDocket = chatRuns([{ k: 'user', text: '', from: 'docket', at: 1 }, reply('m', 2), done(3, true)]);
  assert.deepEqual(fromDocket, [{ fold: [0, 2], turns: 1 }], 'a message from Docket or a session folds with its turn');
});

test('the line goes above the first message after the last look, and nowhere without one', () => {
  const ev = [{ k: 'user', text: 'a', at: 10 }, reply('m', 20), done(30), reply('n', 40)];
  assert.equal(newIndex(ev, 15), 1);
  assert.equal(newIndex(ev, 25), 3, 'a Done line is not a message');
  assert.equal(newIndex(ev, 50), -1, 'nothing new');
  assert.equal(newIndex(ev, null), -1, 'never looked: no line');
  assert.equal(newIndex([{ k: 'note', text: 'no time' }, reply('m', 5)], 1), 1, 'a message without a time is skipped');
});

test('a turn is named by its last reply or step, the same in the live chat and the transcript', () => {
  assert.equal(turnKey([done(1), reply('abc', 2), { k: 'tool', id: 'toolu_1', at: 3 }]), 'u:toolu_1');
  assert.equal(turnKey([{ k: 'tool', id: 'toolu_1' }, { k: 'text', id: 'abc:2' }]), 't:abc');
  assert.equal(turnKey([reply('abc', 1), done(2)]), '', 'nothing after the last Done line');
  assert.deepEqual(keepQuiet(['a', 'b'], 'a'), ['b', 'a']);
  assert.deepEqual(keepQuiet(['a', 'b', 'c'], 'd', 3), ['b', 'c', 'd'], 'only the newest are kept');
  assert.deepEqual(keepQuiet(['a'], ''), ['a']);
});

test('a chat read from the transcript folds the turns saved as quiet', () => {
  const ev = markQuiet([reply('m1', 1), done(2), { k: 'text', id: 'm2:1' }, { k: 'tool', id: 'toolu_9' }, done(3), reply('m3', 4), done(5)], ['u:toolu_9', 't:m3']);
  assert.deepEqual(ev.filter((e) => e.k === 'result').map((e) => !!e.quiet), [false, true, true]);
});

test('the server flags a quiet Done line, keeps it, and reads it back with the transcript', () => {
  assert.match(server, /const endedQuietly = !quiet && endTurnMark\(s, err\);[^\n]*\n\s*addEvent\(s, \{ k: 'result',[^\n]*\.\.\.\(endedQuietly \? \{ quiet: true \} : \{\}\)/);
  const mark = server.slice(server.indexOf('function endTurnMark('), server.indexOf('\n}\n', server.indexOf('function endTurnMark(')));
  assert.match(mark, /rec\.quietTurns = keepQuiet\(rec\.quietTurns, turnKey\(s\.events\)\)/);
  assert.match(server, /markQuiet\(events, rec\?\.quietTurns\);\n\s*return weaveCards\(/);
});

test('Mark unread from the open chat sends where it was scrolled to, and opening reads when the person last looked', () => {
  assert.equal([...page.matchAll(/\/unread\?client=\$\{S\.client\}`, unreadSpot\((id|s\.id)\)\)/g)].length, 3, 'every Mark unread');
  assert.match(server, /if \(Number\.isFinite\(b\.at\)\) \{ const rec = state\.sessions\[id\] \|\|= \{ client: client\.id \}; rec\.seenAt = b\.at - 1;/);
  assert.match(page, /S\.lineAt = \{ id, at: \(\['reload', 'reconnect'\]\.includes\(auto\) && r\.look\?\.lineAt\) \|\| r\.look\?\.seenAt \|\| null \};/);
  const markSeen = page.slice(page.indexOf('function markSeen('), page.indexOf('\n}\n', page.indexOf('function markSeen(')));
  assert.match(markSeen, /if \(!looking\(\) \|\| !present\(\)\) return;\n\s*noteLooked\(\);/, 'only while the person is there');
});
