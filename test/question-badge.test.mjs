// Tests for the "?" badge: a live session paused on a prompt shows it in place of the plain yellow dot. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.indexOf('const GROUP_DOT_ORDER');
const end = page.indexOf('const dotTip');
assert.ok(start > 0 && end > start, 'dotClass in index.html has moved');
const inBackground = (s) => s.live && s.status === 'idle' && (s.runningTasks > 0 || s.background);
const needsYou = (s) => s.live ? (s.status === 'requires_action' || (s.unread && s.status === 'idle')) : !!s.waiting;
const { dotClass, GROUP_DOT_ORDER } = new Function('needsYou', 'inBackground', 'failedTip',
  page.slice(start, end) + '\nreturn { dotClass, GROUP_DOT_ORDER };')(needsYou, inBackground, () => '');

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

test('group headers show the badge as its own kind, beside the yellow dot', () => {
  assert.ok(GROUP_DOT_ORDER.indexOf('asking') === GROUP_DOT_ORDER.indexOf('needs') - 1);
});

test('the badge has its own style with a "?" mark', () => {
  assert.match(page, /\.dot\.asking \{[^}]*var\(--warn\)[^}]*var\(--on-warn\)/);
  assert.match(page, /\.dot\.asking::after \{ content: '\?'; \}/);
});
