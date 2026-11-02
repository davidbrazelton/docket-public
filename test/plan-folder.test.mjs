// The read-only plan folder (#180 step 3): plan-folder.mjs reads a folder of markdown checklist plans another system
// keeps, works out the tree, and never changes anything there. The fixture is test/fixtures/plan-folder: notes/Projects
// holds one folder per piece of work, worktree/ is reached only through a shortcut folder (a junction made per test),
// and home/ holds the per-session marker files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseChecklist, mdRefs, buildTree, createFolderReader, readMarkers, markerPlan } from '../plan-folder.mjs';
import { buildProfile } from '../profile.mjs';
import { DOCKET_KEYS, copyEntry } from '../copy-company.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(here, 'fixtures', 'plan-folder');
const page = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(here, '..', 'server.mjs'), 'utf8');

// A notes folder whose Projects folder links to the fixture's work folders, plus one shortcut into "the worktree".
function notesRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-planfolder-'));
  fs.mkdirSync(path.join(root, 'Projects'));
  for (const d of fs.readdirSync(path.join(FX, 'notes', 'Projects'))) fs.symlinkSync(path.join(FX, 'notes', 'Projects', d), path.join(root, 'Projects', d), 'junction');
  fs.symlinkSync(path.join(FX, 'worktree'), path.join(root, 'Projects', 'TICK-400-link'), 'junction');
  return root;
}
// Every file under the fixture with its time and contents, to show nothing was changed.
function snapshot(dir, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) snapshot(p, out);
    else out[p] = `${fs.statSync(p).mtimeMs} ${createHash('sha256').update(fs.readFileSync(p)).digest('hex')}`;
  }
  return out;
}
const byKey = (t, k) => t.plans.find((p) => p.key === k);

test('a plain checklist and Docket\'s detail lines are both read', () => {
  const plain = parseChecklist('# Plain\n\n- [x] one\n- [ ] two\n  - [ ] two a\n* [X] three\n', 'plain.md');
  assert.equal(plain.title, 'Plain');
  assert.deepEqual(plain.items.map((i) => [i.title, i.state, i.indent]), [['one', 'done', 0], ['two', 'open', 0], ['two a', 'open', 2], ['three', 'done', 0]]);
  const d = parseChecklist(fs.readFileSync(path.join(FX, 'notes/Projects/TICK-100-epic/TICK-102-plan.md'), 'utf8'), 'x.md');
  assert.deepEqual(d.partOf, { file: 'TICK-100-plan.md', id: '', task: '' }, 'a parent named by file path');
  assert.equal(d.made, '2026-10-31 21:03');
  const [t1, t2, t3] = d.items;
  assert.equal(t1.id, 'T1'); assert.equal(t1.state, 'done');
  assert.equal(t2.state, 'claimed'); assert.equal(t2.holder, '8ad80cd72d86'); assert.equal(t2.holderTitle, 'F2 migration docs');
  assert.deepEqual(t2.links, ['[TICK-207](https://example.invalid/browse/TICK-207)']);
  assert.deepEqual(t3.after, ['T2']); assert.equal(t3.state, 'waiting_on_user'); assert.match(t3.note, /developer/);
  const ids = parseChecklist('# M\n\n- Plan: p-aaaa11\n- Part of: p-9x8y7z task T2\n\n- [ ] T1 a\n  - Plan: p-bbbb22\n', 'm.md');
  assert.equal(ids.id, 'p-aaaa11');
  assert.deepEqual(ids.partOf, { file: '', id: 'p-9x8y7z', task: 'T2' }, 'a parent named by Docket plan id');
  assert.deepEqual(ids.items[0].plan, { file: '', id: 'p-bbbb22', task: '' });
});

test('links to plans are found by markdown link and by file name, never in web addresses or code', () => {
  assert.deepEqual(mdRefs('- [ ] TICK-101-plan.md and [fixes](sub/TICK-102-plan.md) and [x](https://h/a.md)'), ['sub/TICK-102-plan.md', 'TICK-101-plan.md']);
  assert.deepEqual(mdRefs('see C:\\notes\\Projects\\A-plan.md.'), ['C:\\notes\\Projects\\A-plan.md']);
  assert.deepEqual(mdRefs('[spaced](my%20plan.md)'), ['my plan.md']);
  const p = parseChecklist('# A\n\n```\n- [ ] not-a-task.md\n```\n- [ ] real\n', 'a.md');
  assert.equal(p.items.length, 1);
  assert.equal(p.links.length, 0);
});

test('the tree: parents from Part of, else from the index plan\'s links, with progress rolled up', async () => {
  const root = notesRoot();
  const t = await createFolderReader({ root }).get();
  assert.equal(t.error, undefined);
  assert.deepEqual(t.plans.map((p) => p.key), [
    'Projects/TICK-100-epic/TICK-100-plan.md', 'Projects/TICK-100-epic/TICK-101-plan.md', 'Projects/TICK-100-epic/TICK-102-plan.md',
    'Projects/TICK-100-epic/TICK-103-localrun-plan.md', 'Projects/TICK-200-loose/TICK-200-plan.md', 'Projects/TICK-300-docket/p-aaaa11-master.md',
    'Projects/TICK-300-docket/p-bbbb22-bump.md', 'Projects/TICK-400-link/TICK-400-plan.md'], 'the notes file without a checklist is not a plan; the shortcut folder is followed');
  const index = byKey(t, 'Projects/TICK-100-epic/TICK-100-plan.md');
  assert.equal(index.parent, null);
  assert.deepEqual(index.children, ['Projects/TICK-100-epic/TICK-101-plan.md', 'Projects/TICK-100-epic/TICK-102-plan.md', 'Projects/TICK-100-epic/TICK-103-localrun-plan.md']);
  // its five lines: three stand for their sub-plans (2/4, 1/3, 2/2), one done, one open
  assert.deepEqual([index.done, index.total], [6, 11]);
  assert.deepEqual(index.own, { done: 2, total: 5 });
  assert.deepEqual(index.items.map((i) => i.sub), [['Projects/TICK-100-epic/TICK-101-plan.md'], ['Projects/TICK-100-epic/TICK-102-plan.md'], ['Projects/TICK-100-epic/TICK-103-localrun-plan.md'], [], []]);
  assert.equal(byKey(t, 'Projects/TICK-100-epic/TICK-101-plan.md').parent, index.key, 'by file name on an index line');
  assert.equal(byKey(t, 'Projects/TICK-100-epic/TICK-102-plan.md').parent, index.key, 'by Part of with a file path');
  // Docket's own shape, named by plan id both ways
  const master = byKey(t, 'Projects/TICK-300-docket/p-aaaa11-master.md');
  assert.deepEqual(master.children, ['Projects/TICK-300-docket/p-bbbb22-bump.md']);
  assert.deepEqual([master.done, master.total], [2, 4]);
  assert.equal(master.coordinator, '33d44026aaaa');
  // a plan reached through the shortcut names its parent by a path relative to where it was found
  assert.equal(byKey(t, 'Projects/TICK-400-link/TICK-400-plan.md').parent, 'Projects/TICK-200-loose/TICK-200-plan.md');
  assert.deepEqual(t.roots, [index.key, 'Projects/TICK-200-loose/TICK-200-plan.md', master.key]);
  assert.deepEqual(t.broken.map((b) => [b.from, b.ref, b.line]), [[index.key, 'TICK-999-plan.md', 11]]);
  assert.deepEqual(t.unlinked, ['Projects/TICK-400-link/TICK-400-plan.md'], 'every other plan is named by some file');
});

test('a loop of Part of lines never hangs or double counts', () => {
  const docs = [
    { file: '/n/a.md', plan: parseChecklist('# A\n- Part of: b.md\n\n- [ ] see b.md\n', '/n/a.md') },
    { file: '/n/b.md', plan: parseChecklist('# B\n- Part of: a.md\n\n- [x] see a.md\n', '/n/b.md') },
  ];
  const t = buildTree(docs, { root: '/n', exists: () => false });
  assert.equal(t.plans.filter((p) => !p.parent).length, 1, 'one of the two is cut loose');
  assert.ok(t.plans.every((p) => p.total <= 2));
});

test('reading changes nothing in the folder, and a changed file is read again', async () => {
  const before = snapshot(FX);
  const root = notesRoot();
  let at = 0;
  const reader = createFolderReader({ root, minGapMs: 1000, now: () => at });
  const a = await reader.get();
  at += 10;
  assert.equal(await reader.get(), a, 'inside the gap the last read is reused');
  at += 5000;
  const b = await reader.get();
  assert.equal(b, a, 'nothing changed, so nothing was read again');
  readMarkers('.notes-plan-*', path.join(FX, 'home'));
  assert.deepEqual(snapshot(FX), before, 'no file under the fixture changed (time or contents)');
  // A copy we may change: an edit is noticed by its time and size.
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-planfolder-edit-'));
  fs.writeFileSync(path.join(copy, 'a-plan.md'), '# A\n\n- [ ] one\n');
  const r2 = createFolderReader({ root: copy, minGapMs: 0 });
  assert.deepEqual([(await r2.get()).plans[0].done, (await r2.get()).plans[0].total], [0, 1]);
  fs.writeFileSync(path.join(copy, 'a-plan.md'), '# A\n\n- [x] one\n- [ ] two\n');
  fs.utimesSync(path.join(copy, 'a-plan.md'), new Date(), new Date(Date.now() + 5000));
  const c = await r2.get();
  assert.deepEqual([c.plans[0].done, c.plans[0].total, c.read], [1, 2, 1], 'only the changed file was read');
  fs.writeFileSync(path.join(copy, 'b-plan.md'), '# B\n\n- [ ] new\n');
  fs.utimesSync(copy, new Date(), new Date(Date.now() + 9000));
  assert.equal((await r2.get()).plans.length, 2, 'a new file is found');
});

test('a folder that is not there says so', async () => {
  const t = await createFolderReader({ root: path.join(os.tmpdir(), 'docket-no-such-folder-' + Date.now()) }).get();
  assert.match(t.error, /cannot open/);
  assert.deepEqual(t.plans, []);
});

test('markers: only claimed ones count, matched to the plan by path', async () => {
  const m = readMarkers('.notes-plan-*', path.join(FX, 'home'));
  assert.deepEqual(m.map((x) => [x.session, x.plan]), [['abcdef123456', 'Projects/TICK-100-epic/TICK-102-plan.md']], 'state=none is left out, and so is a file of another name');
  const root = notesRoot();
  const t = await createFolderReader({ root }).get();
  assert.equal(markerPlan(t, root, m[0].plan), 'Projects/TICK-100-epic/TICK-102-plan.md');
  assert.equal(markerPlan(t, root, path.join(root, 'Projects', 'TICK-200-loose', 'TICK-200-plan.md')), 'Projects/TICK-200-loose/TICK-200-plan.md', 'an absolute path');
  assert.equal(markerPlan(t, root, 'elsewhere/TICK-103-localrun-plan.md'), 'Projects/TICK-100-epic/TICK-103-localrun-plan.md', 'by name when the path moved');
  assert.deepEqual(readMarkers('', FX), []);
  assert.deepEqual(readMarkers('no-star', FX), []);
});

test('the setting: a real third choice, kept on save and carried over by Copy as new desk', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-plans-'));
  const toggle = (c) => buildProfile({ id: 't', name: 'T', home, folder: home, ...c }, { isDefaultHome: false })
    .sections.find((s) => s.id === 'switches').groups.find((g) => g.title === 'Plans').items;
  const items = toggle({ planSystem: 'folder', planFolder: { path: 'C:/notes', marker: '.notes-plan-*' } });
  assert.deepEqual(items[0].toggle.options.map(([v]) => v), ['docket', 'folder', 'none']);
  assert.equal(items[0].toggle.value, 'folder');
  assert.ok(items.some((i) => i.input?.key === 'path' && i.input.value === 'C:/notes'));
  assert.ok(items.some((i) => i.input?.key === 'marker' && i.input.value === '.notes-plan-*'));
  assert.ok(!toggle({ planSystem: 'docket' }).some((i) => i.input), 'the folder boxes show only for a plan folder');
  assert.ok(DOCKET_KEYS.includes('planFolder'));
  const c = copyEntry({ name: 'A', home: 'C:/a', folder: 'C:/a', planSystem: 'folder', planFolder: { path: 'C:/notes', marker: '.x-*' } }, { name: 'B', home: 'C:/b' });
  assert.deepEqual([c.planSystem, c.planFolder], ['folder', { path: 'C:/notes', marker: '.x-*' }]);
  assert.match(server, /const planFolder = cleanPlanFolder\(/, 'cleanCompany keeps it on save');
});

test('a plan folder desk gets no plan tools and no plan instructions', () => {
  assert.match(server, /const plansOn = \(client\) => client\?\.planSystem === 'docket';/);
  assert.match(server, /\.\.\.\(plansOn\(clientById\(parent\.client\)\) \? planToolDefs\(parent\) : \[\]\)/);
  assert.match(server, /const planRules = \(s\) => plansOn\(clientById\(s\.client\)\) \? optionalPrompt\('plans\.md'\) : '';/);
});

test('the setup wizard offers the plan folder, with its folder', () => {
  assert.match(page, /plans: 'none',/);
  assert.match(page, /planSystem: w\.plans, \.\.\.\(w\.plans === 'folder'/);
});
