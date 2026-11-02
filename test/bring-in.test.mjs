// Bring in past sessions, on made-up Claude homes in a temp folder: which homes are looked in (never another
// company's), what is found, the report written before the copy, the copy itself, and Undo to a made-up Recycle Bin.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sourceHomes, findGroups, summarize, planRun, writeReport, readReports, reportPaths, copyRun, checkCopies, undoRun, sha256 } from '../bring-in.mjs';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'docket-409-')));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const write = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const mk = (...p) => { const d = path.join(...p); fs.mkdirSync(d, { recursive: true }); return d; };
const lines = (...l) => l.map((x) => JSON.stringify(x)).join('\n') + '\n';
// A conversation file as Claude Code writes it: a first message in a working folder, a reply, maybe a name.
function session(home, dir, id, { cwd = 'C:\\Work\\app', text = 'Fix the login page', at = '2026-03-01T10:00:00Z', title, side } = {}) {
  const f = path.join(home, 'projects', dir, id + '.jsonl');
  write(f, lines({ type: 'user', cwd, timestamp: at, message: { role: 'user', content: text } },
    { type: 'assistant', timestamp: '2026-03-02T11:00:00Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } },
    ...(title ? [{ type: 'custom-title', customTitle: title }] : [])));
  if (side) write(path.join(home, 'projects', dir, id, 'tool-results', 'r1.txt'), side);
  return f;
}
// One made-up computer: a user folder with ~/.claude and an older ~/.claude-old, the company's new empty home, and
// another company's home.
function computer(name) {
  const root = mk(tmp, name), user = mk(root, 'Users', 'pat');
  const own = mk(user, '.claude', 'projects'), old = mk(user, '.claude-old', 'projects');
  const target = mk(root, 'Docket', 'Evan', 'claude-home');
  const acme = mk(root, 'Docket', 'Acme', 'claude-home', 'projects');
  return { root, user, own: path.dirname(own), old: path.dirname(old), target, acme: path.dirname(acme) };
}
const readAll = (dir) => { const out = {}; const go = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) go(p); else out[path.relative(dir, p)] = sha256(p); } }; go(dir); return out; };
// A Recycle Bin standing in for the real one: each path is moved into it, so nothing is lost and the test can look.
function bin(name) {
  const dir = mk(tmp, name, 'bin'); const got = [];
  return { got, trash: async (paths) => { for (const p of paths) { got.push(p); fs.renameSync(p, path.join(dir, got.length + '-' + path.basename(p))); } } };
}

test('sourceHomes: ~/.claude and other .claude folders, named ones; never this company\'s home or another company\'s', () => {
  const c = computer('homes');
  const named = mk(c.root, 'Old', 'claude-config', 'projects');
  const { homes, refused } = sourceHomes({ userHome: c.user, target: c.target, others: [{ name: 'Acme', home: c.acme }],
    extra: [path.dirname(named), path.join(c.acme, 'projects'), c.target, path.join(c.root, 'nothing-here'), c.own] });
  assert.deepEqual(homes.map((h) => h.home), [c.own, c.old, path.dirname(named)]);
  assert.match(refused.find((r) => r.home === c.acme).why, /Acme's Claude home/);
  assert.match(refused.find((r) => r.home === c.target).why, /own Claude home/);
  assert.match(refused.find((r) => r.home === path.join(c.root, 'nothing-here')).why, /no Claude Code projects folder/);
});

test('sourceHomes: ~/.claude is left out when another company runs on it, and so is a folder inside a company\'s home', () => {
  const c = computer('taken');
  const { homes, refused } = sourceHomes({ userHome: c.user, target: c.target, others: [{ name: 'Mine', home: c.own }], extra: [path.join(c.target, 'sub')] });
  assert.deepEqual(homes.map((h) => h.home), [c.old]);
  assert.ok(refused.some((r) => r.home === c.own && /Mine's/.test(r.why)));
});

test('summarize: the name it was given, else its summary, else the first typed message; folder and dates', () => {
  const c = computer('sum');
  const a = summarize(session(c.own, 'C--Work-app', 'a1', { title: 'Login work' }));
  assert.equal(a.title, 'Login work'); assert.equal(a.cwd, 'C:\\Work\\app');
  assert.equal(a.first, Date.parse('2026-03-01T10:00:00Z')); assert.equal(a.last, Date.parse('2026-03-02T11:00:00Z'));
  assert.equal(summarize(session(c.own, 'C--Work-app', 'a2')).title, 'Fix the login page');
  assert.equal(summarize(session(c.own, 'C--Work-app', 'a3', { text: '<command-name>/clear</command-name>' })).title, '(untitled)');
});

test('findGroups: one group per home and folder; already here is skipped, a session in two homes counted once', () => {
  const c = computer('find');
  session(c.own, 'C--Work-app', 's1', { side: 'result' }); session(c.own, 'C--Work-app', 's2');
  session(c.own, 'C--Work-site', 's3', { cwd: 'C:\\Work\\site' });
  session(c.old, 'C--Work-app', 's1'); session(c.old, 'C--Work-app', 's4');
  session(c.target, 'C--Work-app', 's2'); // already in the company's home
  write(path.join(c.own, 'projects', 'C--Work-app', '..evil.jsonl'), '{}\n'); // not a session id: never offered
  const { homes } = sourceHomes({ userHome: c.user, target: c.target });
  const g = findGroups({ homes, target: c.target });
  assert.deepEqual(g.map((x) => [x.home, x.dir, x.count]), [[c.own, 'C--Work-app', 1], [c.own, 'C--Work-site', 1], [c.old, 'C--Work-app', 1]]);
  const st = Object.fromEntries(g.flatMap((x) => x.sessions.map((s) => [`${x.home === c.own ? 'own' : 'old'}/${x.dir}/${s.id}`, s.status])));
  assert.deepEqual(st, { 'own/C--Work-app/s1': 'new', 'own/C--Work-app/s2': 'here', 'own/C--Work-site/s3': 'new', 'old/C--Work-app/s1': 'twice', 'old/C--Work-app/s4': 'new' });
  assert.equal(g[0].key, path.join(c.own, 'projects', 'C--Work-app'));
  assert.equal(g[0].cwd, 'C:\\Work\\app');
  assert.ok(g[0].bytes > fs.statSync(path.join(c.own, 'projects', 'C--Work-app', 's1.jsonl')).size, 'the side folder counts in the size');
});

test('the report is written before the copy; the copy keeps the folder name, takes the side folder, leaves the originals', async () => {
  const c = computer('copy');
  session(c.own, 'C--Work-app', 's1', { side: 'result one' }); session(c.own, 'C--Work-app', 's2'); session(c.own, 'C--Work-site', 's3');
  const before = readAll(c.own);
  const { homes } = sourceHomes({ userHome: c.user, target: c.target });
  const groups = findGroups({ homes, target: c.target });
  const run = planRun({ groups, picked: [groups[0].key], target: c.target, client: 'evan', id: 'r1', now: 1000 });
  assert.deepEqual(run.items.map((i) => i.id).sort(), ['s1', 's2']);
  const s1 = run.items.find((i) => i.id === 's1');
  assert.equal(s1.to, path.join(c.target, 'projects', 'C--Work-app', 's1.jsonl'));
  assert.equal(s1.toSide, path.join(c.target, 'projects', 'C--Work-app', 's1'));
  assert.equal(s1.files.length, 2); assert.match(s1.files[0].sha256, /^[0-9a-f]{64}$/);
  const dataDir = mk(tmp, 'copy', 'data');
  const p = writeReport(dataDir, run);
  // nothing copied yet, and the report holds every session with where it was and where it goes
  assert.ok(!fs.existsSync(path.join(c.target, 'projects', 'C--Work-app')));
  const saved = JSON.parse(fs.readFileSync(p.json, 'utf8'));
  assert.deepEqual(saved.items.map((i) => [i.id, i.status, i.from]).sort(), [['s1', 'planned', s1.from], ['s2', 'planned', run.items.find((i) => i.id === 's2').from]]);
  assert.ok(fs.readFileSync(p.html, 'utf8').includes(s1.from.replace(/&/g, '&amp;')));
  let saves = 0;
  await copyRun(run, { save: (r) => { saves++; writeReport(dataDir, r); } });
  assert.ok(saves >= 2);
  assert.deepEqual(run.items.map((i) => i.status), ['copied', 'copied']);
  assert.equal(fs.readFileSync(path.join(s1.toSide, 'tool-results', 'r1.txt'), 'utf8'), 'result one');
  assert.equal(sha256(s1.to), sha256(s1.from));
  assert.deepEqual(readAll(c.own), before, 'the originals are untouched');
  assert.deepEqual(readReports(dataDir, 'evan').map((r) => [r.id, r.items.map((i) => i.status)]), [['r1', ['copied', 'copied']]]);
  assert.deepEqual(readReports(dataDir, 'acme'), []);
  // a second run brings in nothing twice
  const again = findGroups({ homes, target: c.target });
  assert.equal(again[0].count, 0);
  assert.equal(planRun({ groups: again, picked: again.map((x) => x.key), target: c.target, client: 'evan' }).items.map((i) => i.id).join(), 's3');
});

test('the copy never writes over a file already in the company\'s home', async () => {
  const c = computer('there');
  session(c.own, 'C--Work-app', 's1');
  const { homes } = sourceHomes({ userHome: c.user, target: c.target });
  const groups = findGroups({ homes, target: c.target });
  const run = planRun({ groups, picked: [groups[0].key], target: c.target, client: 'evan' });
  write(run.items[0].to, 'mine'); // appeared between the pick and the copy
  await copyRun(run);
  assert.equal(run.items[0].status, 'there');
  assert.equal(fs.readFileSync(run.items[0].to, 'utf8'), 'mine');
  assert.deepEqual(checkCopies(run).map((x) => x.state), ['none']);
});

test('Undo sends only unchanged copies to the Recycle Bin, a changed one only when ticked, and never an original', async () => {
  const c = computer('undo');
  session(c.own, 'C--Work-app', 's1', { side: 'r' }); session(c.own, 'C--Work-app', 's2'); session(c.own, 'C--Work-app', 's3');
  const before = readAll(c.own);
  const { homes } = sourceHomes({ userHome: c.user, target: c.target });
  const groups = findGroups({ homes, target: c.target });
  const run = planRun({ groups, picked: [groups[0].key], target: c.target, client: 'evan', id: 'u1' });
  await copyRun(run);
  const by = (id) => run.items.find((i) => i.id === id);
  fs.appendFileSync(by('s2').to, lines({ type: 'user', message: { content: 'one more thing' } })); // continued since the copy
  write(path.join(c.target, 'projects', 'C--Work-app', 's3', 'tool-results', 'new.txt'), 'x'); // a file added to its side folder
  assert.deepEqual(Object.fromEntries(checkCopies(run).map((x) => [x.id, x.state])), { s1: 'same', s2: 'changed', s3: 'changed' });
  const b = bin('undo');
  let r = await undoRun(run, { trash: b.trash });
  assert.deepEqual(r.done, ['s1']);
  assert.deepEqual(r.skipped.map((x) => [x.id, x.why]).sort(), [['s2', 'changed'], ['s3', 'changed']]);
  assert.deepEqual(b.got, [by('s1').to, by('s1').toSide]);
  assert.ok(fs.existsSync(by('s2').to) && !fs.existsSync(by('s1').to));
  assert.equal(by('s1').status, 'undone'); assert.equal(run.undoneAt, undefined);
  // a session open in Docket now is held back even when ticked
  r = await undoRun(run, { trash: b.trash, force: ['s2', 's3'], keep: (id) => id === 's3' });
  assert.deepEqual(r.done, ['s2']); assert.deepEqual(r.skipped.map((x) => [x.id, x.why]), [['s3', 'open']]);
  r = await undoRun(run, { trash: b.trash, force: ['s3'] });
  assert.deepEqual(r.done, ['s3']);
  assert.ok(run.undoneAt > 0);
  assert.ok(!fs.existsSync(path.join(c.target, 'projects', 'C--Work-app')), 'the empty folder the run made goes too');
  assert.deepEqual(readAll(c.own), before, 'the originals are untouched');
  // an unchanged copy the person unticked stays (keep gives why)
  const run2 = planRun({ groups: findGroups({ homes, target: c.target }), picked: [groups[0].key], target: c.target, client: 'evan', id: 'u2' });
  await copyRun(run2);
  r = await undoRun(run2, { trash: b.trash, keep: (id) => id === 's1' && 'kept' });
  assert.deepEqual(r.done.sort(), ['s2', 's3']); assert.deepEqual(r.skipped.map((x) => [x.id, x.why]), [['s1', 'kept']]);
  assert.ok(fs.existsSync(run2.items.find((i) => i.id === 's1').to) && run2.undoneAt === undefined);
  // undone already: a second Undo does nothing
  assert.deepEqual((await undoRun(run, { trash: b.trash })).done, []);
});

test('Undo refuses a path outside the company\'s projects folder or one that is an original, whatever the report says', async () => {
  const c = computer('guard');
  const orig = session(c.own, 'C--Work-app', 's1');
  const { homes } = sourceHomes({ userHome: c.user, target: c.target });
  const groups = findGroups({ homes, target: c.target });
  const run = planRun({ groups, picked: [groups[0].key], target: c.target, client: 'evan' });
  await copyRun(run);
  // a report edited (or gone wrong) to point the copy at the original
  run.items[0].to = orig; run.items[0].files[0].to = orig; run.items[0].files[0].sha256 = sha256(orig);
  const b = bin('guard');
  const r = await undoRun(run, { trash: b.trash });
  assert.deepEqual(r.skipped.map((x) => x.why), ['outside']);
  assert.deepEqual(b.got, []);
  assert.ok(fs.existsSync(orig));
});

test('reportPaths: one report per company and run in the data folder', () => {
  assert.deepEqual(reportPaths(path.join('D', 'data'), { client: 'evan', id: 'abc' }),
    { json: path.join('D', 'data', 'bring-in', 'evan-abc.json'), html: path.join('D', 'data', 'bring-in', 'evan-abc.html') });
});
