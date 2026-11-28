// Tests for the setup (#837, the profile until #910): what goes in docket-setup.json, what stays out, and how two computers' changes meet.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE_FILE, OLD_PROFILE_FILE, FOLDER_FILES, newestFolderFile, deskForFile, localItems, noteChanges, profileFile, readProfile, profilePlan, planSummary, hashOf, pathsOf } from '../profile-sync.mjs';

const desk = (over = {}) => ({ id: 'acme', name: 'Acme', home: 'C:\\Work\\acme\\claude-home', folder: 'C:\\Projects\\acme', ...over });
const at = (n) => `2026-11-09T10:00:${String(n).padStart(2, '0')}.000Z`;

test('deskForFile: keys, tokens and what Docket made on this computer stay out', () => {
  const { item, dropped } = deskForFile(desk({ env: { GH_TOKEN: 'x', OPENAI_API_KEY: 'y', DB_PASSWORD: 'z', REGION: 'eu' }, copiedFrom: 'other', madeFolders: ['a'], planSwitch: { to: 'none' } }));
  assert.deepEqual(item.env, { REGION: 'eu' });
  assert.deepEqual(dropped.sort(), ['DB_PASSWORD', 'GH_TOKEN', 'OPENAI_API_KEY']);
  for (const k of ['copiedFrom', 'madeFolders', 'planSwitch']) assert.equal(item[k], undefined, k);
  assert.equal(deskForFile(desk({ env: { API_TOKEN: 'x' } })).item.env, undefined, 'an env left empty goes');
});

test('localItems: desks, schedules (with their instructions, without their runs) and settings, by key', () => {
  const items = localItems({ desks: [desk(), { id: 'far', name: 'Far', remote: true }],
    schedules: [{ schedule: { id: 'daily', client: 'acme', title: 'Daily', cron: '0 9 * * *', enabled: true, runs: [{ at: 'x' }], lastSessionId: 's1' }, prompt: 'Do it' }],
    settings: { stallStop: true, accent: '#2563eb', ports: 4400 } });
  assert.deepEqual(Object.keys(items), ['desk:acme', 'schedule:daily', 'setting:stallStop', 'setting:accent']);
  assert.deepEqual(items['schedule:daily'].item, { id: 'daily', client: 'acme', title: 'Daily', cron: '0 9 * * *', fireAt: null, folder: null, enabled: true, prompt: 'Do it' });
});

test('noteChanges: a new or changed item is stamped now and here; a removed one is kept as gone', () => {
  const items = localItems({ desks: [desk()] });
  let r = noteChanges({}, items, { machine: 'pc', now: at(1) });
  assert.equal(r.changed, true);
  assert.deepEqual(r.meta['desk:acme'], { at: at(1), by: 'pc', hash: hashOf(items['desk:acme'].item) });
  r = noteChanges(r.meta, items, { machine: 'pc', now: at(2) });
  assert.equal(r.changed, false, 'nothing changed');
  r = noteChanges(r.meta, {}, { machine: 'pc', now: at(3) });
  assert.equal(r.meta['desk:acme'].gone, true);
  assert.equal(r.meta['desk:acme'].at, at(3));
});

test('profileFile: the newer of this computer\'s and the file\'s record, item by item', () => {
  const items = localItems({ desks: [desk(), desk({ id: 'beta', name: 'Beta' })] });
  const meta = { 'desk:acme': { at: at(5), by: 'pc' }, 'desk:beta': { at: at(1), by: 'pc' }, 'desk:gone': { at: at(2), by: 'pc', gone: true } };
  const theirs = { kind: 'desk', at: at(3), by: 'mac', platform: 'darwin', home: '/Users/pat', item: { id: 'beta', name: 'Beta 2' } };
  const old = { kind: 'desk', at: at(1), by: 'mac', platform: 'darwin', home: '/Users/pat', item: { id: 'acme', name: 'Old' } };
  const p = profileFile({ items, meta, machine: 'pc', platform: 'win32', home: 'C:\\Users\\pat', now: at(9), keep: { 'desk:beta': theirs, 'desk:acme': old } });
  assert.equal(p.items['desk:acme'].item.name, 'Acme', 'this computer\'s is newer');
  assert.equal(p.items['desk:acme'].platform, 'win32');
  assert.equal(p.items['desk:beta'], theirs, 'the file\'s is newer, and kept as it is');
  assert.deepEqual(p.items['desk:gone'], { kind: 'desk', at: at(2), by: 'pc', gone: true });
  assert.ok(readProfile(JSON.stringify(p)).profile, 'reads back');
});

test('readProfile: refuses what is not a setup, or one from a newer Docket, and skips unknown settings', () => {
  assert.match(readProfile('nope').error, /not JSON/);
  assert.match(readProfile('{"a":1}').error, /not a Docket setup \(docket-setup\.json\)/);
  assert.match(readProfile('{"docketProfile":99,"items":{}}').error, /newer Docket/);
  const r = readProfile(JSON.stringify({ docketProfile: 1, items: { 'setting:port': { at: at(1), item: { value: 1 } }, 'setting:sound': { at: at(1), item: { value: false } } } }));
  assert.deepEqual(Object.keys(r.profile.items), ['setting:sound']);
});

test('the file is docket-setup.json, and an older docket-profile.json still reads (#910)', () => {
  assert.equal(PROFILE_FILE, 'docket-setup.json');
  assert.deepEqual(FOLDER_FILES, ['docket-setup.json', 'docket-profile.json']);
  // What a Docket before #910 saved as docket-profile.json: the same inside.
  const old = { docketProfile: 1, savedAt: at(1), by: 'old-pc', items: { 'setting:sound': { at: at(1), item: { value: false } } } };
  assert.deepEqual(Object.keys(readProfile(JSON.stringify(old)).profile.items), ['setting:sound']);
});

test('newestFolderFile: a kept folder reads whichever of the two files changed last (#910)', () => {
  const setup = { file: PROFILE_FILE, text: '{"s":1}', mtime: 100 }, old = { file: OLD_PROFILE_FILE, text: '{"o":1}', mtime: 200 };
  assert.equal(newestFolderFile([setup, old]), old, 'a computer not yet updated wrote docket-profile.json last');
  assert.equal(newestFolderFile([{ ...setup, mtime: 300 }, old]).file, PROFILE_FILE);
  assert.equal(newestFolderFile([setup, { ...old, mtime: 100 }]).file, PROFILE_FILE, 'a tie reads docket-setup.json');
  assert.equal(newestFolderFile([{ ...setup, text: '', mtime: 0 }, old]), old, 'a folder with only the old file');
  assert.equal(newestFolderFile([{ ...setup, text: '', mtime: 0 }, { ...old, text: '', mtime: 0 }]), undefined);
});

// A profile written on a Mac, for the import tests.
const macFile = (items) => Object.fromEntries(Object.entries(items).map(([k, item]) => [k, { kind: k.split(':')[0], at: at(5), by: 'mac', platform: 'darwin', home: '/Users/pat', item }]));

test('profilePlan merge: adds and changes, keeps what the file lacks, converts paths and asks about missing ones', () => {
  const local = localItems({ desks: [desk(), desk({ id: 'mine', name: 'Mine' })], settings: { sound: true } });
  const incoming = macFile({ 'desk:acme': { ...desk(), folder: '/Users/pat/Projects/acme', home: '/Users/pat/acme-home' }, 'desk:new': { id: 'new', name: 'New', home: '/Users/pat/new-home' }, 'setting:sound': { value: false } });
  const exists = new Set(['C:\\Users\\pat\\Projects\\acme']);
  const place = (p, rec) => { const g = { '/Users/pat/Projects/acme': 'C:\\Users\\pat\\Projects\\acme', '/Users/pat/acme-home': 'C:\\Users\\pat\\acme-home', '/Users/pat/new-home': 'C:\\Users\\pat\\new-home' }[p]; assert.equal(rec.platform, 'darwin'); return exists.has(g) ? { path: g } : { ask: g }; };
  const plan = profilePlan({ local, incoming, mode: 'merge', place });
  const by = Object.fromEntries(plan.changes.map((c) => [c.key, c]));
  assert.deepEqual(Object.keys(by).sort(), ['desk:acme', 'desk:new', 'setting:sound']);
  assert.equal(by['desk:acme'].action, 'change');
  assert.equal(by['desk:acme'].item.folder, 'C:\\Users\\pat\\Projects\\acme', 'found here, so used');
  assert.deepEqual(by['desk:acme'].ask, [{ field: 'home', from: '/Users/pat/acme-home', suggest: 'C:\\Users\\pat\\acme-home' }]);
  assert.equal(by['desk:new'].action, 'add');
  assert.ok(!plan.changes.some((c) => c.action === 'remove'), 'merge removes nothing');
  assert.equal(plan.changes[plan.changes.length - 1].kind, 'setting', 'desks first');
});

test('profilePlan replace: also removes desks and schedules the file lacks, never settings', () => {
  const local = localItems({ desks: [desk(), desk({ id: 'mine', name: 'Mine' })], settings: { sound: true } });
  const plan = profilePlan({ local, incoming: { 'desk:acme': { kind: 'desk', at: at(1), platform: 'win32', home: 'C:\\Users\\pat', item: desk() } }, mode: 'replace' });
  assert.deepEqual(plan.changes.map((c) => `${c.action} ${c.key}`), ['remove desk:mine']);
});

test('profilePlan: a desk the file has under another id is matched by name, and its schedules follow', () => {
  const local = localItems({ desks: [desk({ id: 'acme_2' })] });
  const incoming = macFile({ 'desk:acme': desk(), 'schedule:daily': { id: 'daily', client: 'acme', title: 'Daily', cron: '0 9 * * *', enabled: true, prompt: 'x', folder: null, fireAt: null } });
  const plan = profilePlan({ local, incoming, mode: 'merge' });
  assert.deepEqual(plan.ids, { acme: 'acme_2' });
  assert.equal(plan.changes.find((c) => c.kind === 'schedule').item.client, 'acme_2');
  assert.ok(!plan.changes.some((c) => c.key === 'desk:acme'), 'no second Acme');
});

test('profilePlan sync: the newer side wins item by item, and both changed since the last sync asks', () => {
  const local = localItems({ desks: [desk({ folder: 'C:\\A' }), desk({ id: 'b', name: 'B', folder: 'C:\\B' }), desk({ id: 'c', name: 'C' })] });
  const meta = {
    'desk:acme': { at: at(1), synced: at(1) }, // unchanged here since the sync
    'desk:b': { at: at(4), synced: at(1) }, // changed here since
    'desk:c': { at: at(1), synced: at(1) },
  };
  const rec = (item, n, extra = {}) => ({ kind: 'desk', at: at(n), by: 'mac', platform: 'win32', home: 'C:\\Users\\pat', item, ...extra });
  const incoming = { 'desk:acme': rec(desk({ folder: 'C:\\A2' }), 3), 'desk:b': rec(desk({ id: 'b', name: 'B', folder: 'C:\\B2' }), 3), 'desk:c': { kind: 'desk', at: at(3), by: 'mac', gone: true }, 'desk:d': rec(desk({ id: 'd', name: 'D' }), 3) };
  const plan = profilePlan({ local, incoming, mode: 'sync', meta });
  assert.deepEqual(plan.changes.map((c) => `${c.action} ${c.key}`).sort(), ['add desk:d', 'change desk:acme', 'remove desk:c']);
  assert.deepEqual(plan.conflicts.map((c) => c.key), ['desk:b']);
  assert.deepEqual(planSummary(plan).conflicts[0], { key: 'desk:b', kind: 'desk', name: 'B', by: 'mac', at: at(3), myAt: at(4), removed: false, fields: ['folder'] });
  // Already taken in: nothing to do.
  assert.deepEqual(profilePlan({ local, incoming: { 'desk:acme': rec(desk({ folder: 'C:\\A' }), 1) }, mode: 'sync', meta }).changes, []);
});

test('profilePlan sync: a setting changed on both sides takes the newer, and the file\'s on a computer that never synced', () => {
  const local = localItems({ settings: { sound: true, theme: 'dark' } });
  const incoming = { 'setting:sound': { kind: 'setting', at: at(5), by: 'mac', item: { value: false } }, 'setting:theme': { kind: 'setting', at: at(5), by: 'mac', item: { value: 'light' } } };
  const meta = { 'setting:sound': { at: at(9) }, 'setting:theme': { at: at(9), synced: at(1) } };
  const plan = profilePlan({ local, incoming, mode: 'sync', meta });
  assert.deepEqual(plan.changes.map((c) => c.key), ['setting:sound'], 'never synced here: the file\'s');
  assert.deepEqual(plan.conflicts, [], 'theme: this computer\'s is newer, so it is written');
});

test('pathsOf: the folder paths of a desk, one level down too', () => {
  assert.deepEqual(pathsOf('desk', { home: 'C:\\h', folder: '', planFolder: { path: 'C:\\p' } }), [{ field: 'home', value: 'C:\\h' }, { field: 'planFolder.path', value: 'C:\\p' }]);
});
