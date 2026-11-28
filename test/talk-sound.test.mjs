// Tests for Read aloud's speaker help (#1226): the output to use, the checks and the "Can't hear it?" steps, on
// Windows and macOS. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sinkFor, soundChecks, soundSteps, virtualDevice, OPEN, WAKE, wakeNoise, leadLeft } from '../talk-sound.mjs';

const outs = [{ deviceId: 'default', label: 'Default - Speakers' }, { deviceId: 'spk', label: 'Speakers' }, { deviceId: 'dock', label: 'Dock monitor' }];

test('the picked output is used while it is listed, else the default', () => {
  assert.equal(sinkFor('', outs), '');
  assert.equal(sinkFor('dock', outs), 'dock');
  assert.equal(sinkFor('gone', outs), '');
  assert.equal(sinkFor('dock', null), 'dock'); // a browser that lists none keeps the pick
  assert.ok(virtualDevice(outs[0]) && !virtualDevice(outs[1]));
});

test('the checks: no Web Audio is the only line', () => {
  assert.deepEqual(soundChecks({ hasAudio: false }).map((c) => c.ok), [false]);
});

test('the checks: running, the outputs by name, the tone played', () => {
  const c = soundChecks({ hasAudio: true, state: 'running', outputs: outs, canPick: true, played: 'played' });
  assert.deepEqual(c.map((x) => x.ok), [true, true, true]);
  assert.match(c[1].text, /Speakers, Dock monitor/); // Chrome's Default stand-in left out
  assert.doesNotMatch(c[1].text, /Default -/);
  assert.match(c[2].text, /default output\. Heard nothing/);
  assert.match(soundChecks({ hasAudio: true, state: 'running', outputs: outs, canPick: true, sink: 'dock', played: 'played' })[2].text, /to Dock monitor/);
});

test('the checks: suspended, no outputs, unnamed outputs, blocked', () => {
  const c = soundChecks({ hasAudio: true, state: 'suspended', outputs: [], canPick: true, played: 'blocked' });
  assert.deepEqual(c.map((x) => x.ok), [false, false, false]);
  assert.match(c[0].text, /Play test tone/);
  assert.match(c[1].text, /no speakers/);
  assert.match(c[2].text, /would not play/);
  const unnamed = soundChecks({ hasAudio: true, state: 'running', outputs: [{ deviceId: 'a', label: '' }, { deviceId: 'b', label: '' }], canPick: true });
  assert.match(unnamed[1].text, /2 outputs; their names show/);
});

test('the checks: no output list, no picker, a picked output gone, the system voice', () => {
  const safari = soundChecks({ hasAudio: true, state: 'running', outputs: null, canPick: false });
  assert.equal(safari.length, 2);
  assert.match(safari[0].text, /lets this page play/);
  assert.match(safari[1].text, /default output/);
  assert.equal(soundChecks({ hasAudio: true, state: 'running', outputs: outs, canPick: false }).filter((x) => /cannot send/.test(x.text)).length, 1);
  assert.ok(soundChecks({ hasAudio: true, state: 'running', outputs: outs, canPick: true, sink: 'gone' }).some((x) => /not connected/.test(x.text)));
  assert.ok(!soundChecks({ hasAudio: true, state: 'running', outputs: outs, canPick: true, sink: 'dock' }).some((x) => /not connected/.test(x.text)));
  const sys = soundChecks({ hasAudio: true, state: 'running', outputs: outs, canPick: true, sink: 'dock', system: true });
  assert.ok(sys.some((x) => /own voice.*default output, not the one picked here/.test(x.text)));
});

test('the steps: Windows has the mixer, Sound settings and Remote Desktop', () => {
  const win = soundSteps();
  assert.ok(win.some((s) => s.open?.[1] === 'ms-settings:apps-volume'));
  assert.ok(win.some((s) => s.open?.[1] === 'ms-settings:sound'));
  assert.ok(win.some((s) => /Remote Desktop/.test(s.text)));
  assert.ok(win.some((s) => /Unmute site/.test(s.text)));
  assert.match(win.at(-1).text, /Play test tone again/);
  assert.ok(!win.some((s) => /own voice/.test(s.text)));
  assert.match(soundSteps({ state: 'suspended' })[0].text, /Play test tone/);
  assert.ok(soundSteps({ system: true }).some((s) => /own voice/.test(s.text)));
});

test('the steps: macOS words and System Settings links only', () => {
  const mac = soundSteps({ mac: true });
  assert.ok(mac.every((s) => !s.open || s.open[1].startsWith('x-apple.systempreferences:')));
  assert.ok(mac.some((s) => /System Settings > Sound > Output/.test(s.text)));
  assert.ok(!mac.some((s) => /Volume mixer|Remote Desktop|taskbar/.test(s.text)));
  assert.ok(OPEN.mac.sound[1].endsWith('?output'));
});

test('the hiss that keeps the output awake (#1250): never silent to Chrome, far too quiet to hear', () => {
  const n = wakeNoise(48000);
  assert.equal(n.length, 48000);
  assert.ok(n.every((x) => x !== 0)); // Chrome pauses the output after 30 s of all-zero samples
  const peak = Math.max(...n.map(Math.abs));
  assert.ok(peak <= WAKE.level && 20 * Math.log10(peak) < -65, `peak ${peak}`);
  assert.ok(n.some((x) => x > 0) && n.some((x) => x < 0));
  assert.ok(Math.abs(n.reduce((a, x) => a + x, 0) / n.length) < WAKE.level / 10); // no lasting offset
  assert.deepEqual(wakeNoise(100), wakeNoise(100));
  assert.equal(wakeNoise(0).length, 1);
});

test('the first sound waits out what is left of the lead-in, the rest go at once', () => {
  assert.equal(leadLeft(1000, 1000), WAKE.leadMs); // just woken: the whole lead-in
  assert.equal(leadLeft(1000, 1150), WAKE.leadMs - 150); // the voice took 150 ms to make the piece
  assert.equal(leadLeft(1000, 1000 + WAKE.leadMs + 2000), 0); // made slower than the lead-in, or a later piece
  assert.equal(leadLeft(0, 5000), WAKE.leadMs); // not awake: all of it
  assert.ok(WAKE.leadMs >= 300 && WAKE.leadMs <= 600 && WAKE.tailMs >= 2000);
});
