// Tests for screen.mjs: screen control's actions, log, Stop and badge, with the platform script played by a fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createScreenControl, STOPPED, PASSWORD, logArgs } from '../screen.mjs';

// A stand-in for spawn: reads the Windows request (base64 JSON), answers with answer(req), or holds it until killed
// when answer gives 'hold'. Every request and every badge shown is recorded.
function fakeSpawn(answer) {
  const seen = { reqs: [], badges: [] };
  const spawnImpl = (cmd, args) => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter(); p.stderr = new EventEmitter();
    p.kill = () => { if (!p.done) { p.done = true; p.killed = true; setImmediate(() => p.emit('close', null)); } };
    if (args[5].endsWith('screen-badge.ps1')) { seen.badges.push({ text: Buffer.from(args[6], 'base64').toString('utf8'), p }); return p; }
    const req = JSON.parse(Buffer.from(args[6], 'base64').toString('utf8'));
    seen.reqs.push(req);
    const out = answer(req);
    if (out !== 'hold') setImmediate(() => { if (req.file) fs.writeFileSync(req.file, 'png'); if (req.before) fs.writeFileSync(req.before.file, 'jpg'); p.stdout.emit('data', JSON.stringify(out) + '\n'); p.done = true; p.emit('close', 0); });
    return p;
  };
  return { spawnImpl, seen };
}
const SCREENS = { ok: true, screens: [{ x: 0, y: 0, w: 2400, h: 1350, primary: true, scale: 1.25 }] };
const who = { key: 's1', session: 's1', title: 'Fix the invoice', desk: 'acme' };
function setup(answer = (r) => (r.op === 'screens' ? SCREENS : { ok: true })) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-test-'));
  const fake = fakeSpawn(answer), changes = [];
  const sc = createScreenControl({ dataDir, platform: 'win32', spawnImpl: fake.spawnImpl, changed: (list) => changes.push(list) });
  return { sc, fake, changes, dataDir, done: () => { sc.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}
const logOf = (dataDir) => fs.readFileSync(path.join(dataDir, 'screen', 'log', `${new Date().toISOString().slice(0, 10)}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('a screenshot is scaled for the model, and a click in its pixels lands on the screen point, logged with a picture first', async () => {
  const t = setup();
  try {
    await assert.rejects(t.sc.act(who, 'mouse_click', { x: 10, y: 10 }), /Take a screen_shot first/);
    const [img, text] = await t.sc.act(who, 'screen_shot', {});
    assert.equal(img.type, 'image');
    assert.equal(Buffer.from(img.data, 'base64').toString(), 'png');
    const shot = t.fake.seen.reqs.find((r) => r.op === 'shot');
    assert.deepEqual([shot.x, shot.y, shot.w, shot.h], [0, 0, 2400, 1350]);
    assert.ok(shot.tw <= 1568 && shot.tw < 2400);
    assert.match(text.text, new RegExp(`This image is ${shot.tw}×${shot.th}`));
    assert.match(text.text, /scaled 125%, main/);
    assert.equal(fs.existsSync(shot.file), false, 'the picture is not kept once read');

    await t.sc.act(who, 'mouse_click', { x: shot.tw / 2, y: shot.th / 2, double: true });
    const click = t.fake.seen.reqs.find((r) => r.op === 'click');
    assert.deepEqual([click.x, click.y, click.button, click.count], [1200, 675, 'left', 2]);
    assert.ok(click.before.file.endsWith('-click.jpg'));
    await assert.rejects(t.sc.act(who, 'mouse_click', { x: 5000, y: 1 }), /outside the last screenshot/);

    const log = logOf(t.dataDir);
    assert.deepEqual(log.map((e) => e.action), ['mouse_click', 'screen_shot', 'mouse_click', 'mouse_click']);
    const ok = log.find((e) => e.ok && e.action === 'mouse_click');
    assert.equal(ok.session, 's1'); assert.equal(ok.title, 'Fix the invoice'); assert.deepEqual(ok.at_screen, { x: 1200, y: 675 });
    assert.ok(fs.existsSync(path.join(t.dataDir, 'screen', ok.before)), 'the picture before the click is kept');
    assert.match(log[0].error, /screen_shot first/);
  } finally { t.done(); }
});

test('keys and text: combinations to key codes, and a password field refuses typing', async () => {
  const t = setup((r) => (r.op === 'type' ? { error: 'password' } : { ok: true }));
  try {
    await t.sc.act(who, 'key_press', { keys: 'ctrl+s' });
    assert.deepEqual(t.fake.seen.reqs.at(-1), { op: 'keys', codes: [0x11, 0x53], guard: false });
    await t.sc.act(who, 'key_press', { keys: 'a' });
    assert.equal(t.fake.seen.reqs.at(-1).guard, true);
    await assert.rejects(t.sc.act(who, 'key_type', { text: 'hunter2' }), (e) => e.message === PASSWORD);
    await assert.rejects(t.sc.act(who, 'key_type', { text: 'x'.repeat(5001) }), /at most 5000/);
  } finally { t.done(); }
});

test('Stop ends the running action at once and refuses the session until the person writes to it again', async () => {
  const t = setup((r) => (r.op === 'type' ? 'hold' : { ok: true }));
  try {
    const typing = t.sc.act(who, 'key_type', { text: 'a long letter' });
    await new Promise((r) => setImmediate(r));
    assert.equal(t.sc.active().length, 1);
    assert.equal(t.fake.seen.badges.length, 1, 'the badge shows on the screen');
    assert.match(t.fake.seen.badges[0].text, /"Fix the invoice" is using the mouse and keyboard/);
    assert.equal(t.sc.stop('test'), 1);
    await assert.rejects(typing, (e) => e.message === STOPPED);
    assert.equal(t.sc.active().length, 0);
    assert.ok(t.fake.seen.badges[0].p.killed, 'the badge is gone');
    assert.deepEqual(t.changes.at(-1), []);
    await assert.rejects(t.sc.act(who, 'key_press', { keys: 'enter' }), (e) => e.message === STOPPED);
    t.sc.release('s1');
    await t.sc.act(who, 'key_press', { keys: 'enter' });
    assert.ok(logOf(t.dataDir).some((e) => e.action === 'stop' && e.by === 'test'));
  } finally { t.done(); }
});

test('Stop for one desk leaves another desk\'s session going; a remote call carries its own turn', async () => {
  const t = setup((r) => (r.op === 'type' ? 'hold' : { ok: true }));
  try {
    const other = { key: 's2', session: 's2', title: 'Other', desk: 'beta' };
    const a = t.sc.act(who, 'key_type', { text: 'x' }), b = t.sc.act(other, 'key_type', { text: 'y' });
    await new Promise((r) => setImmediate(r));
    assert.equal(t.sc.stop('test', 'acme'), 1);
    await assert.rejects(a, (e) => e.message === STOPPED);
    assert.deepEqual(t.sc.active().map((x) => x.session), ['s2']);
    t.sc.stop('test');
    await assert.rejects(b, (e) => e.message === STOPPED);
    // a session on another computer: stopped for the turn it was in, free again in the next one
    const remote = { key: 'remote:rc_1:g1', session: 'g1', title: 'Guest', desk: 'acme', from: 'Laptop', turn: 4 };
    const c = t.sc.act(remote, 'key_type', { text: 'z' });
    await new Promise((r) => setImmediate(r));
    t.sc.stop('test');
    await assert.rejects(c, (e) => e.message === STOPPED);
    await assert.rejects(t.sc.act(remote, 'key_press', { keys: 'enter' }), (e) => e.message === STOPPED);
    await t.sc.act({ ...remote, turn: 5 }, 'key_press', { keys: 'enter' });
  } finally { t.done(); }
});

test('logArgs: the desk is left out and long text is cut', () => {
  assert.deepEqual(logArgs('mouse_click', { x: 1, y: 2, desk: 'Office PC' }), { x: 1, y: 2 });
  assert.equal(logArgs('key_type', { text: 'y'.repeat(300) }).text.length, 201);
});
