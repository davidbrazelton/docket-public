import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { whatsNew, cmpVersion, ENTRIES, sections, addDone, nudgeDue, nudgedAfter, nudgeText, DONE_LIMIT } from '../whats-new.mjs';

const entries = [{ id: 'a', version: '1.5.0' }, { id: 'b', version: '1.6.0' }, { id: 'c', version: '2.0.0' }];
const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('versions compare by their numbers', () => {
  assert.equal(cmpVersion('1.10.0', '1.9.9'), 1);
  assert.equal(cmpVersion('1.2', '1.2.0'), 0);
  assert.equal(cmpVersion('', '0.0.1'), -1);
});

test('an update opens the entries that arrived up to the running version', () => {
  const r = whatsNew({ entries, running: '1.6.2', last: '1.4.0' });
  assert.deepEqual(r.open, ['a', 'b']);
  assert.equal(r.last, '1.6.2');
  assert.deepEqual(whatsNew({ entries, running: '1.5.0', last: '1.4.0' }).open, ['a'], 'one newer than the running version waits for it');
});

test('an entry stays open until it is answered, and never opens again after', () => {
  const first = whatsNew({ entries, running: '1.6.0', last: '1.5.5' });
  assert.deepEqual(whatsNew({ entries, running: '1.6.0', ...first }).open, ['a', 'b'], 'a reload keeps it in the list');
  assert.deepEqual(whatsNew({ entries, running: '1.6.0', last: '1.6.0', seen: ['a'] }).open, ['b']);
});

test('a fresh install opens nothing and keeps every entry up to its version as seen', () => {
  const r = whatsNew({ entries, running: '1.6.0', fresh: true });
  assert.deepEqual(r.open, []);
  assert.deepEqual(r.seen.sort(), ['a', 'b']);
  assert.equal(r.last, '1.6.0');
  assert.deepEqual(whatsNew({ entries, running: '2.0.0', ...r }).open, ['c'], 'the next update brings only what is new since');
});

test('no running version known: nothing changes', () => {
  assert.deepEqual(whatsNew({ entries, running: '', last: '1.0.0', seen: ['x'] }), { open: [], last: '1.0.0', seen: ['x'] });
});

test('every entry has an id and a version, and ids are unique', () => {
  for (const e of ENTRIES) { assert.match(e.id, /^[\w-]+$/); assert.match(e.version, /^\d+\.\d+\.\d+$/); }
  assert.equal(new Set(ENTRIES.map((e) => e.id)).size, ENTRIES.length);
});

test('the talk entry opens on a computer that saw the first talk card', () => {
  assert.deepEqual(whatsNew({ running: '1.249.0', last: '1.248.0', seen: ['talk'] }).open, ['talk-and-read-aloud']);
});

test('the list: New, Suggested for you and Done, counted by what is open', () => {
  const items = [{ key: 'talk', sec: 'new' }, { key: 'cache:a', sec: 'suggest' }, { key: 'setup:a', sec: 'suggest' }];
  const s = sections({ items, records: [{ key: 'cost', title: 'Show what each session costs', note: 'On', ok: true }] });
  assert.deepEqual(s.fresh.map((i) => i.key), ['talk']);
  assert.deepEqual(s.suggest.map((i) => i.key), ['cache:a', 'setup:a']);
  assert.deepEqual(s.done.map((r) => r.key), ['cost']);
  assert.equal(s.count, 3);
  assert.equal(sections({ items: [] }).count, 0);
});

test('Done keeps the last answers, an entry open again leaves it, and entries seen before records were kept show as Seen', () => {
  const records = [{ key: 'cache:a', title: 'x', note: 'Not now' }, { key: 'cost', title: 'y', note: 'On' }];
  const s = sections({ items: [{ key: 'cache:a', sec: 'suggest' }], records, seenIds: ['talk-and-read-aloud', 'gone'], titles: { 'talk-and-read-aloud': 'Talk and read aloud' } });
  assert.deepEqual(s.done.map((r) => [r.key, r.note]), [['cost', 'On'], ['talk-and-read-aloud', 'Seen']], 'an id with no title is left out');
  const many = Array.from({ length: 14 }, (_, i) => ({ key: 'k' + i }));
  assert.equal(sections({ records: many }).done.length, DONE_LIMIT, 'the last 10');
});

test('an answer is kept once, newest first', () => {
  let r = addDone([], { key: 'a', note: 'Not now' });
  r = addDone(r, { key: 'b', note: 'On' });
  r = addDone(r, { key: 'a', note: 'On' });
  assert.deepEqual(r.map((x) => [x.key, x.note]), [['a', 'On'], ['b', 'On']]);
  assert.equal(Array.from({ length: 15 }).reduce((acc, _, i) => addDone(acc, { key: 'k' + i }), []).length, DONE_LIMIT);
});

test('one nudge per new entry found, never one per entry', () => {
  assert.equal(nudgeDue(['talk', 'cache:a'], []), true);
  const after = nudgedAfter(['talk', 'cache:a'], []);
  assert.equal(nudgeDue(['talk', 'cache:a'], after), false, 'Later hides it');
  assert.equal(nudgeDue(['talk'], after), false, 'fewer entries: nothing new');
  assert.equal(nudgeDue(['talk', 'cache:a', 'setup:b'], after), true, 'a new suggestion brings it back once');
  assert.equal(nudgeDue([], []), false);
});

test('an entry out of view (another desk) stays nudged, and the list of nudged keys has a limit', () => {
  const after = nudgedAfter(['reason:a'], []);
  const onB = nudgedAfter(['reason:b'], after);
  assert.equal(nudgeDue(['reason:a'], onB), false, 'back on desk a: no second nudge');
  assert.equal(nudgedAfter(Array.from({ length: 250 }, (_, i) => 'k' + i), []).length, 200);
});

test('the nudge says how many of each', () => {
  assert.equal(nudgeText(1, 2), '1 new option and 2 suggestions from how you use Docket.');
  assert.equal(nudgeText(2, 0), '2 new options.');
  assert.equal(nudgeText(0, 1), '1 suggestion from how you use Docket.');
});

test('the usage checks and preference offers are list entries now, not corner cards; the autopilot card stays', () => {
  for (const id of ['reasonOffer', 'costOffer', 'cacheOffer', 'setupOffer', 'startOffer', 'summaryOffer', 'formsOffer', 'questionsOffer'])
    assert.ok(!page.includes(`id="${id}"`), `${id} is still a corner card`);
  assert.ok(page.includes('id="pilotOffer"'), 'the autopilot engage card stays');
  assert.ok(page.includes('id="wnNudge"') && page.includes('id="whatsNew"'));
  for (const k of ['talk', 'cost', 'reason', 'questions', 'forms', 'plans', 'cache', 'setup', 'start', 'summary'])
    assert.match(page, new RegExp(`\\n  ${k}: \\{ sec: '(new|suggest)'`), `entry ${k}`);
  assert.match(page, /\['whatsnew', "What's new and suggestions"\]/, 'in ☰ > Help');
});

test('the setup wizard asks about talk and display on the first run only', () => {
  assert.match(page, /const WIZ_STEPS = \['Name', 'AI brand', 'Sessions', 'Plans', 'Folders', 'Sign in', 'Talk & voice', 'Display', 'Done'\]/);
  assert.match(page, /const shownSteps = \(\) => WIZ_STEPS\.map\(\(s, i\) => \[s, i\]\)\.filter\(\(\[, i\]\) => first \|\| \(i !== TALK && i !== LOOK\)\)/);
});
