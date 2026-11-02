// Tests for update-mode.mjs: whether updates are pulled by themselves, and what the update card shows. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMode, pullsByItself, updatePrompt, changeReason, typingNow, TYPING_QUIET_MS } from '../update-mode.mjs';

const waiting = { from: 'aaaaaaa', to: 'bbbbbbb', files: ['server.mjs'] };

test('only auto pulls by itself; no answer yet waits like manual', () => {
  assert.equal(pullsByItself('auto'), true);
  assert.equal(pullsByItself('manual'), false);
  assert.equal(pullsByItself(undefined), false);
  assert.equal(pullsByItself('sometimes'), false);
});

test('a mode is auto or manual; anything else counts as not chosen', () => {
  assert.equal(cleanMode('auto'), 'auto');
  assert.equal(cleanMode('manual'), 'manual');
  assert.equal(cleanMode('Auto'), null);
  assert.equal(cleanMode(null), null);
});

test('the card: asks the first time, offers Update now in manual, nothing in auto or with no update', () => {
  assert.equal(updatePrompt({ waiting, mode: undefined }), 'first');
  assert.equal(updatePrompt({ waiting, mode: 'manual' }), 'manual');
  assert.equal(updatePrompt({ waiting, mode: 'auto' }), null);
  assert.equal(updatePrompt({ waiting: null, mode: undefined }), null);
  assert.equal(updatePrompt({ waiting: null, mode: 'manual' }), null);
});

test('why files changed: Docket\'s own pull (auto or Update now) vs a change made outside it', () => {
  assert.equal(changeReason({ pulledBy: 'auto', from: 'a', to: 'b' }).short, 'taking in an update (auto)');
  assert.equal(changeReason({ pulledBy: 'now', from: 'a', to: 'b' }).short, 'taking in an update (Update now)');
  const pulled = changeReason({ pulledBy: null, from: '1111111aaaa', to: '2222222bbbb' });
  assert.equal(pulled.short, 'files changed on disk outside an update');
  assert.equal(pulled.moved, true);
  assert.match(pulled.detail, /1111111 → 2222222 without Docket pulling it/);
  const edited = changeReason({ pulledBy: null, from: '1111111', to: '1111111' });
  assert.equal(edited.moved, false);
  assert.match(edited.detail, /without a new git commit/);
  assert.equal(changeReason({ pulledBy: null, from: '', to: '2222222' }).moved, false); // start commit unknown: not claimed as a pull
});

test('typing counts for a minute after the last keystroke the page reported', () => {
  const t = 1_000_000;
  assert.equal(typingNow(t, t), true);
  assert.equal(typingNow(t, t + 59_999), true);
  assert.equal(typingNow(t, t + TYPING_QUIET_MS), false); // a full minute with no keystroke: not typing
  assert.equal(typingNow(t, t + 5 * 60000), false);
  assert.equal(typingNow(0, t), false); // no keystroke yet since the app started
  assert.equal(typingNow(undefined, t), false);
  assert.equal(typingNow(t + 1000, t), false); // a time from the future (clock changed) does not hold anything
  assert.equal(TYPING_QUIET_MS, 60000); // the same minute as TYPING_IDLE in index.html
});
