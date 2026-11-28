// Tests for Talk's microphone help (#1224): each failure's kind, its line, the checks and the fix steps, on Windows and
// macOS. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { micAudio, micKind, micLine, micChecks, micSteps, OPEN } from '../talk-mic.mjs';

const err = (name, message = '') => Object.assign(new Error(message), { name });

test('the picked microphone is asked for as ideal, so a missing one falls back', () => {
  assert.equal(micAudio().deviceId, undefined);
  assert.deepEqual(micAudio('abc').deviceId, { ideal: 'abc' });
  assert.equal(micAudio('abc').echoCancellation, true);
});

test('each getUserMedia failure gets its kind', () => {
  assert.equal(micKind(err('NotFoundError', 'Requested device not found')), 'notfound');
  assert.equal(micKind(err('DevicesNotFoundError')), 'notfound');
  assert.equal(micKind(err('NotAllowedError', 'Permission denied')), 'blocked');
  assert.equal(micKind(err('NotAllowedError', 'Permission denied by system')), 'system');
  assert.equal(micKind(err('SecurityError')), 'blocked');
  assert.equal(micKind(err('NotReadableError', 'Could not start audio source')), 'busy');
  assert.equal(micKind(err('AbortError')), 'busy');
  assert.equal(micKind(err('OverconstrainedError')), 'gone');
  assert.equal(micKind(err('TypeError')), 'other');
  assert.equal(micKind(null, { secure: false, hasMedia: false }), 'insecure');
  assert.equal(micKind(null, { secure: true, hasMedia: false }), 'nomedia');
});

test('the talk line names the cause in plain words, never the raw "Requested device not found"', () => {
  for (const k of ['insecure', 'nomedia', 'notfound', 'blocked', 'system', 'busy', 'gone']) {
    const s = micLine(k, err('X', 'Requested device not found'));
    assert.ok(s && !/Requested device/.test(s), k);
  }
  assert.match(micLine('notfound'), /no microphone/);
  assert.match(micLine('other', err('TypeError', 'odd')), /odd/);
});

test('the checks: secure page, support, permission, the microphones seen, the test recording', () => {
  const ok = micChecks({ secure: true, hasMedia: true, permission: 'granted', inputs: [{ deviceId: 'a', label: 'Headset' }, { deviceId: 'b', label: 'Laptop mic' }], kind: null, level: 0.5 });
  assert.deepEqual(ok.map((c) => c.ok), [true, true, true, true, true]);
  assert.match(ok[3].text, /Headset, Laptop mic/);
  assert.match(ok[4].text, /hears sound/);
  const none = micChecks({ secure: true, hasMedia: true, permission: 'prompt', inputs: [], kind: 'notfound' });
  assert.deepEqual(none.map((c) => c.ok), [true, true, null, false, false]);
  assert.match(none[3].text, /no microphone at all/);
  const unnamed = micChecks({ secure: true, hasMedia: true, permission: 'denied', inputs: [{ deviceId: 'a', label: '' }], kind: 'blocked' });
  assert.equal(unnamed[2].ok, false);
  assert.match(unnamed[3].text, /one microphone; their names show/);
  const insecure = micChecks({ secure: false, hasMedia: false, kind: 'insecure' });
  assert.deepEqual(insecure.map((c) => c.ok), [false]); // no second line saying the same
});

test('fix steps follow the kind, in Windows or macOS words, with the right settings pages', () => {
  const win = micSteps('notfound'), mac = micSteps('notfound', { mac: true });
  assert.ok(win.some((s) => s.open?.[1] === 'ms-settings:privacy-microphone'));
  assert.ok(win.some((s) => s.open?.[1] === 'ms-settings:sound'));
  assert.ok(win.some((s) => /Remote Desktop/.test(s.text)));
  assert.ok(win.some((s) => /Device Manager/.test(s.text)));
  assert.ok(mac.every((s) => !s.open || s.open[1].startsWith('x-apple.systempreferences:')));
  assert.ok(mac.some((s) => /System Settings > Privacy & Security > Microphone/.test(s.text)));
  assert.ok(!mac.some((s) => /Device Manager|Remote Desktop/.test(s.text)));
  assert.equal(micSteps('notfound').at(-1).text, 'Then press Try again.');
  assert.match(micSteps('blocked', { permission: 'denied' })[0].text, /address bar/);
  assert.equal(micSteps('blocked', { permission: 'denied' }).length, 2); // the browser's block alone
  assert.deepEqual(micSteps('system', { mac: true })[0].open, OPEN.mac.privacy);
  assert.match(micSteps('busy')[0].text, /Teams or Zoom/);
  assert.match(micSteps('insecure')[0].text, /localhost/);
  assert.match(micSteps(null)[0].text, /muted/);
  assert.ok(micSteps('other').length >= 3);
});
