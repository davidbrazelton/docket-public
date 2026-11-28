// The Desk check (#619): the setup problems it finds in two real layouts, made up here in a temp folder,
// and that it writes nothing. And (#1241) the skills and plugins whose text names a write into .claude.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deskCheck, deskCheckText, claudeSetup, claudeWriters, toolStateHome } from '../desk-check.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-619-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const at = (rel) => path.join(tmp, rel);
const put = (rel, text = '') => { fs.mkdirSync(path.dirname(at(rel)), { recursive: true }); fs.writeFileSync(at(rel), text); };
const repo = (rel) => fs.mkdirSync(at(rel + '/.git'), { recursive: true });
// Every file under a folder with its size and time, to show the check changed nothing.
const snapshot = (dir) => {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else { const st = fs.statSync(f); out.push(`${f} ${st.size} ${st.mtimeMs}`); } } };
  walk(dir);
  return out.sort().join('\n');
};
const keys = (r) => r.findings.map((f) => f.key).sort();

// V:\claudeBrain: no Claude rules, the Claude home inside it, the repos in V:\Repos\Acme, and most sessions run there.
fs.mkdirSync(at('claudeBrain/notes'), { recursive: true });
put('claudeBrain/notes/todo.md', 'x');
put('claudeBrain/claude-home/.claude.json', '{}');
put('claudeBrain/claude-home/projects/V--claudeBrain/a.jsonl');
repo('Repos/Acme/Payments');
repo('Repos/Acme/Shared');
const brain = { id: 'brain', name: 'Brain', folder: at('claudeBrain'), home: at('claudeBrain/claude-home') };
const brainSessions = [
  ...Array.from({ length: 6 }, (_, i) => ({ id: 'm' + i, cwd: at('Repos/Acme/Payments'), lastModified: 100 - i })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: 't' + i, cwd: at('claudeBrain'), lastModified: 90 - i })),
];

test('a bare working folder with its Claude home inside and its work elsewhere', () => {
  const before = snapshot(tmp);
  const r = deskCheck({ desk: brain, sessions: brainSessions });
  assert.deepEqual(keys(r), ['home-inside', 'no-setup', 'work-elsewhere']);
  const f = Object.fromEntries(r.findings.map((x) => [x.key, x]));
  assert.match(f['work-elsewhere'].means, /6 of the last 10 sessions ran outside/);
  assert.match(f['work-elsewhere'].means, /Payments/);
  for (const x of r.findings) assert.ok(x.means && x.fix, x.key);
  const fact = Object.fromEntries(r.facts.map((x) => [x.label, x.text]));
  assert.match(fact['Working folder'], /plain folder, not a git repo/);
  assert.match(fact['Claude setup there'], /^none/);
  assert.match(fact['Claude home'], /inside the working folder/);
  assert.match(deskCheckText(r), /3 to fix/);
  assert.equal(snapshot(tmp), before, 'the check wrote nothing');
});

// A folder like V:/Work: company rules in CLAUDE.md, .claude settings and skills, repos elsewhere, sessions mostly elsewhere.
put('Work/CLAUDE.md', '# Acme rules');
put('Work/.claude/settings.json', '{}');
put('Work/.claude/skills/ship/SKILL.md', 'x');
fs.mkdirSync(at('Work/Projects'), { recursive: true });
put('home-acme/.claude.json', '{}');

test('a working folder with its own Claude rules has no folder problems', () => {
  const desk = { id: 'acme', name: 'Acme', folder: at('Work'), home: at('home-acme') };
  const sessions = Array.from({ length: 10 }, (_, i) => ({ id: 's' + i, cwd: at('Repos/Acme/Payments'), lastModified: i }));
  const r = deskCheck({ desk, sessions });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(claudeSetup(at('Work')), ['CLAUDE.md', '.claude/settings.json', '.claude/skills']);
  assert.match(deskCheckText(r), /nothing to fix/);
});

test('a missing working folder or Claude home is reported, with a fix', () => {
  const r = deskCheck({ desk: { id: 'x', name: 'X', folder: at('gone'), home: at('gone-home') } });
  assert.deepEqual(keys(r), ['folder-missing', 'home-missing']);
  assert.deepEqual(keys(deskCheck({ desk: { id: 'y', name: 'Y', folder: '', home: at('home-acme') } })), ['no-folder']);
});

test('a working folder that is a repo is not reported for having no Claude setup', () => {
  const r = deskCheck({ desk: { id: 'z', name: 'Z', folder: at('Repos/Acme/Payments'), home: at('home-acme') } });
  assert.deepEqual(r.findings, []);
  assert.match(r.facts[0].text, /a git repo$/);
});

test('a group with no start folder whose sessions keep running in one folder gets a Set as start folder fix', () => {
  const billing = at('Repos/Acme/Shared');
  const sessions = [
    ...Array.from({ length: 4 }, (_, i) => ({ id: 'b' + i, cwd: billing, lastModified: 50 - i, groupId: 'g_bill' })),
    { id: 'b4', cwd: at('claudeBrain'), lastModified: 40, groupId: 'g_bill' },
    ...Array.from({ length: 5 }, (_, i) => ({ id: 'h' + i, cwd: at('claudeBrain'), lastModified: 30 - i, groupId: 'g_home' })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: 's' + i, cwd: billing, lastModified: 20 - i, groupId: 'g_set' })),
  ];
  const groups = [{ id: 'g_bill', name: 'Billing', folder: '' }, { id: 'g_home', name: 'Notes', folder: '' }, { id: 'g_set', name: 'Set', folder: billing }];
  const r = deskCheck({ desk: { ...brain, home: at('home-acme') }, sessions, groups });
  const g = r.findings.filter((f) => f.key === 'group-folder');
  assert.equal(g.length, 1, 'only Billing: Notes runs in the working folder, and Set has its start folder');
  assert.equal(g[0].title, 'Group "Billing" has no start folder');
  assert.match(g[0].means, /^4 of its last 5 sessions ran in .*Shared/);
  assert.deepEqual(g[0].action, { kind: 'group-folder', group: 'g_bill', folder: path.resolve(billing), label: 'Set as start folder' });
});

// #1241: a desk whose skills, commands and plugins keep their state in .claude, beside ones that only read from it.
const wHome = at('writers/claude-home'), wFolder = at('writers/work');
put('writers/claude-home/skills/site-signin/SKILL.md', '---\nname: site-signin\n---\nSign in once.\n');
put('writers/claude-home/skills/site-signin/save.ps1', '$c | Set-Content "$env:USERPROFILE\\.claude\\site-cookie.txt"\n');
put('writers/claude-home/skills/reader/SKILL.md', 'Read the rules from ~/.claude/CLAUDE.md and summarize them.\n');
put('writers/claude-home/skills/careful/SKILL.md', 'Never write tokens into ~/.claude; keep them in %LOCALAPPDATA%\\careful.\n');
put('writers/claude-home/commands/mark.md', 'Write a marker file to .claude/markers/done.txt when finished.\n');
put('writers/claude-home/skills/manifest/SKILL.md', 'Save the plugin manifest in .claude-plugin/plugin.json.\n');
put('writers/work/.claude/agents/cacher.md', 'Cache the results under CLAUDE_CONFIG_DIR/cache.\n');
put('writers/work/.claude/settings.json', '{}');
put('writers/plugins/acme/1.0/skills/sync/SKILL.md', 'Store the token in `' + wHome.replace(/\\/g, '/') + '/acme-token`.\n');
put('writers/plugins/acme/1.0/hooks/on.ps1', 'Set-Content ~/.claude/acme.log x\n'); // a hook: a program, not a tool call
put('writers/plugins/clean/1.0/skills/look/SKILL.md', 'Look at things.\n');
put('writers/plugins/clean/1.0/hooks/on.ps1', 'Set-Content ~/.claude/clean.log x\n');
put('writers/claude-home/plugins/installed_plugins.json', JSON.stringify({ version: 2, plugins: {
  'acme@market': [{ installPath: at('writers/plugins/acme/1.0') }], 'clean@market': [{ installPath: at('writers/plugins/clean/1.0') }] } }));

test('skills, commands, agents and plugins that write into .claude are flagged; ones that only read are not', async () => {
  const before = snapshot(tmp);
  const scan = await claudeWriters(wHome, wFolder), { checked, writers } = scan;
  assert.equal(checked, 8);
  assert.deepEqual(writers.map((w) => `${w.kind} ${w.name}`).sort(), ['agent cacher', 'command mark', 'plugin acme@market', 'skill site-signin']);
  assert.match(writers.find((w) => w.name === 'site-signin').file, /save\.ps1$/);
  assert.match(writers.find((w) => w.name === 'acme@market').line, /Store the token/);
  const r = deskCheck({ desk: { id: 'w', name: 'W', folder: wFolder, home: wHome }, writers: scan, platform: 'win32' });
  const f = r.findings.find((x) => x.key === 'claude-writers');
  assert.equal(f.title, '4 skills or plugins write into .claude');
  assert.match(f.means, /protected-path write/);
  assert.match(f.means, /skill site-signin \(the Claude home\)/);
  assert.ok(f.fix.includes('%LOCALAPPDATA%\\<tool>\\'));
  assert.match(r.facts.find((x) => x.label === 'Writes into .claude').text, /^8 .*; 4 name a write there$/);
  assert.equal(snapshot(tmp), before, 'the check wrote nothing');
  assert.equal(toolStateHome('darwin'), '~/Library/Application Support/<tool>/');
});

test('a desk whose tools only read from .claude has no .claude finding', async () => {
  const r = deskCheck({ desk: { id: 'acme', name: 'Acme', folder: at('Work'), home: at('home-acme') }, writers: await claudeWriters(at('home-acme'), at('Work')) });
  assert.ok(!keys(r).includes('claude-writers'));
  assert.match(r.facts.find((x) => x.label === 'Writes into .claude').text, /none names a write there/);
});
