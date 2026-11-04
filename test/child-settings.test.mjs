// Tests for child-settings.mjs and gears.mjs: a session started by another session starts in Shift,
// on the gear asked for, the company's start gear, or the lowest. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childSettings } from '../child-settings.mjs';
import { GEARS, gearsOf, findGear, startGearOf, cleanStartGear } from '../gears.mjs';

test('a child is in Shift whatever model its parent uses', () => {
  assert.deepEqual(childSettings({ permissionMode: 'bypassPermissions', model: 'shift', effort: '' }, 'claude', 'claude'), { model: 'shift' });
  assert.deepEqual(childSettings({ model: 'claude-opus-5-5' }, 'claude', 'claude'), { model: 'shift' });
  assert.deepEqual(childSettings({ permissionMode: 'auto', model: '', effort: '' }, 'claude', 'claude'), { model: 'shift' });
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
