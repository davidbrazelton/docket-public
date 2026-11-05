// Tests for the Order line and the ✦ control above the session list: a redraw must not replace the dropdown,
// so an open one stays open; and the ✦ control's Keep period (#684). Runs the list bar part of index.html with a pretend element.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.indexOf('// ---------- list bar');
const end = page.indexOf('// end of list bar');
assert.ok(start > 0 && end > start, 'the list bar part of index.html has moved or lost its markers');

const WINDOWS = [['off', 'Off', 'Off', 'None'], ['workday', 'Workday', 'WD', 'Since the last workday'], ['7d', '7 days', '7d', 'Last 7 days']];
// The browser reads innerHTML back in its own spelling (selected="", no space before >), so the pretend
// element does the same: comparing with innerHTML would never match.
function load() {
  const el = () => ({ writes: 0, _html: '', set innerHTML(v) { this.writes++; this._html = v.replace(/ selected/g, ' selected=""').replace(/ >/g, '>'); }, get innerHTML() { return this._html; } });
  const opts = el();
  const bar = { hidden: true };
  const env = { open: false, order: 'oldest', S: { listWanted: false, attn: false, attnWindow: 'workday' } };
  const $ = (id) => (id === 'listOpts' ? opts : bar);
  const fns = new Function('$', 'tip', 'ORDER_CHOICES', 'ATTN_WINDOWS', 'attnWindowOf', 'listOrder', 'listSelectOpen', 'S',
    page.slice(start, end) + '\nreturn { setListBar, attnWinLabel, attnMenuHtml, pickAttnWindow };')($, () => '', [['oldest', 'Oldest'], ['newest', 'Newest']],
    WINDOWS, (v) => (WINDOWS.some(([k]) => k === v) ? v : 'workday'), () => env.order, () => env.open, env.S);
  return { ...fns, opts, env };
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

test('✦ and its Keep period are one control; the Keep dropdown and label are gone (#684)', () => {
  const { setListBar, opts, env } = load();
  setListBar();
  assert.match(opts.innerHTML, /<select id="listOrder"/);
  assert.doesNotMatch(opts.innerHTML, /Keep|attnWindow/);
  env.S.attn = true; setListBar();
  assert.equal(opts.writes, 1, 'turning ✦ on does not redraw the Order line');
  assert.match(page, /<span class="attn-ctl" id="attnCtl"><button id="attnBtn"[^>]*>✦<\/button><button id="attnWinBtn" aria-haspopup="menu"[^>]*><\/button><div id="attnMenu" class="tl-menu attn-pop" role="menu"[^>]*hidden><\/div><\/span>/, 'the period sits right of ✦, in one control');
  assert.doesNotMatch(page, /id="attnWindow"|<span>Keep:<\/span>|id="attnOpts"/);
  assert.match(page, /\.attn-ctl \{[^}]*border-radius: 8px;/, 'the same 8 px corners as every button');
  const menu = page.slice(page.indexOf('function renderViewMenu'), page.indexOf('// ✦ carries the attention count'));
  assert.ok(menu.length > 0 && !menu.includes('attnWindow'));
  assert.doesNotMatch(page, /👁 > ✦/);
});

test('the period shows its name, and a short one for a narrow panel', () => {
  const { attnWinLabel } = load();
  assert.match(attnWinLabel('workday'), /<span class="wl">Workday<\/span><span class="ws">WD<\/span>/);
  assert.match(attnWinLabel('7d'), /class="wl">7 days</);
  assert.match(page, /@container \(max-width: \d+px\) \{ \.attn-ctl #attnWinBtn \.wl \{ display: none; \} \.attn-ctl #attnWinBtn \.ws \{ display: inline; \} \}/);
});

test('the Keep menu lists every period with a tick on the one picked', () => {
  const { attnMenuHtml } = load();
  const html = attnMenuHtml('7d');
  assert.equal(html.match(/role="menuitemradio"/g).length, WINDOWS.length);
  assert.match(html, /aria-checked="true" data-win="7d"[^>]*><span class="tick">✓<\/span>7 days/);
  assert.match(html, /aria-checked="false" data-win="workday"[^>]*><span class="tick"><\/span>Workday/);
});

test('picking a period while ✦ is off turns it on; while on it only changes the period; it never turns ✦ off', () => {
  const { pickAttnWindow } = load();
  const S = { attn: false, attnWindow: 'workday' };
  assert.equal(pickAttnWindow(S, '7d'), true, 'says it turned ✦ on');
  assert.deepEqual(S, { attn: true, attnWindow: '7d' });
  assert.equal(pickAttnWindow(S, 'off'), false);
  assert.deepEqual(S, { attn: true, attnWindow: 'off' }, 'Off is a period, not ✦ off');
  pickAttnWindow(S, 'sideways');
  assert.equal(S.attnWindow, 'workday', 'an unknown one falls back to Workday');
});

test('the ✦ and Keep tips are a lead line and bullets, and Help keeps the line breaks (#633)', () => {
  for (const key of ['attn', 'attn-window']) {
    const row = page.match(new RegExp(`\\['${key}', '[^']*', '([^']*)'`));
    assert.ok(row, `the ${key} tip is in the tip table`);
    assert.ok(row[1].split('\\n• ').length > 4, `the ${key} tip has bullets`);
  }
  assert.match(page, /\.help-row span \{[^}]*white-space: pre-line;/);
});
