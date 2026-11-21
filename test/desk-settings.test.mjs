// Tests for the list settings kept per desk (#617): the order, ✦ and what it keeps, and the 👁 options. A desk with
// none of its own reads the one all desks shared before; a change on one desk leaves the others as they were.
// Runs that part of index.html with a pretend localStorage. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const part = (a, b) => { const s = page.indexOf(a), e = page.indexOf(b, s); assert.ok(s > 0 && e > s, `${a} has moved or lost its markers`); return page.slice(s, e); };
const storeCode = part('const store = {', '// A popped-out session');
const readCode = part('const VIEW_OPTS = [', 'readDeskSettings();\n');

function load(saved = {}) {
  const items = new Map(Object.entries(saved).map(([k, v]) => [k, JSON.stringify(v)]));
  const localStorage = { getItem: (k) => items.has(k) ? items.get(k) : null, setItem: (k, v) => items.set(k, String(v)) };
  const S = { client: 'a' };
  const attnWindowOf = (v) => ['off', '12h', 'yesterday', 'workday', '7d', 'pins'].includes(v) ? v : 'workday';
  const api = new Function('localStorage', 'S', 'attnWindowOf', storeCode + readCode + '\nreturn { store, deskStore, readDeskSettings };')(localStorage, S, attnWindowOf);
  return { ...api, S, items };
}
const shown = (S) => [S.attn, S.attnWindow, S.groupView, S.showEmptyGroups, S.prChips, S.tkChips, S.commentChips, S.brandLogos];

test('a desk with no settings of its own reads the shared ones, so nothing resets', () => {
  const { S, readDeskSettings, deskStore } = load({ listOrder: 'newest', attnFilter: true, attnWindow: '7d', groupView: false, prChips: false, ticketChips: false, commentChips: false, brandLogos: false, showEmptyGroups: true });
  readDeskSettings();
  assert.deepEqual(shown(S), [true, '7d', false, true, false, false, false, false]);
  assert.equal(deskStore.get('listOrder', 'oldest'), 'newest');
});

test('with nothing saved anywhere, each starts as before', () => {
  const { S, readDeskSettings, deskStore } = load();
  readDeskSettings();
  assert.deepEqual(shown(S), [false, 'workday', true, false, true, true, true, true]);
  assert.equal(deskStore.get('listOrder', 'oldest'), 'oldest');
});

test('a change on one desk leaves the other desks as they were', () => {
  const { S, readDeskSettings, deskStore, items } = load({ listOrder: 'oldest', groupView: true });
  for (const [k, v] of [['listOrder', 'natural'], ['attnFilter', true], ['attnWindow', 'pins'], ['groupView', false], ['showEmptyGroups', true], ['prChips', false], ['ticketChips', false], ['commentChips', false], ['brandLogos', false]]) deskStore.set(k, v);
  readDeskSettings();
  assert.equal(deskStore.get('listOrder', 'oldest'), 'natural');
  assert.deepEqual(shown(S), [true, 'pins', false, true, false, false, false, false]);
  S.client = 'b'; readDeskSettings(); // switching desks reads that desk's
  assert.equal(deskStore.get('listOrder', 'oldest'), 'oldest');
  assert.deepEqual(shown(S), [false, 'workday', true, false, true, true, true, true]);
  assert.equal(items.get('listOrder'), '"oldest"', 'the shared value is left alone');
  S.client = 'a'; readDeskSettings();
  assert.equal(S.attnWindow, 'pins');
});

test('every one of them is read and written per desk, and a desk switch reads them again before the list redraws', () => {
  assert.doesNotMatch(page, /\bstore\.(get|set)\('(listOrder|attnFilter|attnWindow|groupView|showEmptyGroups|prChips|ticketChips|commentChips|brandLogos)'/);
  assert.doesNotMatch(page, /\bstore\.set\(key, S\[k\]\)/);
  const select = part('function selectClient(id, openId) {', '// A list that was asked for before a change arrived');
  assert.match(select, /readDeskSettings\(\);[^]*renderClients\(\); renderList\(\);/);
});
