// Tests for which ready-to-close sentence of a done turn gets the green band (in index.html, #726, #764). Run with: npm test
// The page is one file with no modules, so the part under test is read out of it between its markers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.indexOf('// ---------- done turns');
const end = page.indexOf('// end of done turns');
assert.ok(start > 0 && end > start, 'the done turns part of index.html has moved or lost its markers');
const { finSpan } = new Function(page.slice(start, end) + '\nreturn { finSpan };')();

const banded = (text) => { const s = finSpan(text); return s ? text.slice(...s) : s; };

test('finSpan: a plain ready-to-close sentence gets the band', () => {
  assert.equal(banded('This session is complete and ready to close.'), 'This session is complete and ready to close.');
  assert.equal(banded('PR #12 is open. This session is ready to close.'), 'This session is ready to close.');
});

test('finSpan: closing that waits on the user gets no band (#764)', () => {
  assert.equal(banded('Two things are left for you, then this session is ready to close:'), false);
  assert.equal(banded('Once you merge it, this session is ready to close.'), false);
  assert.equal(banded('It is ready to close after you test it on the Mac.'), false);
  assert.equal(banded('Not ready to close yet.'), false);
  assert.equal(banded('This session isn\'t ready to close.'), false);
});

test('finSpan: no ready-to-close sentence is null', () => {
  assert.equal(finSpan('Fixed the list.'), null);
});
