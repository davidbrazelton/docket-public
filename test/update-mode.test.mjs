// Tests for update-mode.mjs: why files changed, and when typing holds an update. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { changeReason, typingNow, typingHolds, TYPING_QUIET_MS, TYPING_CAP_MS } from '../update-mode.mjs';

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

test('typing holds one wait for 15 minutes at most, however long the pings keep coming (#965)', () => {
  const since = 1_000_000;
  assert.equal(typingHolds(since, since, since), true); // typing as the wait begins: held
  assert.equal(typingHolds(since + 14 * 60000, since + 14 * 60000 + 30000, since), true); // a keystroke 30 s ago, 14.5 min in
  assert.equal(typingHolds(since + TYPING_CAP_MS - 1000, since + TYPING_CAP_MS, since), false); // still pinging, but 15 min are up
  assert.equal(typingHolds(since + 3 * 3600000, since + 3 * 3600000, since), false); // the 3-hour hold of #965 cannot happen
  assert.equal(typingHolds(since, since + TYPING_QUIET_MS, since), false); // a minute with no keystroke: not typing, cap or not
  assert.equal(typingHolds(since, since + 1000), true); // no wait going on (the arrow's "busy now"): no cap, only the minute
  assert.equal(typingHolds(0, since, since), false);
  assert.equal(TYPING_CAP_MS, 15 * 60000);
});

test('the page says you are typing only on a keystroke, not on coming back to a draft (#965)', () => {
  const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(page, /addEventListener\('input', \(e\) => \{ if \(e\.isTrusted\) typingOn\(true\); \}\)/);
  assert.match(page, /if \(ping === true && [^\n]*api\('\/api\/typing-now', \{ session: typing\.id \}\)/);
  const resume = page.match(/function typingResume\(\) \{[^\n]*/)[0];
  assert.match(resume, /typingOn\(\)/); // the typing-time clock runs on again, but with no ping
  assert.doesNotMatch(resume, /typingOn\(true\)/);
});
