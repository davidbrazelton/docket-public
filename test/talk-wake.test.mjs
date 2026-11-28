// Tests for hands-free Talk's pure parts (#1228): the wake name heard at the start of what Whisper wrote, openWakeWord's
// rolling features, the speech segments, which session a message goes to, the read-back and the 30-minute auto-off.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanWakeName, cleanComputer, matchWake, wakeStop, newSegmenter, feedSegment, newFramer, frames, newWakeStream, pushWake, OWW,
  chooseTarget, handsReadback, newIdle, touchIdle, idleLeft, idleDue, IDLE_OFF_MS, WAKE_DEFAULT, methodOf, modeOf } from '../talk-wake.mjs';
import { mayVoice } from '../talk.mjs';
import { newQueue, add, lock, next } from '../talk-queue.mjs';
import { isBluetooth, micChecks } from '../talk-mic.mjs';

test('a wake name as typed: one to three words of letters, else the default', () => {
  assert.equal(cleanWakeName('  Desk  '), 'Desk');
  assert.equal(cleanWakeName('Hey, Kitchen!'), 'Hey Kitchen');
  assert.equal(cleanWakeName(''), WAKE_DEFAULT);
  assert.equal(cleanWakeName('one two three four'), WAKE_DEFAULT);
  assert.equal(cleanWakeName('x'.repeat(30)), WAKE_DEFAULT);
  assert.equal(cleanComputer(' Study <PC> 2 '), 'Study PC 2');
  assert.equal(methodOf('nope'), 'a'); assert.equal(modeOf('live'), 'live'); assert.equal(modeOf(''), 'compare', 'comparison first');
});

test('method A: the wake name at the start, as Whisper may write it, and the message after it as written', () => {
  for (const said of ['Docket, tell it yes, the second option.', 'Doc it. Tell it yes, the second option.', 'Dock it, tell it yes, the second option',
    'Hey Docket, tell it yes, the second option.', 'Locket. Tell it yes, the second option.', 'docket tell it yes, the second option']) {
    const m = matchWake(said, 'Docket');
    assert.ok(m.hit, said);
    assert.equal(m.rest, 'Tell it yes, the second option' + (said.endsWith('.') ? '.' : ''), said);
  }
  const alone = matchWake('Docket.', 'Docket');
  assert.ok(alone.hit); assert.equal(alone.rest, '', 'the wake name alone: the message comes after a pause');
  for (const said of ['I think we should have pasta tonight.', 'The docket is full today.', 'Doctor Rivera called.', 'Okay.', '']) assert.equal(matchWake(said, 'Docket').hit, false, said);
});

test('method A: names of two words, and each computer its own name', () => {
  assert.ok(matchWake('Hey Desk, read it.', 'Hey Desk').hit);
  assert.equal(matchWake('Hey Desk, read it.', 'Hey Desk').rest, 'Read it.');
  assert.ok(matchWake('Kitchen, next waiting', 'Kitchen').hit);
  assert.equal(matchWake('Kitchen, next waiting', 'Study').hit, false, 'the other computer stays asleep');
  assert.equal(matchWake('Docket, next', 'Study').hit, false);
});

test('"<wake name>, stop" is the one thing heard while Read aloud speaks', () => {
  assert.ok(wakeStop('Docket, stop.', 'Docket'));
  assert.ok(wakeStop('Doc it stop', 'Docket'));
  assert.equal(wakeStop('Docket, tell it yes', 'Docket'), false);
  assert.equal(wakeStop('Stop.', 'Docket'), false, 'the wake name is needed');
});

// The detector's chance of speech, 32 ms a frame: q frames of quiet, s of speech.
const run = (s, list) => list.flatMap(([p, n]) => Array.from({ length: n }, () => feedSegment(s, p)).flat());
test('segments: speech starts after a few frames of it, method A looks at its first two seconds, it ends after 1.5 s of quiet', () => {
  const s = newSegmenter();
  const ev = run(s, [[0.1, 10], [0.9, 100], [0.1, 60]]);
  assert.deepEqual(ev.map((e) => e.kind), ['start', 'check', 'end']);
  assert.equal(ev[0].at, 320, 'from the first frame of speech');
  assert.equal(ev[1].at - ev[0].at, 2016, 'the check after two seconds');
  assert.equal(ev[2].speechEnd, 320 + 100 * 32, 'where the speech stopped');
  assert.ok(ev[2].at - ev[2].speechEnd >= 1500 - 32);
});
test('segments: a short one is checked at its end, a blip is not speech, and a long pause in the middle does not end it early', () => {
  const s = newSegmenter();
  assert.deepEqual(run(s, [[0.9, 2], [0.1, 20]]), [], 'two frames are a blip');
  const short = run(s, [[0.9, 10], [0.1, 60]]);
  assert.deepEqual(short.map((e) => e.kind), ['start', 'check', 'end']);
  assert.equal(short[1].at, short[2].at, 'the check comes with the end');
  const t = newSegmenter(), paused = run(t, [[0.9, 20], [0.1, 30], [0.9, 20], [0.1, 60]]);
  assert.deepEqual(paused.map((e) => e.kind), ['start', 'check', 'end'], 'a one-second pause keeps it going');
  const long = run(newSegmenter({ max: 3000 }), [[0.9, 200]]);
  assert.equal(long.find((e) => e.kind === 'end').why, 'long');
});

test('a framer cuts chunks of any size into whole frames', () => {
  const f = newFramer(512);
  assert.equal(frames(f, new Float32Array(128)).length, 0);
  const out = frames(f, new Float32Array(1000).fill(1));
  assert.equal(out.length, 2); assert.equal(out[0][0], 0); assert.equal(out[0][200], 1);
  assert.equal(f.buf.length, 1128 - 1024);
});

test("method B: openWakeWord's rolling features, with its three models handed in", async () => {
  const seen = { mel: [], embed: 0, wake: 0 };
  const w = newWakeStream({
    mel: async (x) => { seen.mel.push(x.length); return { data: new Float32Array(8 * 32).fill(10), frames: 8 }; },
    embed: async (x) => { seen.embed++; assert.equal(x.length, 76 * 32); return new Float32Array(96).fill(x[x.length - 1]); },
    wake: async (x) => { seen.wake++; assert.equal(x.length, 16 * 96); return 0.9; },
  });
  const scores = [];
  for (let i = 0; i < 40; i++) scores.push(...await pushWake(w, new Float32Array(1000).fill(0.5)));
  // 40 000 samples: 31 chunks of 1280; a score from the 16th embedding on, the first five counted as 0
  assert.equal(seen.mel.length, 31);
  assert.equal(seen.mel[0], 1280, 'the first chunk on its own');
  assert.equal(seen.mel[1], 1280 + OWW.extra, 'then with the end of the one before');
  assert.equal(seen.embed, 31); assert.equal(seen.wake, 16);
  assert.deepEqual(scores, [...Array(5).fill(0), ...Array(11).fill(0.9)]);
  assert.equal(w.pend.length, 40000 - 31 * 1280, 'the rest waits for the next chunk');
  assert.equal(w.mel.at(-1)[0], 3, 'mel / 10 + 2');
});

const sessions = [{ id: 'r', title: 'Relay fix', desk: 'd1' }, { id: 'p', title: 'Proxy timeouts', desk: 'd1' }, { id: 'o', title: 'Onboarding guide', desk: 'd2' }];
test('where a message goes: the session asked last, the one named, or the open one', () => {
  const ctx = { lastAsked: { id: 'p' }, current: { id: 'o', title: 'Onboarding guide', desk: 'd2' }, sessions };
  assert.deepEqual(chooseTarget('Yes, the second option.', ctx), { target: sessions[1], text: 'Yes, the second option.', why: 'asked' });
  assert.deepEqual(chooseTarget('Tell it yes', ctx), { target: sessions[1], text: 'Yes', why: 'asked' }, '"tell it" means the default');
  const named = chooseTarget('Tell relay fix to rerun the tests', ctx);
  assert.equal(named.target.id, 'r'); assert.equal(named.text, 'Rerun the tests'); assert.equal(named.why, 'named');
  assert.equal(chooseTarget('Ask the proxy timeouts session that it should retry', ctx).target.id, 'p');
  assert.equal(chooseTarget('Ask the proxy timeouts session that it should retry', ctx).text, 'It should retry');
  assert.equal(chooseTarget('Tell Sam I will be late', ctx).why, 'asked', 'a name that is no session stays in the message');
  assert.equal(chooseTarget('Yes', { ...ctx, lastAsked: { id: 'gone' } }).why, 'open', 'a session no longer listed gives way to the open one');
  assert.deepEqual(chooseTarget('Yes', { sessions }), { target: null, text: 'Yes', why: '' });
});

test('the read-back names the computer when more than one Docket listens, and compare mode says what it would have sent', () => {
  assert.equal(handsReadback({ title: 'Relay fix.', text: 'Yes, the second option.' }).say, 'Sending to Relay fix: Yes, the second option.');
  assert.equal(handsReadback({ title: 'Relay fix', text: 'Yes', computer: 'Study', many: true }).say, 'Study sending to Relay fix: Yes.');
  assert.equal(handsReadback({ title: 'Relay fix', text: 'Yes', computer: 'Study', many: false }).say, 'Sending to Relay fix: Yes.');
  assert.match(handsReadback({ title: 'Relay fix', text: 'Yes', compare: true, method: 'b' }).say, /^heard you by B\. Would send to Relay fix: Yes\.$/);
  assert.match(handsReadback({ title: 'Relay fix', text: 'Yes' }).about, /in 3 s.*cancel/);
});

test('the auto-off: 30 minutes without the wake name', () => {
  const idle = newIdle(1000);
  assert.equal(idleLeft(idle, 1000), IDLE_OFF_MS);
  assert.equal(idleDue(idle, 1000 + IDLE_OFF_MS - 1), false);
  touchIdle(idle, 1000 + 20 * 60e3);
  assert.equal(idleDue(idle, 1000 + IDLE_OFF_MS), false, 'a wake starts the 30 minutes again');
  assert.equal(idleDue(idle, 1000 + 20 * 60e3 + IDLE_OFF_MS), true);
});

test("hands-free's own words are said at any Read aloud level and while the screen is locked (the #1173 exception)", () => {
  const base = { level: 'off', prompt: true, micAgo: 60000, locked: true, screenLocked: true, canSpeak: true };
  assert.equal(mayVoice(base), false);
  assert.equal(mayVoice({ ...base, force: true }), true);
  assert.equal(mayVoice({ ...base, force: true, locked: false }), false, 'only the tab holding talk mode');
  const q = newQueue(); lock(q, true);
  assert.equal(add(q, { kind: 'asked', parts: ['Read aloud line.'] }), null);
  assert.ok(add(q, { kind: 'asked', parts: ['Sending to Relay fix: yes.'], force: true }));
  assert.equal(next(q).text, 'Sending to Relay fix: yes.');
});

test('Microphone help says when the microphone looks like a Bluetooth one', () => {
  assert.ok(isBluetooth('Headset (Soundcore Life Q30 Hands-Free AG Audio)'));
  assert.ok(isBluetooth('AirPods Pro'));
  assert.equal(isBluetooth('Microphone Array (Realtek(R) Audio)'), false);
  const p = { secure: true, hasMedia: true, permission: 'granted', inputs: [], kind: null, level: 0 };
  assert.ok(micChecks({ ...p, using: 'Jabra Speak 510' }).some((c) => /Bluetooth/.test(c.text)));
  assert.ok(!micChecks({ ...p, using: 'USB Microphone' }).some((c) => /Bluetooth/.test(c.text)));
});
