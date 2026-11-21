// Tests for "When I speak a message" (#1190): how much a spoken message is read back before it goes, the old
// "Send what I say at once" switch moving over, and the pause that a spoken cancel stops. Run with: npm test
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { READBACKS, readbackOf, readback, firstWords, parse, route, PAUSE_MS } from '../talk-grammar.mjs';
import { migrate, start } from '../talk.mjs';

test('five modes from quickest to most careful, Read it all by default', () => {
  assert.deepEqual(READBACKS.map(([k]) => k), ['now', 'pause', 'ask', 'start', 'all']);
  assert.equal(readbackOf(undefined), 'all');
  assert.equal(readbackOf('loud'), 'all');
  assert.equal(readbackOf('pause'), 'pause');
});

test('what each mode says and does', () => {
  const msg = 'Please rename the report file and then run the tests again before you merge.';
  assert.deepEqual(readback('now', 'Relay', msg), { send: true, say: 'Sent to Relay.', about: 'Sent to Relay.' });
  const p = readback('pause', 'Relay', msg);
  assert.equal(p.pause, true); assert.equal(p.say, 'Sending to Relay.'); assert.match(p.about, /^Sending to Relay in 3 s: "Please rename/);
  assert.deepEqual(readback('ask', 'Relay', msg), { say: 'Send to Relay?', about: `Send to Relay: "${msg}"? Say send or cancel.` });
  assert.equal(readback('start', 'Relay', msg).say, 'Send to Relay: Please rename the report file and then run…?');
  assert.equal(readback('start', 'Relay', 'Run the tests.').say, 'Send to Relay: Run the tests?'); // short: all of it, no …
  assert.equal(readback('all', 'Relay', msg).say, 'Send to Relay: Please rename the report file and then run the tests again before you merge?');
  assert.equal(readback(undefined, 'Relay', msg).say, readback('all', 'Relay', msg).say);
  for (const m of ['ask', 'start', 'all']) assert.equal(readback(m, 'Relay', msg).send, undefined);
  assert.equal(firstWords('one two, three', 2), 'one two…'); // no comma before the …
});

test('"read back off / start / full" switch the mode by voice, and are done here', () => {
  assert.deepEqual(parse('Read back off.'), { kind: 'readback', mode: 'ask' });
  assert.deepEqual(parse('readback start'), { kind: 'readback', mode: 'start' });
  assert.deepEqual(parse('read back full'), { kind: 'readback', mode: 'all' });
  assert.equal(route('read back full', parse('read back full')).via, 'local');
  assert.equal(parse('read back the reply').kind, 'none');
});

test('who had Send what I say at once on gets Send at once; everyone else keeps Read it all', () => {
  const run = (saved) => { const m = new Map(Object.entries(saved)); migrate((k, d) => (m.has(k) ? m.get(k) : d), (k, v) => m.set(k, v)); return Object.fromEntries(m).readback; };
  assert.equal(run({ listen: true, sendNow: true }), 'now');
  assert.equal(run({ listen: true, sendNow: false }), undefined); // the default, Read it all
  assert.equal(run({ listen: true }), undefined);
  assert.equal(run({ sendNow: true, readback: 'start' }), 'start'); // picked since: kept
});

// The page talk mode runs in, as little of it as these tests need: every element takes anything and does nothing.
function fakePage(store) {
  const el = () => new Proxy(function () {}, { get: (t, k) => (k === 'classList' ? { add() {}, remove() {}, toggle() {}, contains: () => false } : k === 'style' || k === 'dataset' ? {} : k === 'hidden' ? true : el()), set: () => true, apply: () => el() });
  globalThis.document = { getElementById: el, addEventListener() {} };
  globalThis.window = {};
  globalThis.addEventListener = () => {};
  const sent = [], page = {
    store: { get: (k, d) => (store.has(k) ? store.get(k) : d), set: (k, v) => store.set(k, v) },
    talkKey: ['ControlRight', 'Right Ctrl'], testCopy: true, tip: () => '', tipText: () => '',
    current: () => ({ id: 's1', title: 'Relay' }), sessions: () => [], desks: () => [], deskId: () => 'd', deskName: () => 'Main', draftGroup: () => null,
    boxText: '', box(t) { if (t !== undefined) this.boxText = t; return this.boxText; },
    async send(t) { sent.push(t); },
  };
  return { page, sent, talk: start(page) };
}

test('Send after a pause: sent after the pause, or not at all when cancelled, and "send" sends at once', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { page, sent, talk } = fakePage(new Map([['talk:readback', 'pause']]));
    await talk.heard('Rename the report file.');
    assert.equal(page.box(), 'Rename the report file.'); assert.deepEqual(sent, []);
    mock.timers.tick(PAUSE_MS - 1); assert.deepEqual(sent, []);
    mock.timers.tick(1); await Promise.resolve();
    assert.deepEqual(sent, ['Rename the report file.']); assert.equal(page.box(), '');

    await talk.heard('Delete the old branch.');
    await talk.heard('Cancel.');
    assert.equal(page.box(), ''); // the box is cleared
    mock.timers.tick(PAUSE_MS * 2); await Promise.resolve();
    assert.deepEqual(sent, ['Rename the report file.']); // and nothing went

    await talk.heard('Run the tests.');
    await talk.heard('Send.');
    assert.deepEqual(sent, ['Rename the report file.', 'Run the tests.']);
    mock.timers.tick(PAUSE_MS * 2); await Promise.resolve();
    assert.equal(sent.length, 2); // sent once

    await talk.heard('Tidy the readme.');
    page.box('Tidy the readme, and the changelog.'); // changed by hand
    mock.timers.tick(PAUSE_MS); await Promise.resolve();
    assert.equal(sent.length, 2);
  } finally { mock.timers.reset(); }
});

test('the other modes: at once, or waiting on send; a Q answer the same way', async () => {
  const store = new Map([['talk:readback', 'now']]);
  const { page, sent, talk } = fakePage(store);
  await talk.heard('Rename the report file.');
  assert.deepEqual(sent, ['Rename the report file.']);
  await talk.heard('Q7 yes');
  assert.deepEqual(sent, ['Rename the report file.', 'Q7 yes']);
  for (const mode of ['ask', 'start', 'all']) {
    store.set('talk:readback', mode); sent.length = 0;
    await talk.heard('Q8 the second one');
    assert.equal(page.box(), 'Q8 the second one'); assert.deepEqual(sent, []);
    await talk.heard('Send.');
    assert.deepEqual(sent, ['Q8 the second one']);
  }
  await talk.heard('read back start');
  assert.equal(store.get('talk:readback'), 'start');
});
