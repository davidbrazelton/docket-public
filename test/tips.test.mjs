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
const { HELP, TIP_ROWS, TOUR, tip, tipText } = new Function('soundTip', escLine + '\n' + platform + '\n' + page.slice(start, end) + '\nreturn { HELP, TIP_ROWS, TOUR, tip, tipText };')(() => 'sound');

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
    assert.ok(from > 0 && m.index - from < 3000, `no items list above line ${lineOf(m.index)}`);
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
  assert.equal(tipText('new', true), TIP_ROWS.new[2], 'a control with no turned-on wording keeps its tip');
});

test('the welcome tour has at most five steps, each with words and a place to point at', () => {
  assert.ok(TOUR.length >= 1 && TOUR.length <= 5, `${TOUR.length} steps`);
  for (const st of TOUR) {
    assert.ok(st.at && st.title && st.text, JSON.stringify(st));
    assert.ok(page.includes(`id="${st.at.slice(1)}"`), `${st.at} is not on the page`);
    if (st.alt) assert.ok(page.includes(`id="${st.alt.slice(1)}"`), `${st.alt} is not on the page`);
  }
});

test('the ☰ menu offers Instructions and Show me around in its Help group, and no item ends in …', () => {
  assert.ok(/\['helps', 'Help', \[\['key', 'Key'\], \['help', 'Instructions'\], \['tour', 'Show me around'\]\]\]/.test(page));
  const at = page.indexOf("$('menuBtn').onclick"), items = page.slice(page.indexOf('const items =', at), page.indexOf('const item =', at));
  assert.ok(items.length > 100 && !/…|\.'\]/.test(items), items);
  for (const k of ['menu-profile', 'menu-gauges', 'menu-helps', 'menu-settings', 'menu-about', 'pause-all']) assert.ok(TIP_ROWS[k], k);
});
