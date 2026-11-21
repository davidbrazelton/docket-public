// Tests for what ☰ > About says after Check for updates (#1046): the click's own result shows even when nothing is
// new, and "up to date" is not said plainly while the running app still waits to restart onto the new code.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.indexOf('const UPD_FRESH_MS');
const end = page.indexOf('let updCheckedAt');
assert.ok(start > 0 && end > start, 'the Updates line part of index.html has moved');
const ago = (ms) => (Date.now() - ms < 60000 ? 'now' : Math.floor((Date.now() - ms) / 60000) + 'm');
const { UPD_FRESH_MS, updLine, checkedLabel } = new Function('ago', page.slice(start, end) + '\nreturn { UPD_FRESH_MS, updLine, checkedLabel };')(ago);

const now = Date.now();
const upToDate = { result: 'up to date', at: now - 5 * 60000 };
const waiting = { restarting: false, why: '2 sessions replying', taken: { toVersion: '1.216.0' } };

test('with nothing new, a click still shows its own result for a few seconds', () => {
  assert.equal(updLine(upToDate).text, 'up to date · 5m ago', 'before the click');
  const after = { ...upToDate, at: now };
  assert.equal(updLine(after).text, 'up to date · just now');
  const clicked = updLine(after, now, now + 1000);
  assert.equal(clicked.text, 'Checked just now: up to date');
  assert.equal(clicked.fresh, true, 'highlighted');
  assert.equal(updLine(after, now, now + UPD_FRESH_MS + 1).fresh, false, 'then back to the plain line');
  assert.equal(checkedLabel(after), 'Up to date ✓', 'the button says it too');
});

test('up to date on disk but not running yet says so, and why', () => {
  const l = updLine({ ...upToDate, restartWaiting: waiting });
  assert.equal(l.text, 'up to date on disk, not running yet: waiting for 2 sessions replying · 5m ago');
  assert.equal(l.onDisk, true);
  assert.match(updLine({ ...upToDate, restartWaiting: { ...waiting, why: '' } }).text, /waiting for sessions to finish/);
  assert.match(updLine({ ...upToDate, restartWaiting: { ...waiting, restarting: true } }).text, /not running yet: restarting now/);
  assert.equal(updLine({ result: 'updated', at: now, restartWaiting: waiting }, now, now).text,
    'Checked just now: pulled 1.216.0, not running yet: waiting for 2 sessions replying');
  assert.equal(checkedLabel({ result: 'updated', restartWaiting: waiting }), 'Pulled 1.216.0 ✓');
});

test('failed and skipped keep their word, and stay red', () => {
  assert.equal(updLine({ result: 'failed', at: now, restartWaiting: waiting }).onDisk, false, 'a failed check is not called up to date');
  assert.equal(checkedLabel({ result: 'failed' }), 'Check failed');
  assert.equal(checkedLabel({ result: 'skipped' }), 'Check skipped');
  assert.equal(updLine({ checking: true }).text, 'checking now');
  assert.equal(updLine({}).text, 'not checked yet');
  assert.match(page, /\['skipped', 'failed', 'not taken in'\]\.includes\(u\.result\) \? ' bad'/);
  assert.match(page, /\.ctx \.ver\.bad \.res \{ color: var\(--warn/);
});

test('the click handler shows the result on the button and the line, then goes back', () => {
  assert.match(page, /updCheckedAt = Date\.now\(\); showUpdate\(u\);/);
  assert.match(page, /b\.textContent = checkedLabel\(u\);/);
  assert.match(page, /setTimeout\(\(\) => \{ b\.textContent = 'Check for updates'; if \(menuVerLast\) drawMenuVer\(menuVerLast\); \}, UPD_FRESH_MS\)/);
  assert.match(page, /u\.restartWaiting && !res\.onDisk \?/, 'the separate restart lines are not repeated under the folded-in line');
});
