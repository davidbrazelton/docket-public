// Shift by default: a new session given no model is in Shift, on its start gear; one picked up again keeps
// its saved model. Covers gears.mjs and the model menu's part of index.html. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sessionSettings, firstGear, parentGear, raiseGear } from '../gears.mjs';

test('a new session given no model is in Shift', () => {
  assert.equal(sessionSettings(undefined, {}).model, 'shift');
  assert.equal(sessionSettings(undefined, { permissionMode: 'auto' }).model, 'shift');
  assert.deepEqual(sessionSettings(undefined, {}), { permissionMode: 'bypassPermissions', model: 'shift', effort: '' });
});

test('a model picked for a new session is kept, the account default included', () => {
  assert.equal(sessionSettings(undefined, { model: 'claude-opus-5-5' }).model, 'claude-opus-5-5');
  assert.equal(sessionSettings(undefined, { model: '' }).model, ''); // a handoff copying "account default"
});

test('a session picked up again keeps its saved model', () => {
  assert.equal(sessionSettings({ model: '' }, {}, true).model, '');
  assert.equal(sessionSettings({ model: 'claude-sonnet-5-5' }, {}, true).model, 'claude-sonnet-5-5');
  assert.equal(sessionSettings(undefined, {}, true).model, ''); // a desktop app conversation Docket has no record of
  assert.equal(sessionSettings({ model: '' }, { model: 'shift' }, true).model, 'shift'); // picked in the menu on resume
});

test('a Shift session gets its gear when it is made', () => {
  const shift = { model: 'shift' };
  assert.equal(firstGear({ settings: shift, brand: 'claude' }), 'claude-opus-5-5');
  assert.equal(firstGear({ settings: shift, brand: 'claude', asked: 'sonnet' }), 'claude-sonnet-5-5');
  assert.equal(firstGear({ settings: shift, brand: 'claude', companyStart: 'opus' }), 'claude-opus-5-5');
  assert.equal(firstGear({ settings: shift, brand: 'codex', companyStart: 'sol' }), 'gpt-6.1-sol');
  assert.equal(firstGear({ settings: shift, brand: 'grok', asked: 'full', companyStart: 'fast' }), 'grok-4.7');
  assert.equal(firstGear({ settings: shift, brand: 'claude', saved: 'claude-opus-5-5', asked: 'haiku' }), 'claude-opus-5-5');
  assert.equal(firstGear({ settings: { model: 'claude-opus-5-5' }, brand: 'claude', asked: 'sonnet' }), null);
});

test("a child a session starts begins on its parent's gear", () => {
  assert.equal(parentGear('claude', 'claude', 'claude-opus-5-5'), 'claude-opus-5-5');
  assert.equal(parentGear('claude', 'claude', 'claude-sonnet-5-5'), 'claude-sonnet-5-5');
  // another brand: the same height from the top
  assert.equal(parentGear('codex', 'claude', 'claude-opus-5-5'), 'gpt-6-astra');
  assert.equal(parentGear('grok', 'claude', 'claude-opus-5-5'), 'grok-4.7');
  assert.equal(parentGear('grok', 'claude', 'claude-sonnet-5-5'), 'grok-4.7-build-fast');
  assert.equal(parentGear('claude', 'grok', 'grok-4.7'), 'claude-opus-5-5');
  assert.equal(parentGear('claude', 'grok', 'grok-4.7-build-fast'), 'claude-sonnet-5-5');
  // the account default is no gear: the company's start gear then applies
  assert.equal(parentGear('claude', 'claude', ''), undefined);
  assert.equal(parentGear('claude', 'claude', undefined), undefined);
  // the inherited gear goes in as the asked one, so it wins over the company's start gear
  const asked = parentGear('claude', 'claude', 'claude-opus-5-5');
  assert.equal(firstGear({ settings: { model: 'shift' }, brand: 'claude', asked, companyStart: 'haiku' }), 'claude-opus-5-5');
});

test('a parent can raise its Shift child, never lower it or raise another session', () => {
  const child = { reportsTo: 'p1', settings: { model: 'shift' }, engine: 'claude', gear: 'claude-haiku-5-5' };
  const up = raiseGear({ callerId: 'p1', rec: child, to: 'opus' });
  assert.equal(up.from.id, 'claude-haiku-5-5');
  assert.equal(up.gear.id, 'claude-opus-5-5');
  assert.equal(up.same, false);
  assert.equal(raiseGear({ callerId: 'p1', rec: { ...child, gear: 'claude-opus-5-5' }, to: 'opus' }).same, true);
  // not its child
  assert.match(raiseGear({ callerId: 'p2', rec: child, to: 'opus' }).refused, /not a session you started/);
  assert.ok(raiseGear({ callerId: 'p1', rec: undefined, to: 'opus' }).refused);
  // never down
  assert.match(raiseGear({ callerId: 'p1', rec: { ...child, gear: 'claude-opus-5-5' }, to: 'sonnet' }).refused, /only raise/);
  // not a gear of its brand
  assert.ok(raiseGear({ callerId: 'p1', rec: { ...child, engine: 'grok', gear: 'grok-4.7-build-fast' }, to: 'opus' }).refused);
  assert.equal(raiseGear({ callerId: 'p1', rec: { ...child, engine: 'grok', gear: 'grok-4.7-build-fast' }, to: 'full' }).gear.id, 'grok-4.7');
  // a model the user chose is left alone, and the message still goes
  const fixed = raiseGear({ callerId: 'p1', rec: { ...child, settings: { model: 'claude-sonnet-5-5' } }, to: 'opus' });
  assert.ok(fixed.ignored && !fixed.refused && !fixed.gear);
  // no gear saved: counted from its company's start gear
  assert.equal(raiseGear({ callerId: 'p1', rec: { ...child, gear: undefined }, to: 'sonnet', companyStart: 'opus' }).refused !== undefined, true);
});

// The model menu: currentSettings and resumeSettings from index.html, with a pretend page state and store.
const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const a = page.indexOf('function currentSettings()'), b = page.indexOf('// A title and the context gauge');
const menu = (S, stored) => new Function('S', 'clientDefaults', page.slice(a, b) + '\nreturn { currentSettings, resumeSettings };')(S, () => ({ permissionMode: 'bypassPermissions', model: '', effort: '', ...stored }));

test('the model menu starts on Shift for a new session until a model is picked', () => {
  assert.ok(a > 0 && b > a, 'the model menu part of index.html has moved');
  assert.equal(menu({ selected: 'draft', live: {} }, {}).currentSettings().model, 'shift');
  assert.equal(menu({ selected: 'draft', live: {} }, { model: '' }).currentSettings().model, 'shift'); // an older saved setting
  assert.equal(menu({ selected: 'draft', live: {} }, { model: '', modelPicked: true }).currentSettings().model, '');
  assert.equal(menu({ selected: 'draft', live: {} }, { model: 'claude-opus-5-5', modelPicked: true }).currentSettings().model, 'claude-opus-5-5');
});

test('a saved session picked up from the page keeps its model unless one was picked while it was open', () => {
  assert.equal('model' in menu({ selected: 'old', live: {} }, { model: 'shift', modelPicked: true }).resumeSettings(), false);
  assert.equal(menu({ selected: 'old', live: {}, modelPickedFor: 'old' }, { model: 'claude-opus-5-5', modelPicked: true }).resumeSettings().model, 'claude-opus-5-5');
});
