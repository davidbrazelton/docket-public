// A remote desk's tab (#1108): it copies the list settings of the desk this page was on, once, and asks none of the
// first-run questions a new desk gets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const page = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');

// seedRemoteDesks from the page, run on a fake localStorage.
function seed(clients, current, saved, lastLocal = null) {
  const fn = page.slice(page.indexOf('function seedRemoteDesks'), page.indexOf('// end of desk settings'));
  assert.ok(fn.includes('function seedRemoteDesks'), 'seedRemoteDesks has moved');
  const m = new Map(Object.entries(saved));
  const localStorage = { get length() { return m.size; }, key: (i) => [...m.keys()][i], getItem: (k) => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)) };
  const store = { get(k, d) { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); }, set(k, v) { localStorage.setItem(k, JSON.stringify(v)); } };
  new Function('S', 'store', 'localStorage', 'lastLocalDesk', fn + '\nseedRemoteDesks();')({ clients, client: current }, store, localStorage, lastLocal);
  return Object.fromEntries(m);
}
const desks = [{ id: 'acme', name: 'Acme' }, { id: 'beta', name: 'Beta' }, { id: 'rd1-home', name: 'Home', remote: { connected: true } }];

test('a new remote tab copies every list setting of the desk open now, as it is', () => {
  const out = seed(desks, 'beta', { 'reasonDot@beta': 'true', 'reasonTags@beta': '"off"', 'listOrder@beta': '"newest"', 'collapsedGroups@beta': '{"g1":true}', 'costRows@beta': '"family"', 'progressView@beta': '"pie"', 'reasonDot@acme': 'false', 'theme': '"dark"' });
  assert.equal(out['reasonDot@rd1-home'], 'true');
  assert.equal(out['reasonTags@rd1-home'], '"off"');
  assert.equal(out['listOrder@rd1-home'], '"newest"');
  assert.equal(out['collapsedGroups@rd1-home'], '{"g1":true}');
  assert.equal(out['costRows@rd1-home'], '"family"');
  assert.equal(out['progressView@rd1-home'], '"pie"');
  assert.equal(out['deskSeeded@rd1-home'], 'true');
  assert.equal(out['theme@rd1-home'], undefined, 'only the desk keys');
});

test('only once, and never over a setting the remote tab already has', () => {
  const out = seed(desks, 'beta', { 'reasonDot@beta': 'true', 'listOrder@beta': '"newest"', 'listOrder@rd1-home': '"oldest"' });
  assert.equal(out['listOrder@rd1-home'], '"oldest"');
  assert.equal(out['reasonDot@rd1-home'], 'true');
  const again = seed(desks, 'beta', { 'reasonDot@beta': 'false', 'deskSeeded@rd1-home': 'true', 'reasonDot@rd1-home': 'true' });
  assert.equal(again['reasonDot@rd1-home'], 'true', 'its own settings after that');
});

test('opened from another remote tab, it copies the desk here that was open last', () => {
  const two = [...desks, { id: 'rd2-lab', name: 'Lab', remote: { connected: true } }];
  const out = seed(two, 'rd1-home', { 'deskSeeded@rd1-home': 'true', 'reasonDot@acme': 'true', 'reasonDot@beta': 'false', 'client': '"rd1-home"' }, 'acme');
  assert.equal(out['reasonDot@rd2-lab'], 'true');
});

test('a remote tab shows none of the first-run questions, the tour, the main color ask or the usage notice', () => {
  for (const fn of ['showPlanOffer', 'showUsageFirst']) {
    const body = page.slice(page.indexOf(`function ${fn}(`), page.indexOf('\n}', page.indexOf(`function ${fn}(`)));
    assert.match(body, /onRemoteTab\(\)/, fn);
  }
  // What's new and suggestions (#1168): every entry that belongs to a desk here, or to this browser's list settings,
  // is left out on a remote desk's tab; only talk mode (this browser's own) is not.
  assert.match(page, /const sgHere = \(\) => !POPOUT && !onRemoteTab\(\);/);
  for (const k of ['cost', 'reason', 'questions', 'forms', 'plans', 'cache', 'setup', 'start', 'summary']) {
    const at = page.indexOf(`\n  ${k}: { sec: `), line = page.slice(at, page.indexOf('\n', at + 3));
    assert.match(line, /sgHere\(\)/, k);
  }
  assert.match(page, /if \(!\$\('dlg'\)\.hidden \|\| !\$\('wiz'\)\.hidden \|\| onRemoteTab\(\)\) return;/, 'tour and main color');
  assert.match(page, /seedRemoteDesks\(\); \/\/ before the switch/);
  assert.match(page, /seedRemoteDesks\(\); \/\/ a remote desk just added/);
});
