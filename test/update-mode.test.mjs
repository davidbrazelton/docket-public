// Tests for update-mode.mjs: why files changed, and when typing holds an update. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeReason, typingNow, TYPING_QUIET_MS } from '../update-mode.mjs';

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
