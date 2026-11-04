// Tests for the Order and Keep line above the session list: a redraw must not replace the dropdown,
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
  const el = () => ({ writes: 0, _html: '', set innerHTML(v) { this.writes++; this._html = v.replace(/ selected/g, ' selected=""').replace(/ >/g, '>'); }, get innerHTML() { return this._html; } });
  const opts = el(), keep = el();
  const bar = { hidden: true };
  const env = { open: false, order: 'oldest', S: { listWanted: false, attn: false, attnWindow: 'workday' } };
  const $ = (id) => (id === 'listOpts' ? opts : id === 'attnOpts' ? keep : bar);
  const setListBar = new Function('$', 'tip', 'ORDER_CHOICES', 'ATTN_WINDOWS', 'listOrder', 'listSelectOpen', 'S',
    page.slice(start, end) + '\nreturn setListBar;')($, () => '', [['oldest', 'Oldest'], ['newest', 'Newest']],
    [['workday', 'Last workday'], ['7d', '7 days']], () => env.order, () => env.open, env.S);
  return { setListBar, opts, keep, env };
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

test('the Keep dropdown sits after ✦ only while ✦ is on, and the 👁 menu no longer has it (#617, #626)', () => {
  const { setListBar, opts, keep, env } = load();
  setListBar();
  assert.match(opts.innerHTML, /<select id="listOrder"/);
  assert.equal(keep.innerHTML, '', 'hidden while ✦ is off');
  env.S.attn = true; setListBar();
  assert.equal(keep.writes, 2, 'turning ✦ on redraws the bar');
  assert.match(keep.innerHTML, /^<span>Keep:<\/span><select id="attnWindow" aria-label="[^"]+"/);
  assert.match(keep.innerHTML, /value="workday" selected/);
  env.S.attnWindow = '7d'; setListBar();
  assert.equal(keep.writes, 3, 'a changed window rewrites the bar');
  assert.match(keep.innerHTML, /value="7d" selected/);
  env.S.attn = false; setListBar();
  assert.equal(keep.innerHTML, '', 'turning ✦ off hides it again');
  assert.match(page, /<span id="attnOpts"><\/span><button id="attnBtn"[^>]*>✦<\/button>/, 'right before ✦ (#633)');
  assert.match(page, /\.list-bar #attnOpts, \.list-bar #attnOpts:empty \+ #attnBtn \{ margin-left: auto; \}/, 'Keep, or ✦ when Keep is hidden, pushes to the right');
  assert.doesNotMatch(page, /\.list-bar \.view-menu \{ margin-left: auto; \}/);
  const menu = page.slice(page.indexOf('function renderViewMenu'), page.indexOf('// ✦ carries the attention count'));
  assert.ok(menu.length > 0 && !menu.includes('attnWindow'));
  assert.match(page, /if \(\['listOrder', 'attnWindow'\]\.includes\(e\.target\.id\)\) e\.target\.blur\(\);/, 'blurred after a change, like Order');
  assert.doesNotMatch(page, /👁 > ✦/);
});

test('the ✦ and Keep tips are a lead line and bullets, and Help keeps the line breaks (#633)', () => {
  for (const key of ['attn', 'attn-window']) {
    const row = page.match(new RegExp(`\\['${key}', '[^']*', '([^']*)'`));
    assert.ok(row, `the ${key} tip is in the tip table`);
    assert.ok(row[1].split('\\n• ').length > 4, `the ${key} tip has bullets`);
  }
  assert.match(page, /\.help-row span \{[^}]*white-space: pre-line;/);
});
