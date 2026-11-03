// Tests for the Order line above the session list: a redraw must not replace the dropdown,
// so an open one stays open. Runs the list bar part of index.html with a pretend element.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.indexOf('// ---------- list bar');
const end = page.indexOf('// end of list bar');
assert.ok(start > 0 && end > start, 'the list bar part of index.html has moved or lost its markers');

// The browser reads innerHTML back in its own spelling (selected="", no space before >), so the pretend
// element does the same: comparing with innerHTML would never match.
function load() {
  const opts = { writes: 0, _html: '', set innerHTML(v) { this.writes++; this._html = v.replace(/ selected/g, ' selected=""').replace(/ >/g, '>'); }, get innerHTML() { return this._html; } };
  const bar = { hidden: true };
  const env = { open: false, order: 'oldest', S: { listWanted: false, attnWindow: 'workday' } };
  const $ = (id) => (id === 'listOpts' ? opts : bar);
  const setListBar = new Function('$', 'tip', 'ORDER_CHOICES', 'ATTN_WINDOWS', 'listOrder', 'listSelectOpen', 'S',
    page.slice(start, end) + '\nreturn setListBar;')($, () => '', [['oldest', 'Oldest'], ['newest', 'Newest']],
    [['workday', 'Last workday'], ['7d', '7 days']], () => env.order, () => env.open, env.S);
  return { setListBar, opts, env };
}

test('the same bar drawn again is not rewritten', () => {
  const { setListBar, opts } = load();
  setListBar(); setListBar(); setListBar();
  assert.equal(opts.writes, 1);
});

test('a changed choice rewrites the bar, and the Recent dropdown is gone', () => {
  const { setListBar, opts, env } = load();
  setListBar();
  env.order = 'newest'; setListBar();
  assert.equal(opts.writes, 2);
  assert.match(opts.innerHTML, /value="newest" selected/);
  assert.doesNotMatch(opts.innerHTML, /recentWin|Recent/);
});

test('while a dropdown is open the bar is left alone, and the list is asked to redraw once it closes', () => {
  const { setListBar, opts, env } = load();
  setListBar();
  env.open = true; env.order = 'newest'; setListBar();
  assert.equal(opts.writes, 1);
  assert.equal(env.S.listWanted, true);
  env.open = false; setListBar();
  assert.equal(opts.writes, 2);
  assert.match(opts.innerHTML, /value="newest" selected/);
});

test('the ✦ also keeps dropdown is on the Order line, and the 👁 menu no longer has it (#617)', () => {
  const { setListBar, opts, env } = load();
  setListBar();
  assert.match(opts.innerHTML, /<select id="listOrder"[^]*<select id="attnWindow"/);
  assert.match(opts.innerHTML, /value="workday" selected/);
  env.S.attnWindow = '7d'; setListBar();
  assert.equal(opts.writes, 2, 'a changed window rewrites the bar');
  assert.match(opts.innerHTML, /value="7d" selected/);
  const menu = page.slice(page.indexOf('function renderViewMenu'), page.indexOf('// ✦ carries the attention count'));
  assert.ok(menu.length > 0 && !menu.includes('attnWindow'));
  assert.match(page, /if \(\['listOrder', 'attnWindow'\]\.includes\(e\.target\.id\)\) e\.target\.blur\(\);/, 'blurred after a change, like Order');
  assert.doesNotMatch(page, /👁 > ✦/);
});
