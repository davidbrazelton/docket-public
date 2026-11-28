// Tests for "When I speak a message" (#1190): how much a spoken message is read back before it goes, the old
// "Send what I say at once" switch moving over, and the pause that a spoken cancel stops. Run with: npm test
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { READBACKS, readbackOf, readback, firstWords, parse, route, PAUSE_MS, READBACK_TIP, READBACK_NOTE, unreadReplies } from '../talk-grammar.mjs';
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

test('"read back" and "catch me up" are screen commands, never sent; the mode is not changed by voice', () => {
  for (const t of ['Read back.', 'read it back', 'What did you hear?', 'Say that again.', 'what did I say']) assert.equal(parse(t).kind, 'readBack', t);
  for (const t of ['Read unread.', 'Catch me up.', 'catch up', 'read what I missed']) assert.equal(parse(t).kind, 'unread', t);
  for (const t of ['read back', 'catch me up']) assert.equal(route(t, parse(t)).via, 'local', t);
  assert.equal(parse('read back full').kind, 'none'); // the modes are picked in the menu only
  assert.equal(route('read back full', parse('read back full')).via, 'message');
  assert.equal(parse('read it').kind, 'read');
});

test('the replies "catch me up" reads: from the first not read aloud, or the last few', () => {
  const r = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(unreadReplies(r, 2), ['c', 'd', 'e']);
  assert.deepEqual(unreadReplies(r, 5), []);
  assert.deepEqual(unreadReplies(r, 9), []);
  assert.deepEqual(unreadReplies(r, undefined), ['c', 'd', 'e']); // none read here yet
  assert.deepEqual(unreadReplies(['a'], undefined), ['a']);
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
  const sent = [], replies = [], page = {
    store: { get: (k, d) => (store.has(k) ? store.get(k) : d), set: (k, v) => store.set(k, v) },
    talkKey: ['ControlRight', 'Right Ctrl'], testCopy: true, tip: () => '', tipText: () => '', replies: () => replies, lastReply: () => replies.at(-1) || '',
    current: () => ({ id: 's1', title: 'Relay' }), sessions: () => [], desks: () => [], deskId: () => 'd', deskName: () => 'Main', draftGroup: () => null,
    boxText: '', box(t) { if (t !== undefined) this.boxText = t; return this.boxText; },
    async send(t) { sent.push(t); },
  };
  const talk = start(page); // talk.mjs keeps its state between tests: each starts afresh
  Object.assign(talk.state, { pending: null, lastHeard: '', listen: false, level: 'off' }); talk.state.q.waiting.length = 0; talk.said.length = 0;
  return { page, sent, replies, talk };
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
});

const lastSaid = (talk) => talk.said.at(-1)?.text;
const tipSaid = (talk) => talk.said.some((x) => x.text.includes(READBACK_TIP));

test('a read-back cut short brings the tip, every time; one heard out, or Send at once, does not', async () => {
  const store = new Map([['talk:readback', 'all']]);
  const { sent, talk } = fakePage(store), st = talk.state;
  for (const word of ['Send.', 'Cancel.', 'Yes.']) {
    await talk.heard('Rename the report file.');
    st.q.waiting.push({ tag: st.pending, parts: ['x'], i: 0 }); // still waiting to be said
    await talk.heard(word);
    st.q.waiting.length = 0;
    assert.ok(tipSaid(talk), word); talk.said.length = 0;
  }
  await talk.heard('Rename the report file.'); st.pending.cut = true; // the key cut it off
  await talk.heard('Send.');
  assert.ok(tipSaid(talk)); talk.said.length = 0;
  await talk.heard('Rename the report file.'); // heard out
  await talk.heard('Send.');
  assert.ok(!tipSaid(talk));
  store.set('talk:readback', 'now');
  await talk.heard('Rename the report file.');
  assert.ok(!tipSaid(talk));
  assert.equal(sent.length, 5);
});

test('"read back" says what was heard, or the message waiting on send, in any mode', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const store = new Map([['talk:readback', 'ask']]);
    const { sent, talk } = fakePage(store);
    await talk.heard('Read back.');
    assert.equal(lastSaid(talk), 'Nothing heard yet.');
    await talk.heard('Rename the report file.');
    await talk.heard('Read back.');
    assert.equal(lastSaid(talk), 'Rename the report file.');
    await talk.heard('Cancel.');
    await talk.heard('What did you hear?');
    assert.equal(lastSaid(talk), 'I heard: Cancel.');
    store.set('talk:readback', 'pause');
    await talk.heard('Run the tests.');
    mock.timers.tick(PAUSE_MS - 500);
    await talk.heard('Read back.'); // the pause starts again
    mock.timers.tick(PAUSE_MS - 500); await Promise.resolve();
    assert.deepEqual(sent, []);
    mock.timers.tick(500); await Promise.resolve();
    assert.deepEqual(sent, ['Run the tests.']);
  } finally { mock.timers.reset(); }
});

test('"catch me up" reads the replies not read aloud yet, then says everything has been read', async () => {
  const store = new Map();
  const { replies, talk } = fakePage(store);
  await new Promise((r) => setImmediate(r)); talk.state.level = 'open'; // after start() puts a test copy on Off
  replies.push('First reply.', 'Second reply.', 'Third reply.', 'Fourth reply.');
  store.set('talk:readTo', { s1: 2 });
  await talk.heard('Catch me up.');
  const t = lastSaid(talk);
  assert.match(t, /2 replies\./); assert.match(t, /Third reply/); assert.match(t, /Fourth reply/); assert.doesNotMatch(t, /Second reply/);
  assert.equal(store.get('talk:readTo').s1, 4);
  await talk.heard('Catch me up.');
  assert.equal(lastSaid(talk), 'Everything here has been read.');
  replies.push('Fifth reply.');
  await talk.heard('read it'); // reading the last reply counts too
  assert.equal(store.get('talk:readTo').s1, 5);
});

test('the tip and the first-time note name the setting', () => {
  assert.match(READBACK_NOTE, /When I speak a message/);
  assert.match(READBACK_TIP, /^Tip: .*When I speak a message\.$/);
});
