// Tests for the "?" badge: a live session paused on a prompt shows it in place of the plain yellow dot. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.indexOf('const GROUP_KINDS');
const end = page.indexOf('const dotTip');
assert.ok(start > 0 && end > start, 'dotClass in index.html has moved');
const inBackground = (s) => s.live && s.status === 'idle' && (s.runningTasks > 0 || s.background);
const needsYou = (s) => s.live ? (s.status === 'requires_action' || (s.unread && s.status === 'idle')) : !!s.waiting;
const signingIn = (s) => !!s.signin; // a private browser sign-in waits on the person (#1253)
const { dotClass, groupKinds } = new Function('needsYou', 'inBackground', 'failedTip', 'signingIn',
  page.slice(start, end) + '\nreturn { dotClass, groupKinds };')(needsYou, inBackground, () => '', signingIn);

test('a session waiting on a sign-in is yellow even while it works, and back to blue once it clears (#1253)', () => {
  assert.equal(dotClass({ live: true, status: 'running', signin: true }), 'needs');
  assert.equal(dotClass({ live: true, status: 'running' }), 'running');
});

test('a live session paused on a prompt shows the "?" badge', () => {
  assert.equal(dotClass({ live: true, status: 'requires_action' }), 'asking');
  assert.equal(dotClass({ live: true, status: 'requires_action', unread: true }), 'asking');
});

test('an unread finished session keeps the plain yellow dot', () => {
  assert.equal(dotClass({ live: true, status: 'idle', unread: true }), 'needs');
  assert.equal(dotClass({ live: false, waiting: true }), 'needs', 'a saved session that was waiting');
});

test('once answered the badge goes back to the running dot', () => {
  assert.equal(dotClass({ live: true, status: 'running' }), 'running');
});

test('an error still wins over the badge', () => {
  assert.equal(dotClass({ live: true, status: 'requires_action', lastError: { text: 'x' } }), 'failed');
});

test('group headers count the badge with the sessions waiting on you', () => {
  assert.deepEqual(groupKinds([{ live: true, status: 'requires_action' }, { live: true, status: 'idle', unread: true }]), { w: 0, n: 2, i: 0, e: 0 });
});

test('the badge has its own style with a "?" mark', () => {
  assert.match(page, /\.dot\.asking \{[^}]*var\(--warn\)[^}]*var\(--on-warn\)/);
  assert.match(page, /\.dot\.asking::after \{ content: '\?'; \}/);
});
