// Tests for child-settings.mjs and gears.mjs: a session started by another session starts in Shift,
// on the gear asked for, the company's start gear, or the lowest. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childSettings } from '../child-settings.mjs';
import { GEARS, gearsOf, findGear, startGearOf, cleanStartGear, sessionSettings, deskMode } from '../gears.mjs';

test('a child is in Shift whatever model its parent uses', () => {
  assert.deepEqual(childSettings({ permissionMode: 'bypassPermissions', model: 'shift', effort: '' }, 'claude', 'claude'), { model: 'shift' });
  assert.deepEqual(childSettings({ model: 'claude-opus-5-5' }, 'claude', 'claude'), { model: 'shift' });
  assert.deepEqual(childSettings({ permissionMode: 'auto', model: '', effort: '' }, 'claude', 'claude'), { model: 'shift', permissionMode: 'auto' });
});

test('a child gets its parent\'s permission mode, except Plan and Bypass, which leave it on the desk default (#1220)', () => {
  assert.equal(childSettings({ permissionMode: 'auto' }, 'claude', 'claude').permissionMode, 'auto');
  assert.equal(childSettings({ permissionMode: 'acceptEdits' }, 'claude', 'claude').permissionMode, 'acceptEdits');
  assert.equal(childSettings({ permissionMode: 'default' }, 'claude', 'codex').permissionMode, 'default');
  assert.equal('permissionMode' in childSettings({ permissionMode: 'plan' }, 'claude', 'claude'), false);
  assert.equal('permissionMode' in childSettings({ permissionMode: 'bypassPermissions' }, 'claude', 'claude'), false);
  assert.equal('permissionMode' in childSettings({}, 'claude', 'claude'), false);
});

test('the desk default: Auto on a Claude desk a hook blocked Bypass on, unless the person kept Bypass (#1220)', () => {
  assert.equal(deskMode({ brand: 'claude' }), 'bypassPermissions');
  assert.equal(deskMode({ brand: 'claude', blocked: 1764000000000 }), 'auto');
  assert.equal(deskMode({ blocked: 1764000000000 }), 'auto');
  assert.equal(deskMode({ brand: 'claude', blocked: 1764000000000, kept: true }), 'bypassPermissions');
  assert.equal(deskMode({ brand: 'codex', blocked: 1764000000000 }), 'bypassPermissions');
  assert.equal(deskMode({ brand: 'grok', blocked: 1764000000000 }), 'bypassPermissions');
});

test('a session given no mode gets the desk default; one asked for or saved wins', () => {
  assert.equal(sessionSettings(undefined, {}, false, 'auto').permissionMode, 'auto');
  assert.equal(sessionSettings(undefined, {}).permissionMode, 'bypassPermissions');
  assert.equal(sessionSettings(undefined, { permissionMode: 'bypassPermissions' }, false, 'auto').permissionMode, 'bypassPermissions');
  assert.equal(sessionSettings({ permissionMode: 'plan' }, {}, true, 'auto').permissionMode, 'plan');
  // a child of a Bypass parent on a blocked desk: childSettings leaves the mode out, so it starts in Auto
  const child = childSettings({ permissionMode: 'bypassPermissions' }, 'claude', 'claude');
  assert.equal(sessionSettings(undefined, child, false, deskMode({ blocked: 1 })).permissionMode, 'auto');
});

test('the effort is copied between sessions on the same brand only', () => {
  assert.deepEqual(childSettings({ model: 'claude-sonnet-5-5', effort: 'low' }, 'claude', 'claude'), { model: 'shift', effort: 'low' });
  assert.deepEqual(childSettings({ model: 'gpt-6.1-sol', effort: 'high' }, 'codex', 'codex'), { model: 'shift', effort: 'high' });
  assert.deepEqual(childSettings({ model: 'shift', effort: 'high' }, 'claude', 'codex'), { model: 'shift' });
  assert.deepEqual(childSettings({ effort: 'max' }, 'grok', 'claude'), { model: 'shift' });
});

test('Codex and Grok children are in Shift too, on their own gears', () => {
  assert.deepEqual(childSettings({ model: 'claude-opus-5-5' }, 'claude', 'grok'), { model: 'shift' });
  assert.deepEqual(childSettings({ model: 'gpt-6-astra' }, 'codex', 'codex'), { model: 'shift' });
});

test('an unknown brand counts as Claude, and no parent settings still gives Shift', () => {
  assert.deepEqual(childSettings({ effort: 'low' }, undefined, 'claude'), { model: 'shift', effort: 'low' });
  assert.deepEqual(childSettings(undefined, 'claude', 'claude'), { model: 'shift' });
  assert.equal(gearsOf('nobody'), GEARS.claude);
});

test('every brand has gears, cheapest first, with keys no other brand uses', () => {
  for (const brand of ['claude', 'codex', 'grok']) assert.ok(gearsOf(brand).length >= 2, brand);
  const keys = Object.values(GEARS).flat().map((g) => g.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('the start gear: asked for, else the company\'s, else the top one', () => {
  assert.equal(startGearOf('claude').id, 'claude-opus-5-5');
  assert.equal(startGearOf('claude', 'sonnet').id, 'claude-sonnet-5-5');
  assert.equal(startGearOf('claude', undefined, 'opus').id, 'claude-opus-5-5');
  assert.equal(startGearOf('claude', 'sonnet', 'opus').id, 'claude-sonnet-5-5');
  assert.equal(startGearOf('codex', undefined, 'sol').id, 'gpt-6.1-sol');
  assert.equal(startGearOf('grok').id, 'grok-4.7');
  // a gear of another brand is not one of this brand's, so the next choice wins
  assert.equal(startGearOf('codex', 'sonnet').id, 'gpt-6-astra');
  assert.equal(startGearOf('grok', 'opus', 'full').id, 'grok-4.7');
});

test('a gear is found by its key or its model id', () => {
  assert.equal(findGear('claude', 'claude-opus-5-5').key, 'opus');
  assert.equal(findGear('codex', 'astra').id, 'gpt-6-astra');
  assert.equal(findGear('claude', 'luna'), undefined);
});

test('a company\'s start gears keep only real gears of real brands', () => {
  assert.deepEqual(cleanStartGear({ claude: 'sonnet', codex: 'haiku', grok: 'full', other: 'x' }), { claude: 'sonnet', grok: 'full' });
  assert.deepEqual(cleanStartGear(undefined), {});
  assert.deepEqual(cleanStartGear('haiku'), {});
});
