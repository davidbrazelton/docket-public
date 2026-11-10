// Switching a desk's plan system (#700): plan-switch.mjs finds what the desk plans with (another system's marker files,
// the plan files they name, its plan hooks, Docket's own plans), says whether a switch leaves something behind, and
// writes the brief for the session that converts. The desk's files are made per test in a temporary folder and never
// changed by the scan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { markerPatterns, hookCommands, planHooks, scanPlanSystem, switchWarning, conversionBrief } from '../plan-switch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(here, '..', 'server.mjs'), 'utf8');

// A desk like the user's: a Claude home with .acme-plan-* markers and the Acme hooks, and a notes folder of plans.
function batonDesk() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-planswitch-'));
  const home = path.join(root, 'home'), notes = path.join(root, 'notes'), tools = path.join(root, 'acme-tooling', 'hooks');
  fs.mkdirSync(home); fs.mkdirSync(notes); fs.mkdirSync(tools, { recursive: true });
  fs.writeFileSync(path.join(notes, 'TICK-1-plan.md'), '# TICK-1 index\n\n- [ ] Build it — [TICK-2-plan.md](TICK-2-plan.md)\n- [x] Look first\n');
  fs.writeFileSync(path.join(notes, 'TICK-2-plan.md'), '# TICK-2\n\n- [ ] One\n- [ ] Two\n- [x] Three\n');
  fs.writeFileSync(path.join(notes, 'OLD-plan.md'), '# Old\n\n- [x] All done\n');
  fs.writeFileSync(path.join(home, '.acme-plan-8ad80cd72d86'), `state=claimed\nplan=${path.join(notes, 'TICK-2-plan.md')}\n`);
  fs.writeFileSync(path.join(home, '.acme-plan-97f8364aa3cb'), `state=claimed\nplan=${path.join(notes, 'TICK-2-plan.md')}\n`);
  fs.writeFileSync(path.join(home, '.acme-plan-5d395958aaaa'), `state=claimed\nplan=${path.join(notes, 'TICK-1-plan.md')}\n`);
  fs.writeFileSync(path.join(home, '.acme-plan-0000aaaa1111'), 'state=none\n');
  fs.writeFileSync(path.join(home, '.acme-plan-1111bbbb2222'), `state=claimed\nplan=${path.join(notes, 'OLD-plan.md')}\n`);
  const cmd = (f) => `powershell -NoProfile -File "${path.join(tools, f)}"`;
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: cmd('plan-brief.sessionstart-hook.ps1') }, { type: 'command', command: 'powershell -File "C:\\scripts\\Record-SessionProfile.ps1"' }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: cmd('ship-gate.pretooluse-hook.ps1') }] }, { matcher: 'Bash', hooks: [{ type: 'command', command: cmd('ship-gate.pretooluse-hook.ps1') }] }],
  } }, null, 2));
  return { root, home, notes };
}
const snapshot = (dir) => fs.readdirSync(dir, { recursive: true }).sort().map((f) => { const p = path.join(dir, f); const s = fs.statSync(p); return s.isFile() ? `${f}|${s.mtimeMs}|${fs.readFileSync(p, 'utf8')}` : f; });

test('marker patterns: dot names ending in plan- and the start of a session id, grouped', () => {
  assert.deepEqual(markerPatterns(['.acme-plan-8ad80cd72d86', '.acme-plan-97f8364aa3cb', '.baton-plan-123456', 'settings.json', '.acme-gate-abcdef12', 'plan-notes.md']),
    [{ pattern: '.acme-plan-*', count: 2 }, { pattern: '.baton-plan-*', count: 1 }]);
});

test('hooks: every command in settings.json, and the plan ones with the hooks shipped beside them', () => {
  assert.deepEqual(hookCommands('not json'), []);
  const all = hookCommands(JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ command: 'x\\plan-brief.ps1' }] }], Stop: [{ matcher: '', hooks: [{ command: 'echo hi' }] }] } }));
  assert.equal(all.length, 2);
  const { home } = batonDesk();
  const found = planHooks(hookCommands(fs.readFileSync(path.join(home, 'settings.json'), 'utf8')));
  assert.deepEqual(found.map((h) => [h.event, h.plan]), [['SessionStart', true], ['PreToolUse', false]], 'the plan brief, and the gate from the same folder once; not the unrelated profile hook');
});

test('scan: claims, the plan files they name with what is left, hooks, and who is working; nothing changed', () => {
  const { root, home, notes } = batonDesk();
  const before = snapshot(root);
  const f = scanPlanSystem({ home, planSystem: 'none' }, { sessions: [{ id: '8ad80cd7-2d86-4000-8000-000000000001', title: 'F1 fix', working: true }, { id: 'ffff0000-1', title: 'Other', working: false }] });
  assert.deepEqual(before, snapshot(root), 'the scan only reads');
  assert.equal(f.claims.length, 4, 'the state=none marker holds no claim');
  assert.deepEqual(f.markers.map((m) => [m.pattern, m.count, m.claims]), [['.acme-plan-*', 5, 4]]);
  const t2 = f.plans.find((p) => p.file === path.join(notes, 'TICK-2-plan.md'));
  assert.deepEqual([t2.open, t2.done, t2.claims, t2.working], [2, 1, 2, 1]);
  assert.equal(f.plans[0], t2, 'the plan a working session holds comes first');
  assert.equal(f.claims.find((c) => c.session === '8ad80cd72d86')?.title, 'F1 fix', 'a session is matched on the start of its id, dashes left out as markers write it');
  assert.equal(f.hooks.length, 2);
  assert.deepEqual(f.working.map((s) => s.title), ['F1 fix']);
});

test('scan: a fresh Claude home finds nothing, and a desk\'s own marker pattern is used', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-planswitch-'));
  const f = scanPlanSystem({ home: path.join(root, 'not-made-yet') });
  assert.deepEqual([f.claims, f.plans, f.hooks, f.markers], [[], [], [], []]);
  fs.writeFileSync(path.join(root, 'claims-abcd1234.txt'), 'plan=a.md\n');
  fs.writeFileSync(path.join(root, 'a.md'), '- [ ] a\n');
  const g = scanPlanSystem({ home: root, planFolder: { path: root, marker: 'claims-*.txt' } });
  assert.equal(g.claims.length, 1);
  assert.equal(g.plans[0].file, path.join(root, 'a.md'));
});

test('warning: onto Docket\'s plans warns only when another system is there', () => {
  const { home } = batonDesk();
  const f = scanPlanSystem({ home });
  for (const from of ['none', 'folder', '']) {
    const w = switchWarning(f, from, 'docket');
    assert.equal(w.warn, true, from);
    assert.equal(w.way, 'in');
    assert.match(w.lines.join('\n'), /3 plan files.*2 with open tasks/);
    assert.match(w.lines.join('\n'), /4 claims in marker files \(\.acme-plan-\*\)/);
    assert.match(w.lines.join('\n'), /2 Claude Code hooks.*SessionStart.*Docket does not change them/);
  }
  const empty = scanPlanSystem({ home: fs.mkdtempSync(path.join(os.tmpdir(), 'docket-planswitch-')) });
  assert.equal(switchWarning(empty, 'none', 'docket').warn, false, 'nothing found: no extra step');
  assert.equal(switchWarning(f, 'docket', 'docket').warn, false, 'no change');
  assert.equal(switchWarning(f, 'none', 'folder').warn, false, 'between two systems that are not Docket\'s: nothing to carry');
});

test('warning: off Docket\'s plans warns when the desk has Docket plans', () => {
  const f = { plans: [], claims: [], hooks: [], markers: [], working: [{ id: 'a', title: 'A' }], docketPlans: [{ id: 'p-1', title: 'One', done: 1, total: 3 }, { id: 'p-2', title: 'Two', done: 2, total: 2 }] };
  const w = switchWarning(f, 'docket', 'folder');
  assert.equal(w.way, 'out');
  assert.match(w.lines[0], /2 Docket plans, 1 not finished/);
  assert.match(w.lines[1], /1 session working now/);
  assert.equal(switchWarning(f, '', 'none').warn, true, 'a desk that never chose has Docket\'s plans on');
  assert.equal(switchWarning({ ...f, docketPlans: [] }, 'docket', 'none').warn, false);
});

test('brief: lists what was found, what to make, and leaves the old files alone', () => {
  const { home, notes } = batonDesk();
  const f = scanPlanSystem({ home }, { sessions: [{ id: '8ad80cd7-2d86', title: 'F1 fix', working: true }] });
  const b = conversionBrief({ desk: 'Acme', from: 'none', to: 'docket', found: f });
  assert.ok(b.includes(path.join(notes, 'TICK-2-plan.md')) && b.includes(path.join(notes, 'TICK-1-plan.md')), 'every plan file');
  assert.match(b, /\.acme-plan-8ad80cd72d86 → .*TICK-2-plan\.md \(session 8ad80cd7-2d86 "F1 fix", working now\)/);
  assert.match(b, /plan-brief\.sessionstart-hook\.ps1/);
  assert.match(b, /mcp__portal__plan_create/);
  assert.match(b, /Do not change, move, rename or delete any of the old files/);
  assert.match(b, /Finish the switch/);
  const out = conversionBrief({ desk: 'Acme', from: 'docket', to: 'folder', found: { ...f, docketPlans: [{ id: 'p-1', title: 'One', file: 'x.md', done: 1, total: 3 }] }, convertTo: 'C:\\notes' });
  assert.match(out, /p-1 "One": 1 of 3 done/);
  assert.match(out, /markdown checklist.*in C:\\notes/);
});

test('a switch waiting on its conversion shows its own card first, with Finish and Cancel', () => {
  const fn = page.slice(page.indexOf('function showPlanOffer'), page.indexOf("$('planOffer').onclick"));
  const el = { hidden: true, dataset: {}, innerHTML: '' };
  const names = { docket: "Docket's plans", none: 'no plans' };
  new Function('$', 'S', 'esc', 'tip', 'PLAN_NAMES', fn + '\nshowPlanOffer();')(() => el, { client: 'a', clients: [{ id: 'a', name: 'Acme', planSystem: '' }, { id: 'b', name: 'Beta', planSystem: 'none', planSwitch: { to: 'docket', from: 'none', session: 's1' } }] }, String, () => '', names);
  assert.equal(el.hidden, false);
  assert.equal(el.dataset.client, 'b', 'before the once-shown card of the desk on view');
  assert.match(el.innerHTML, /Switching Beta to Docket's plans/);
  assert.match(el.innerHTML, /stays on no plans until you finish the switch/);
  assert.match(el.innerHTML, /data-ps="finish"/);
  assert.match(el.innerHTML, /data-ps="cancel"/);
});

test('the page warns before every plan system switch, and the server holds the switch until Finish', () => {
  assert.match(page, /if \(it\.toggle\.kind === 'plans'\) \{[^\n]*\n\s*if \(await switchPlans\(id, box\.value\) === null\)/, 'the Inspector Switches');
  assert.match(page, /if \(await switchPlans\(id, b\.dataset\.plan\) === null\)/, 'the once-shown card');
  assert.match(page, /api\('\/api\/plan-switch-check'/, 'the setup wizard');
  assert.match(page, /data-ps="finish"/);
  assert.match(server, /savePlanSystem\(client, \{ planSwitch: \{ to, from, session: s\.id/, 'convert saves the switch as waiting, not done');
  assert.match(server, /action === 'finish' \? \{ planSystem: ps\.to, planSwitch: undefined \}/);
  assert.match(server, /plansOnIn\(clientById\(parent\.client\), parent\.id\) \? planToolDefs\(parent\)/, 'the conversion session gets the plan tools');
});

// A desk with two projects: Ripple (a claimed plan, a sub-plan it links to, a QA plan in testing/ that nobody claims or
// links, and claims on sub-plans since deleted) and Other (one claimed plan).
function twoProjects() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-planswitch-'));
  const home = path.join(root, 'home'), rip = path.join(root, 'Projects', 'RIP-893'), other = path.join(root, 'Projects', 'OTHER-1');
  for (const d of [home, path.join(rip, 'testing'), path.join(rip, 'node_modules'), other]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(rip, 'RIP-893-plan.md'), '# Ripple\n\n- [ ] Code — see [deploy](RIP-893-deploy-plan.md)\n- [ ] Review, [facts](RIP-893-facts.md)\n- [x] Look\n');
  fs.writeFileSync(path.join(rip, 'RIP-893-facts.md'), '# Facts, not a plan\n\n- [x] checked one\n- [ ] a note\n');
  fs.writeFileSync(path.join(rip, 'RIP-893-deploy-plan.md'), '# Deploy\n\n- [ ] DEV\n- [ ] PROD\n');
  fs.writeFileSync(path.join(rip, 'testing', 'RIP-893-qa-test-plan.md'), '# QA\n\n- [ ] Setup\n- [ ] Run\n- [ ] Report\n');
  fs.writeFileSync(path.join(rip, 'testing', 'notes-plan.md'), '# No checklist here\n\nJust words.\n');
  fs.writeFileSync(path.join(rip, 'node_modules', 'x-plan.md'), '- [ ] not ours\n');
  fs.writeFileSync(path.join(other, 'OTHER-1-plan.md'), '# Other\n\n- [ ] One\n');
  const claim = (id, f) => fs.writeFileSync(path.join(home, `.acme-plan-${id}`), `state=claimed\nplan=${f}\n`);
  claim('aaaa00000001', path.join(rip, 'RIP-893-plan.md'));
  claim('aaaa00000002', path.join(rip, 'RIP-893-sub-a.md')); // deleted since
  claim('aaaa00000003', path.join(rip, 'RIP-893-sub-a.md'));
  claim('aaaa00000004', path.join(rip, 'RIP-893-sub-b.md'));
  claim('bbbb00000001', path.join(other, 'OTHER-1-plan.md'));
  const cmd = (f) => `powershell -NoProfile -File "${path.join(root, 'tools', f)}"`;
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ hooks: {
    SessionStart: [{ hooks: [{ command: cmd('plan-brief.ps1') }] }],
    PreToolUse: [{ matcher: 'Write|Edit', hooks: [{ command: cmd('tree-gate.ps1') }] }, { matcher: 'Bash', hooks: [{ command: cmd('ship-gate.ps1') }] }],
  } }));
  return { root, home, rip, other };
}

test('scan: claims on files that are gone are missing, and unclaimed plans are found by link and beside the others', () => {
  const { root, home, rip, other } = twoProjects();
  const before = snapshot(root);
  const f = scanPlanSystem({ home });
  assert.deepEqual(before, snapshot(root), 'the scan only reads');
  const files = f.plans.map((p) => path.relative(root, p.file)).sort();
  assert.deepEqual(files, [path.join('Projects', 'OTHER-1', 'OTHER-1-plan.md'), path.join('Projects', 'RIP-893', 'RIP-893-deploy-plan.md'), path.join('Projects', 'RIP-893', 'RIP-893-plan.md'), path.join('Projects', 'RIP-893', 'testing', 'RIP-893-qa-test-plan.md')],
    'the linked sub-plan and the QA plan in testing/; not a linked facts file, a plan-named file with no checklist, or one in node_modules');
  assert.equal(f.plans.find((p) => p.file.endsWith('RIP-893-deploy-plan.md')).found, 'linked');
  assert.equal(f.plans.find((p) => p.file.endsWith('RIP-893-qa-test-plan.md')).found, 'folder');
  assert.deepEqual(f.missing.map((m) => [path.basename(m.file), m.claims]), [['RIP-893-sub-a.md', 2], ['RIP-893-sub-b.md', 1]]);
  assert.equal(f.claims.length, 5);
  assert.equal(f.claims.filter((c) => c.missing).length, 3);
  assert.deepEqual(f.projects.map((p) => [p.name, p.files, p.open, p.missing]), [['RIP-893', 3, 7, 2], ['OTHER-1', 1, 1, 0]], 'the testing folder counts with its project');
  assert.equal(f.projects[0].folder, rip);
  assert.equal(f.projects[1].folder, other);
});

test('scan with a scope: only the plans, claims and missing files in that folder, and every project still listed', () => {
  const { home, rip } = twoProjects();
  const f = scanPlanSystem({ home }, { scope: rip });
  assert.equal(f.scope, rip);
  assert.ok(f.plans.every((p) => p.file.startsWith(rip)) && f.plans.length === 3);
  assert.equal(f.claims.length, 4, 'not the claim on the other project');
  assert.deepEqual(f.markers.map((m) => m.claims), [4]);
  assert.equal(f.missing.length, 2);
  assert.equal(f.projects.length, 2, 'the page can still offer the other project');
  const qa = scanPlanSystem({ home }, { scope: path.join(rip, 'testing') });
  assert.deepEqual(qa.plans.map((p) => path.basename(p.file)), ['RIP-893-qa-test-plan.md'], 'a folder nobody claims anything in is searched itself');
});

test('warning: missing claims are counted as missing, and each hook event says how many run there', () => {
  const { home, rip } = twoProjects();
  const w = switchWarning(scanPlanSystem({ home }), 'none', 'docket').lines.join('\n');
  assert.match(w, /4 plan files another system keeps, 4 with open tasks \(8 open in all\)/);
  assert.match(w, /5 claims in marker files \(\.acme-plan-\*\); 3 of them name 2 files that no longer exist\./);
  assert.match(w, /3 Claude Code hooks of that system \(1 at SessionStart, 2 at PreToolUse\)/);
  const one = switchWarning(scanPlanSystem({ home }, { scope: rip }), 'none', 'docket').lines;
  assert.equal(one[0], `Only the plans in ${rip}.`);
  assert.match(one.join('\n'), /3 plan files/);
});

test('brief: a scoped conversion says so, lists every claim, and the missing files apart', () => {
  const { home, rip, other } = twoProjects();
  const b = conversionBrief({ desk: 'Acme', from: 'none', to: 'docket', found: scanPlanSystem({ home }, { scope: rip }) });
  assert.ok(b.includes(`convert one project now: only the plans in ${rip}.`));
  assert.match(b, /do not convert them/);
  assert.ok(!b.includes(other), 'nothing from the other project');
  assert.match(b, /RIP-893-qa-test-plan\.md — "QA": 3 open, 0 done; no claim and no link/);
  assert.match(b, /RIP-893-deploy-plan\.md — "Deploy": 2 open, 0 done; no claim, a plan above links to it/);
  assert.match(b, /Claims on files that no longer exist \(3 claims, 2 files\)/);
  assert.match(b, /RIP-893-sub-a\.md: 2 claims/);
  assert.ok(!/\.acme-plan-aaaa00000002 →/.test(b), 'a claim on a gone file is not listed as a claim');
  assert.match(b, /other projects were not converted/);
  const whole = conversionBrief({ desk: 'Acme', from: 'none', to: 'docket', found: scanPlanSystem({ home }) });
  assert.ok(whole.includes(other) && !/convert one project now/.test(whole), 'the whole desk is still one Convert');
  // A desk with many claims gets them all, not the first 60.
  for (let i = 0; i < 120; i++) fs.writeFileSync(path.join(home, `.acme-plan-cccc${String(i).padStart(8, '0')}`), `state=claimed\nplan=${path.join(rip, 'RIP-893-plan.md')}\n`);
  const many = conversionBrief({ desk: 'Acme', from: 'none', to: 'docket', found: scanPlanSystem({ home }) });
  assert.equal((many.match(/^- \.acme-plan-\w+ → /gm) || []).length, 122);
  assert.ok(!/more, not listed here/.test(many));
});

test('convert takes a scope, and the Plan panel shows the plans being made before Finish', () => {
  assert.match(server, /async function planSwitchAction\(client, \{ to = '', action = '', scope = '' \} = \{\}\)/);
  assert.match(server, /const found = await planSwitchFound\(client, only\);/);
  assert.match(server, /scope = switchScope\(url\.searchParams\.get\('scope'\)\)/);
  assert.match(server, /const plansShown = \(client\) => plansOn\(client\) \|\| \(!!client\?\.planSwitch && plansOnFor\(client\.planSwitch\.to\)\);/);
  assert.match(server, /function plansSummary\(client\) \{\r?\n\s*if \(!plansShown\(client\)\)/);
  assert.match(page, /<select id="psScope"/);
  assert.match(page, /\{ to, action, \.\.\.\(action === 'convert' && scope \? \{ scope \} : \{\}\) \}/);
});
