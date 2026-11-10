import test from 'node:test';
import assert from 'node:assert/strict';
import { narrationText } from '../narration.mjs';

// Signature headers as Claude Code 2.1.303 saves them: a few bytes, then the kind's name.
const sig = (kind) => Buffer.concat([Buffer.from([8, 4, 18, 159, 19, 10, 17, 8, 19, 24, 2, 56, 1, 66, kind.length]), Buffer.from(kind), Buffer.from('rest-of-signature')]).toString('base64');

test('a narration block is reply text', () => {
  assert.equal(narrationText({ type: 'thinking', thinking: 'The answer is 11/27.\n\n', signature: sig('narration') }), 'The answer is 11/27.');
});

test('real thinking, an empty block and other blocks are not', () => {
  assert.equal(narrationText({ type: 'thinking', thinking: 'weighing it', signature: sig('thinking') }), '');
  assert.equal(narrationText({ type: 'thinking', thinking: '', signature: sig('narration') }), '');
  assert.equal(narrationText({ type: 'thinking', thinking: 'no signature' }), '');
  assert.equal(narrationText({ type: 'text', text: 'hi' }), '');
  assert.equal(narrationText(undefined), '');
});
