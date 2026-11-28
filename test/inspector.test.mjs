// The desk's Inspector (#527): its address, with the old #<desk>/profile still opening it, and the section it shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const a = page.indexOf('const isInspectorHash'), b = page.indexOf('// end of the Inspector\'s address');
assert.ok(a > 0 && b > a, 'the Inspector\'s address part of index.html has moved or lost its marker');
const { isInspectorHash, inspectorSection, pfSection } = new Function(page.slice(a, b) + '\nreturn { isInspectorHash, inspectorSection, pfSection };')();

test('the Inspector opens from its own address and from the old profile one', () => {
  for (const h of ['#acme/inspector', '#acme/inspector/hooks', '#acme/profile', '#acme/profile/mcp']) assert.ok(isInspectorHash(h), h);
  for (const h of ['#acme', '#acme/s/123', '', '#']) assert.ok(!isInspectorHash(h), h);
});

test('the address names the section to show, or none', () => {
  assert.equal(inspectorSection('#acme/inspector/hooks'), 'hooks');
  assert.equal(inspectorSection('#acme/inspector'), '');
  assert.equal(inspectorSection('#acme/profile'), '');
});

test('the named section is shown; with none, or one the desk lacks, Instructions; failing that the first', () => {
  const secs = ['hooks', 'instructions', 'switches'].map((id) => ({ id }));
  assert.equal(pfSection(secs, 'switches').id, 'switches');
  assert.equal(pfSection(secs, '').id, 'instructions');
  assert.equal(pfSection(secs, 'gone').id, 'instructions');
  assert.equal(pfSection([{ id: 'hooks' }, { id: 'mcp' }], '').id, 'hooks');
  assert.equal(pfSection([], ''), undefined);
});
