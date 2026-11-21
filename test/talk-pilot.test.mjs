// Tests for talk mode × the autopilot (#1146): the voice commands, the skip rule for "next waiting", and the words of
// "what did the autopilot do". Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, route } from '../talk-grammar.mjs';
import { pilotTakes, pilotReport, withPilot } from '../talk-pilot.mjs';

test('engage and disengage the autopilot by voice, on the open desk or a named one', () => {
  const on = (desk = '') => ({ kind: 'pilot', on: true, desk, risky: true }), off = (desk = '') => ({ kind: 'pilot', on: false, desk, risky: true });
  assert.deepEqual(parse('Autopilot on.'), on());
  assert.deepEqual(parse('Engage autopilot'), on());
  assert.deepEqual(parse('engage the auto pilot'), on());
  assert.deepEqual(parse('Turn on the autopilot'), on());
  assert.deepEqual(parse('turn the autopilot on here'), on());
  assert.deepEqual(parse('Autopilot off for this desk.'), off());
  assert.deepEqual(parse('Disengage autopilot on Acme.'), off('acme'));
  assert.deepEqual(parse('autopilot on for the Northwind desk'), on('northwind'));
  assert.deepEqual(parse('autopilot on acme'), on('acme'));
  assert.deepEqual(parse('turn off autopilot'), off());
  assert.deepEqual(parse('stop the autopilot'), off());
});

test('the autopilot commands do not take other commands', () => {
  assert.equal(parse('Go to the Acme desk').kind, 'desk');
  assert.equal(parse('stop').kind, 'stop');
  assert.equal(parse('tell it to turn on the autopilot').kind, 'dictate');
  assert.equal(parse('open autopilot notes').kind, 'open');
  assert.equal(parse('autopilot').kind, 'none');
});

test('"what did the autopilot do" and its other words', () => {
  for (const s of ['What did the autopilot do?', 'what did autopilot answer', 'Autopilot report', 'what has the autopilot done while I was away', 'what did the auto pilot do'])
    assert.deepEqual(parse(s), { kind: 'pilotReport' }, s);
});

test('a yes waiting still answers before the autopilot words', () => {
  assert.equal(parse('yes', { pending: true }).kind, 'yes');
});

test('next waiting skips only sessions the autopilot is about to take', () => {
  const engaged = { acme: 1 }, active = new Set(['acme']);
  const items = [
    { session: 's1', desk: 'acme', may: 'allow' }, // taken
    { session: 's2', desk: 'acme', may: 'allow' }, { session: 's2', desk: 'acme', may: 'ask' }, // one stays with you
    { session: 's3', desk: 'acme', may: 'suggest' }, // only suggests: yours
    { session: 's4', desk: 'acme', may: 'allow', busy: true }, // you are at it
    { session: 's5', desk: 'acme', may: 'deny' }, // the pilot still gives the answer
    { session: 's6', desk: 'north', may: 'allow' }, // not engaged there
    { session: null, desk: 'acme', may: 'allow' }, // no session to skip
  ];
  assert.deepEqual(pilotTakes(items, { engaged, active }), ['s1', 's5']);
  assert.deepEqual(pilotTakes(items, { engaged, active: new Set() }), [], 'no run pending or running: nothing skipped');
  assert.deepEqual(pilotTakes(items, { engaged: {}, active }), []);
  assert.equal(withPilot(0), '');
  assert.equal(withPilot(1), 'One more is with the autopilot.');
  assert.equal(withPilot(2), 'Two more are with the autopilot.');
  assert.equal(withPilot(14), '14 more are with the autopilot.');
});

test('the autopilot report: answered by kind, what it left and where, since the last ask', () => {
  const lines = [
    { at: 5, kind: 'permission', desk: 'acme', session: 'old', ok: true, answer: 'allow', what: 'Bash: ls' }, // before since
    { at: 11, kind: 'run', desk: 'acme', run: 'r', answer: 'started', ok: true },
    { at: 12, kind: 'permission', desk: 'acme', session: 'a', ok: true, answer: 'allow', what: 'Bash: npm test' },
    { at: 13, kind: 'permission', desk: 'acme', session: 'b', ok: true, answer: 'allow', what: 'Edit: x.mjs' },
    { at: 14, kind: 'question', desk: 'acme', session: 'a', ok: true, answer: 'answered Q1: Yes', what: 'Q1: Go on?' },
    { at: 15, kind: 'merge', desk: 'acme', session: 'b', ok: false, answer: 'merge', what: 'Pull request #7', why: 'merging stays with you' },
    { at: 16, kind: 'card', desk: 'acme', session: 'c', ok: true, suggest: true, answer: 'suggested Start', what: 'Rerun the scan' },
    { at: 17, kind: 'permission', desk: 'north', session: 'n', ok: true, answer: 'allow', what: 'Bash: ls' }, // another desk
  ];
  const titles = { a: 'Relay fix', b: 'Docs', c: 'Scan' };
  const r = pilotReport(lines, { desk: 'acme', deskName: 'Acme', since: 10, engaged: true, waiting: 2, title: (s) => titles[s] });
  assert.equal(r.answered, 3); assert.equal(r.left, 2); assert.equal(r.at, 16);
  assert.deepEqual(r.head, ['On Acme the autopilot answered two permission prompts and one question form.', 'It left two for you, in Docs and Scan.', 'Two items wait on you there now.']);
  assert.equal(r.rest[0], 'Left for you in Docs: Pull request #7. Merging stays with you.');
  assert.equal(r.rest[1], 'Left for you in Scan: Rerun the scan. It suggests Start.');
  assert.equal(r.rest.length, 5);
  assert.equal(r.rest[4], 'Answered in Relay fix: Q1: Yes.');
  const none = pilotReport(lines, { desk: 'acme', deskName: 'Acme', since: 16, engaged: false });
  assert.deepEqual(none.head, ['The autopilot has done nothing on Acme since you last asked. It is not engaged there.']);
  assert.equal(none.at, 16, 'nothing new: the point stays');
});

test('the autopilot commands stay local; a long run-on goes to the session (#1148 routing)', () => {
  const via = (t, known) => route(t, parse(t), { known }).via;
  assert.equal(via('autopilot on'), 'local');
  assert.equal(via('what did the autopilot do'), 'local');
  assert.equal(via('disengage autopilot on Acme'), 'local');
  assert.equal(via('autopilot on for my big long northwind client account'), 'message');
  assert.equal(via('autopilot on for my big long northwind client account', () => true), 'local');
  assert.equal(via('autopilot on. then open relay fix'), 'message');
});
