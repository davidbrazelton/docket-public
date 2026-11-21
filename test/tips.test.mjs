// Tests for the hover tips, the Help window's list and the welcome tour. Run with: npm test
// Every clickable control in index.html, in the page's own markup or built in code, must carry a hover tip,
// and every tip must come from the one list (HELP) that the Help window also shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.indexOf('// ---------- tips');
const end = page.indexOf('// end of tips');
assert.ok(start > 0 && end > start, 'the tips part of index.html has moved or lost its markers');
const escLine = page.split('\n').find((l) => l.startsWith('const esc = '));
const platform = page.slice(page.indexOf('// ---------- platform'), page.indexOf('// end of platform')); // the words tips use
const keys = page.slice(page.indexOf('// ---------- keys'), page.indexOf('// end of keys')); // the shortcuts they end on
// The tips as a Windows computer (or a Mac) runs them.
const load = (platform_) => new Function('globalThis', 'soundTip', escLine + '\n' + platform + '\n' + keys + '\n' + page.slice(start, end)
  + '\nreturn { HELP, TIP_ROWS, TOUR, tip, tipText, KEYMAP, TIP_KEYS, tipKeys, shortcutText };')({ navigator: { platform: platform_ } }, () => 'sound');
const { HELP, TIP_ROWS, TOUR, tip, tipText, KEYMAP, TIP_KEYS, tipKeys, shortcutText } = load('Win32');
const mac = load('MacIntel');

const lineOf = (i) => page.slice(0, i).split('\n').length;
// Every opening tag of a control, read to its closing > while skipping over ${...} inside it.
function controls() {
  const out = [], re = /<(button|select|input|textarea|a)\b/g;
  let m;
  while ((m = re.exec(page))) {
    let i = m.index + 1, depth = 0;
    for (; i < page.length; i++) {
      if (page.startsWith('${', i)) { depth++; i++; continue; }
      if (depth && page[i] === '{') depth++;
      else if (depth && page[i] === '}') depth--;
      else if (!depth && page[i] === '>') break;
    }
    out.push({ kind: m[1], tag: page.slice(m.index, i + 1), line: lineOf(m.index) });
  }
  return out;
}
const clickable = (c) => !(c.kind === 'input' && /type="(file|hidden)"/.test(c.tag)) && !(c.kind === 'a' && !/\bhref=/.test(c.tag));
const hasTip = (tag) => /\btitle="[^"]/.test(tag) || /\bdata-tip="[^"]+"/.test(tag) || /\$\{tip\(/.test(tag) || /\$\{[^}]*\btip\(/.test(tag);

test('every button, select, input and link on the page has a hover tip', () => {
  const found = controls().filter(clickable);
  assert.ok(found.length > 150, `only ${found.length} controls found; the scan is broken`);
  const missing = found.filter((c) => !hasTip(c.tag)).map((c) => `line ${c.line}: ${c.tag.slice(0, 120)}`);
  assert.deepEqual(missing, [], 'controls with no hover tip');
});

test('the page script still reads as JavaScript (a ${tip()} inside plain quotes breaks it)', () => {
  for (const m of page.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]), `script at line ${lineOf(m.index)}`);
});

test('no control has an empty tip', () => {
  const empty = controls().filter((c) => /\btitle=""/.test(c.tag)).map((c) => `line ${c.line}: ${c.tag.slice(0, 120)}`);
  assert.deepEqual(empty, []);
});

test('every tip a control names is in the list', () => {
  const keys = new Set();
  for (const m of page.matchAll(/data-tip="([^"$]+)"/g)) keys.add(m[1]);
  for (const m of page.matchAll(/\btip(?:Text)?\('([a-z0-9-]+)'[,)]/g)) keys.add(m[1]);
  assert.ok(keys.size > 100);
  const unknown = [...keys].filter((k) => !TIP_ROWS[k]);
  assert.deepEqual(unknown, [], 'tip names with no row in HELP');
});

test('every menu item built from a list has a tip in the list', () => {
  // tip('menu-' + k): the keys are the ['key', 'Label'] pairs in the items list just above it.
  const missing = [];
  for (const m of page.matchAll(/tip\('([a-z]+-)' \+ k\)/g)) {
    const from = page.lastIndexOf('const items =', m.index);
    assert.ok(from > 0 && m.index - from < 4000, `no items list above line ${lineOf(m.index)}`);
    const keys = [...page.slice(from, m.index).matchAll(/\['([a-z-]+)', [^\]]*\](?!\.includes)/g)].map((x) => x[1]); // not ['a', 'b'].includes(...)
    assert.ok(keys.length, `no items found above line ${lineOf(m.index)}`);
    for (const k of keys) if (!TIP_ROWS[m[1] + k]) missing.push(`line ${lineOf(m.index)}: ${m[1] + k}`);
  }
  assert.deepEqual(missing, []);
});

test('every row in the list has a name and a plain tip', () => {
  const seen = new Set();
  for (const [area, rows] of HELP) {
    assert.ok(area && rows.length, 'an empty section');
    for (const r of rows) {
      assert.ok(!seen.has(r[0]), `${r[0]} is listed twice`); seen.add(r[0]);
      assert.ok(r[1], `${r[0]} has no name`);
      const t = tipText(r[0]);
      assert.ok(typeof t === 'string' && t.length > 2, `${r[0]} has no tip`);
    }
  }
});

test('a tip is written into the tag safely', () => {
  assert.match(tip('menu-stall'), /^ title="[^"]+"$/);
  assert.equal(tip('nonesuch'), ' title=""');
  assert.equal(tipText('groupview'), TIP_ROWS.groupview[2]);
  assert.equal(tipText('groupview', true), TIP_ROWS.groupview[3]);
  assert.equal(tipText('new', true), tipText('new'), 'a control with no turned-on wording keeps its tip');
});

test('the welcome tour has at most five steps, each with words and a place to point at', () => {
  assert.ok(TOUR.length >= 1 && TOUR.length <= 5, `${TOUR.length} steps`);
  for (const st of TOUR) {
    assert.ok(st.at && st.title && st.text, JSON.stringify(st));
    assert.ok(page.includes(`id="${st.at.slice(1)}"`), `${st.at} is not on the page`);
    if (st.alt) assert.ok(page.includes(`id="${st.alt.slice(1)}"`), `${st.alt} is not on the page`);
  }
});

test('the ☰ menu offers Instructions, Show me around and What\'s new in its Help group, and no item ends in …', () => {
  assert.ok(/\['helps', 'Help', \[\['key', 'Key'\], \['help', 'Instructions'\], \['tour', 'Show me around'\], \['whatsnew', "What's new and suggestions"\]\]\]/.test(page));
  const at = page.indexOf("$('menuBtn').onclick"), items = page.slice(page.indexOf('const items =', at), page.indexOf('const item =', at));
  assert.ok(items.length > 100 && !/…|\.'\]/.test(items), items);
  for (const k of ['menu-profile', 'menu-gauges', 'menu-helps', 'menu-settings', 'menu-about', 'pause-all']) assert.ok(TIP_ROWS[k], k);
});

// Shortcuts in the tips (#1120). Shortcuts with no control of their own, so no tip to show them on:
const NO_CONTROL = {
  palette: 'only its keys open it', quickOpen: 'only its keys open it',
  prevSession: 'moves through the list, not a control', nextSession: 'moves through the list, not a control',
  talk: 'a key the user can change; the talk mode tip names the one in use',
};
const refId = (x) => (Array.isArray(x) ? (typeof x[0] === 'string' ? x[0] : null) : x)?.split(':')[0];
// Is a tip shown on a control: a data-tip, tip()/tipText() by name, or a name built from the ctx- and menu- lists.
const shown = (k) => page.includes(`data-tip="${k}"`) || page.includes(`tip('${k}'`) || page.includes(`tipText('${k}'`)
  || page.includes(`tipShortcut('${k}'`) || (k.startsWith('ctx-') && page.includes("tip('ctx-' + k)"))
  || (k.startsWith('dlg-') && page.includes("tipText('dlg-' + b.label.toLowerCase())"))
  || (k.startsWith('menu-') && page.includes("tip('menu-' + x[0]"));

test('every shortcut with a control is on that control\'s tip, so a new one cannot skip it (#1120)', () => {
  const linked = new Set(Object.values(TIP_KEYS).flat().map(refId).filter(Boolean));
  const ids = new Set(KEYMAP.map((k) => k.id));
  const missing = [...ids].filter((id) => !linked.has(id) && !NO_CONTROL[id]);
  assert.deepEqual(missing, [], 'KEYMAP shortcuts no tip shows: add their control\'s tip to TIP_KEYS in index.html (or to NO_CONTROL here, with why)');
  assert.deepEqual([...linked].filter((id) => !ids.has(id)), [], 'TIP_KEYS names a shortcut KEYMAP does not have');
  assert.deepEqual(Object.keys(NO_CONTROL).filter((id) => linked.has(id) || !ids.has(id)), [], 'NO_CONTROL is out of date');
  for (const k of Object.keys(TIP_KEYS)) {
    assert.ok(TIP_ROWS[k], `${k} is not a tip`);
    assert.ok(shown(k), `no control shows the ${k} tip`);
  }
});

test('a tip ends on a line of its own with its shortcuts, in Windows and in Mac keys (#1120)', () => {
  for (const [os, m] of [['Windows', { tipText, tipKeys, shortcutText }], ['Mac', mac]]) {
    const isMac = os === 'Mac';
    for (const [k, list] of Object.entries(TIP_KEYS)) {
      const t = m.tipText(k), lines = t.split('\n'), last = lines.pop();
      assert.equal(last, `Shortcut: ${m.tipKeys(k, isMac)}`, `${os}: ${k}`);
      assert.ok(lines.join('\n').trim(), `${os}: ${k} has words above its shortcut line`);
      for (const x of list) if (typeof x === 'string' && !x.includes(':')) {
        assert.ok(last.includes(m.shortcutText(x, isMac)), `${os}: ${k} shows all of ${x}'s keys`);
        assert.ok(!lines.join('\n').includes(`(${m.shortcutText(x, isMac)})`), `${os}: ${k} still names its key in its words`);
      }
    }
  }
  assert.equal(tipText('side-toggle').split('\n').pop(), 'Shortcut: Ctrl+B');
  assert.equal(mac.tipText('side-toggle').split('\n').pop(), 'Shortcut: ⌘B');
  assert.equal(tipText('ctx-archive').split('\n').pop(), 'Shortcut: Delete');
  assert.equal(mac.tipText('ctx-archive').split('\n').pop(), 'Shortcut: ⌘⌫');
  assert.equal(tipText('send').split('\n').pop(), 'Shortcut: Enter');
  assert.equal(tipText('fb-send').split('\n').pop(), 'Shortcut: Ctrl+Enter');
  assert.equal(tipText('dlg-close').split('\n').pop(), 'Shortcut: Esc');
  assert.equal(tipText('menu-about').split('\n').pop(), 'Shortcut: Alt+click shows or hides Remote Desks'); // labs:line
  assert.equal(tipText('lb-prev'), 'Previous picture\nShortcut: Left');
  assert.equal(tipText('new', true), TIP_ROWS.new[2] + '\nShortcut: Ctrl+Alt+N');
  assert.equal(tipText('menu-stall'), TIP_ROWS['menu-stall'][2], 'a tip with no shortcut has no shortcut line');
});

test('a desk tab shows its own number\'s key, and none past the ninth (#1120)', () => {
  assert.match(tipText('company', false, { n: 3 }), /\nShortcut: Alt\+3 · Right-click opens its Inspector$/);
  assert.match(mac.tipText('company', false, { n: 3 }), /\nShortcut: ⌥3 · Right-click opens its Inspector$/);
  assert.match(tipText('company', false, { n: 10 }), /\nShortcut: Right-click opens its Inspector$/);
  assert.match(tipText('company'), /\nShortcut: Alt\+1…9 · /, 'Help names the whole range');
  assert.match(tipText('details', false, { more: '\n2 tasks running' }), /\n2 tasks running\nShortcut: Ctrl\+Alt\+B$/, 'added words go above the shortcut line');
});
