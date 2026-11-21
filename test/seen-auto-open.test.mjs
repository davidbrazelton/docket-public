// Tests for #625: an unread session keeps its orange dot through resting and an app restart, and loses it only when the
// person opens it or acts in it, not when the page opens it by itself. Runs those parts of index.html and server.mjs on
// their own. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { savedWaiting } from '../needs-you.mjs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = page.indexOf('// ---------- seen after an automatic open');
const end = page.indexOf('// end of seen after an automatic open');
assert.ok(start > 0 && end > start, 'the seen-after-an-automatic-open part of index.html has moved or lost its markers');
const S = {};
const { seenCounts } = new Function('S', page.slice(start, end) + '\nreturn { seenCounts };')(S);

test('a session the page opened by itself is not marked seen until the person acts inside it', () => {
  assert.equal(seenCounts({ autoOpen: 'a', selected: 'a' }), false, 'a list click, focus or a live update does not count');
  assert.equal(seenCounts({ autoOpen: 'a', selected: 'a', inSession: true }), true, 'a click or key in the session does');
  assert.equal(seenCounts({ autoOpen: null, selected: 'a' }), true, 'one the person opened counts as before');
  assert.equal(seenCounts({ autoOpen: 'b', selected: 'a' }), true, 'an older automatic open of another session does not hold this one');
});

test('every place the page opens a session by itself says so', () => {
  const calls = (re) => [...page.matchAll(re)].length;
  assert.equal(calls(/openSession\(last, '(desk switch|back to sessions)'\)/g), 2, 'the last one open on a desk, on a desk switch or back from schedules');
  assert.equal(calls(/openSession\(r\.selected, 'reload'\)/g), 1, 'the open one after the page reloads');
  assert.match(page, /openSession\(S\.selected, S\.autoOpen === S\.selected \? 'reconnect' : ''\)/, 'the open one after Docket restarts');
  assert.match(page, /async function openSession\(id, auto = ''\) \{\n[^\n]*\n\s*S\.autoOpen = auto \? id : null;/, 'opening records whether the person chose it');
  const markSeen = page.slice(page.indexOf('function markSeen('), page.indexOf('\n}\n', page.indexOf('function markSeen(')));
  assert.match(markSeen, /if \(!seenCounts\(/, 'markSeen asks seenCounts before marking anything');
});

test('a resting session keeps the saved orange dot, so it survives the app restart that makes it a saved session', () => {
  // restSession leaves status and unread alone, so the live session pushed as it rests still saves waiting.
  const rest = server.slice(server.indexOf('function restSession('), server.indexOf('\n}\n', server.indexOf('function restSession(')));
  assert.doesNotMatch(rest, /unread\s*=|setStatus\(/, 'resting must not change unread or status');
  assert.equal(savedWaiting({ unread: true, status: 'idle', heldTurn: false }), true);
  // After the restart the list row takes its dot from the saved flag.
  assert.match(server, /waiting: !!state\.sessions\[r\.sessionId\]\?\.waiting \|\|/);
});

test('every change to the saved waiting flag goes through setSavedWaiting, which logs why', () => {
  const writes = [...server.matchAll(/(\w+(?:\[[^\]]+\])?(?:\?)?)\.waiting\s*=(?!=)/g)].map((m) => m[0]).filter((w) => !w.startsWith('updateStatus'));
  assert.deepEqual(writes, ['rec.waiting ='], 'only setSavedWaiting writes it');
  assert.doesNotMatch(server, /state\.sessions\[[^\]]+\] = \{[^}]*waiting:/, 'no record is rebuilt with a waiting value');
  const fn = server.slice(server.indexOf('function setSavedWaiting('), server.indexOf('\n}\n', server.indexOf('function setSavedWaiting(')));
  assert.match(fn, /logEvent\(`saved waiting/);
});
