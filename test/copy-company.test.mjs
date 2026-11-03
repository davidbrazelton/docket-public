// Copying a desk as a new desk, tried on made-up homes in a temporary folder: what the plan says, what the
// copy makes, and that the original is left exactly as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyPlan, runCopy, rewritePaths, namesHome, outsidePaths, tomlWithout, copyGroups, groupAction, copyEntry, needsSignIn, targetProblem, defaultChoices, COPY_ITEMS } from '../copy-company.mjs';

const win = process.platform === 'win32';
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const read = (file) => fs.readFileSync(file, 'utf8');
// Every file under dir with its bytes, to show the original is unchanged.
const snapshot = (dir) => {
  const out = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = fs.readFileSync(p).toString('base64'); } };
  walk(dir);
  return out;
};

// A made-up desk: a set Claude home, a Grok home and a Codex home, with a bit of everything in each.
function makeDesk() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-396-'));
  const src = { claude: path.join(base, 'Old', 'claude-home'), grok: path.join(base, 'Old', 'grok-home'), codex: path.join(base, 'Old', 'codex-home') };
  const dst = { claude: path.join(base, 'New', 'claude-home'), grok: path.join(base, 'New', 'grok-home'), codex: path.join(base, 'New', 'codex-home') };
  const tools = path.join(base, 'Tools'), market = path.join(base, 'Market');
  const j = (v) => JSON.stringify(v, null, 2);
  put(path.join(src.claude, 'CLAUDE.md'), `# Rules\nSkills live in ${src.claude}${path.sep}skills.\n`);
  put(path.join(src.claude, 'settings.json'), j({
    model: 'opus',
    env: { CLAUDE_CODE_USE_BEDROCK: '1', AWS_PROFILE: 'old-profile', AWS_REGION: 'us-east-1', BATON_NOTES_ROOT: path.join(src.claude, 'notes') },
    awsAuthRefresh: 'aws sso login --profile old-profile',
    hooks: { Stop: [{ hooks: [{ type: 'command', command: `node "${path.join(src.claude, 'hooks', 'stop.mjs')}"` }, { type: 'command', command: `pwsh -File "${path.join(tools, 'audit.ps1')}"` }] }] },
    enabledPlugins: { 'tidy@local': true },
  }));
  put(path.join(src.claude, 'hooks', 'stop.mjs'), `// reads ${src.claude.replace(/\\/g, '/')}/notes\n`);
  put(path.join(src.claude, 'skills', 'review', 'SKILL.md'), '---\nname: review\n---\nReview it.\n');
  put(path.join(src.claude, 'plugins', 'known_marketplaces.json'), j({ local: { source: { source: 'directory', path: market }, installLocation: market } }));
  put(path.join(src.claude, 'plugins', 'installed_plugins.json'), j({ plugins: { 'tidy@local': [{ installPath: path.join(src.claude, 'plugins', 'cache', 'local', 'tidy') }] } }));
  put(path.join(src.claude, 'plugins', 'cache', 'local', 'tidy', 'plugin.json'), '{"name":"tidy"}');
  put(path.join(src.claude, '.claude.json'), j({ oauthAccount: { emailAddress: 'pat@example.com' }, projects: { 'C:/Work': { allowedTools: [] } }, hasCompletedOnboarding: true,
    mcpServers: { docs: { command: 'node', args: [path.join(src.claude, 'mcp', 'docs.mjs')] }, tracker: { type: 'http', url: 'https://tracker.example.com/mcp', headers: { Authorization: 'Bearer abc123' } } } }));
  put(path.join(src.claude, '.credentials.json'), '{"claudeAiOauth":{"refreshToken":"secret"}}');
  put(path.join(src.claude, 'projects', 'C--Work', 'abc.jsonl'), '{"type":"user"}\n');
  put(path.join(src.claude, 'projects', 'C--Work', 'memory', 'MEMORY.md'), '- a fact\n');
  put(path.join(src.claude, 'memory', 'notes.md'), 'remembered\n');
  put(path.join(src.claude, 'history.jsonl'), '{}\n');
  put(path.join(src.grok, 'AGENTS.md'), 'Grok rules\n');
  put(path.join(src.grok, 'config.toml'), `model = "grok-4"\n\n[mcp_servers.docs]\ncommand = "node"\nargs = ["${path.join(src.claude, 'mcp', 'docs.mjs').replace(/\\/g, '/')}"]\n`);
  put(path.join(src.grok, 'hooks', 'docket.json'), '{"docket":true}');
  put(path.join(src.grok, 'hooks', 'mine.json'), j({ command: path.join(tools, 'grok-hook.sh') }));
  put(path.join(src.grok, 'auth.json'), '{"token":"secret"}');
  put(path.join(src.grok, 'sessions', 'C%3A%5CWork', 'g1', 'summary.json'), '{}');
  put(path.join(src.codex, 'AGENTS.md'), 'Codex rules\n');
  put(path.join(src.codex, 'config.toml'), `model = "gpt-5"\nnotify = ["${path.join(src.codex, 'notify.cmd').replace(/\\/g, '/')}"]\n\n[mcp_servers.tracker]\nurl = "https://tracker.example.com/mcp"\n`);
  put(path.join(src.codex, 'auth.json'), '{"tokens":{}}');
  put(path.join(src.codex, 'sessions', '2026', '10', '31', 'rollout-x.jsonl'), '{}\n');
  return { base, src, dst, tools, market };
}
const done = (base) => fs.rmSync(base, { recursive: true, force: true });

test('copyPlan + runCopy: the setup is copied with paths into the old home pointed at the new; sign-ins, sessions and history never', async () => {
  const d = makeDesk();
  try {
    const before = snapshot(path.join(d.base, 'Old'));
    const plan = copyPlan({ source: d.src, target: d.dst, choices: { ...defaultChoices(), connectionChanged: true }, userHome: path.join(d.base, 'user'), win });
    assert.deepEqual(snapshot(path.join(d.base, 'Old')), before, 'the plan changes nothing');
    assert.ok(!fs.existsSync(path.join(d.base, 'New')), 'the plan makes nothing');
    const { left } = await runCopy(plan, { target: d.dst, userHome: path.join(d.base, 'user') });
    assert.deepEqual(left, []);
    assert.deepEqual(snapshot(path.join(d.base, 'Old')), before, 'the original is byte for byte as it was');

    // Never copied: sign-in files, sessions, history.
    for (const p of [[d.dst.claude, '.credentials.json'], [d.dst.grok, 'auth.json'], [d.dst.codex, 'auth.json'], [d.dst.claude, 'history.jsonl'], [d.dst.grok, 'sessions'], [d.dst.codex, 'sessions'], [d.dst.claude, 'projects']])
      assert.ok(!fs.existsSync(path.join(...p)), `${path.join(...p)} is not copied`);
    assert.ok(!fs.existsSync(path.join(d.dst.grok, 'hooks', 'docket.json')), "Docket's own Grok hook file is not copied");
    assert.ok(fs.existsSync(path.join(d.dst.grok, 'hooks', 'mine.json')));
    assert.ok(fs.existsSync(path.join(d.dst.claude, 'skills', 'review', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(d.dst.claude, 'plugins', 'cache', 'local', 'tidy', 'plugin.json')));

    // Paths into the old home now point into the new one, in every form.
    assert.ok(read(path.join(d.dst.claude, 'CLAUDE.md')).includes(d.dst.claude));
    assert.ok(read(path.join(d.dst.claude, 'hooks', 'stop.mjs')).includes(d.dst.claude.replace(/\\/g, '/')));
    const s = JSON.parse(read(path.join(d.dst.claude, 'settings.json')));
    assert.equal(s.hooks.Stop[0].hooks[0].command, `node "${path.join(d.dst.claude, 'hooks', 'stop.mjs')}"`);
    assert.equal(s.env.BATON_NOTES_ROOT, path.join(d.dst.claude, 'notes'));
    assert.equal(JSON.parse(read(path.join(d.dst.claude, 'plugins', 'installed_plugins.json'))).plugins['tidy@local'][0].installPath, path.join(d.dst.claude, 'plugins', 'cache', 'local', 'tidy'));
    assert.match(read(path.join(d.dst.codex, 'config.toml')), new RegExp(d.dst.codex.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    assert.ok(read(path.join(d.dst.grok, 'config.toml')).includes(path.join(d.dst.claude, 'mcp', 'docs.mjs').replace(/\\/g, '/')), 'a Grok MCP server run from the Claude home follows it');

    // The connection changed: the Bedrock lines and the AWS refresh came out, and the plan says so.
    assert.equal(s.env.CLAUDE_CODE_USE_BEDROCK, undefined);
    assert.equal(s.env.AWS_PROFILE, undefined);
    assert.equal(s.awsAuthRefresh, undefined);
    assert.deepEqual(plan.stripped.map((x) => x.name).sort(), ['AWS_PROFILE', 'AWS_REGION', 'CLAUDE_CODE_USE_BEDROCK', 'awsAuthRefresh']);
    assert.equal(s.model, 'opus');

    // Outside the home stays pointing at the live original, and is listed.
    assert.equal(s.hooks.Stop[0].hooks[1].command, `pwsh -File "${path.join(d.tools, 'audit.ps1')}"`);
    assert.ok(plan.outside.includes(path.join(d.tools, 'audit.ps1')), plan.outside.join('\n'));
    assert.ok(plan.outside.includes(d.market), 'the folder marketplace');
    assert.ok(plan.outside.includes(path.join(d.tools, 'grok-hook.sh')), 'a Grok hook outside the home');
    assert.ok(!plan.outside.some((p) => p.startsWith(d.src.claude)), 'nothing inside the home is called outside');
    assert.ok(plan.warnings.some((w) => /outside the home/.test(w)));

    // MCP servers: only the servers, turned on, paths changed; the one with a token is warned about.
    const cj = JSON.parse(read(path.join(d.dst.claude, '.claude.json')));
    assert.deepEqual(Object.keys(cj).sort(), ['hasCompletedOnboarding', 'mcpServers']);
    assert.deepEqual(cj.mcpServers.docs.args, [path.join(d.dst.claude, 'mcp', 'docs.mjs')]);
    assert.equal(cj.mcpServers.docs.disabled, undefined);
    assert.ok(plan.mcp.some((m) => m.name === 'tracker' && m.secret));
    assert.ok(plan.warnings.some((w) => /tracker holds a token/.test(w)));
    assert.ok(plan.mcp.some((m) => m.brand === 'grok' && m.name === 'docs'));

    // Memory is off by default.
    assert.equal(COPY_ITEMS.find((i) => i.key === 'memory').on, false);
    assert.ok(!fs.existsSync(path.join(d.dst.claude, 'memory')));
    // No temporary folder is left beside the homes.
    assert.deepEqual(fs.readdirSync(path.join(d.base, 'New')).sort(), ['claude-home', 'codex-home', 'grok-home']);
  } finally { done(d.base); }
});

test('copyPlan: the same connection keeps the Bedrock lines; unticked hooks, plugins and MCP stay behind', async () => {
  const d = makeDesk();
  try {
    const choices = { ...defaultChoices(), hooks: false, plugins: false, mcp: false };
    const plan = copyPlan({ source: d.src, target: d.dst, choices, userHome: path.join(d.base, 'user'), win });
    await runCopy(plan, { target: d.dst });
    const s = JSON.parse(read(path.join(d.dst.claude, 'settings.json')));
    assert.equal(s.env.CLAUDE_CODE_USE_BEDROCK, '1');
    assert.equal(s.awsAuthRefresh, 'aws sso login --profile old-profile');
    assert.equal(s.hooks, undefined);
    assert.equal(s.enabledPlugins, undefined);
    assert.deepEqual(plan.stripped, []);
    assert.ok(!fs.existsSync(path.join(d.dst.claude, 'plugins')));
    assert.ok(!fs.existsSync(path.join(d.dst.claude, 'hooks')));
    assert.ok(!fs.existsSync(path.join(d.dst.grok, 'hooks')));
    assert.ok(!fs.existsSync(path.join(d.dst.claude, '.claude.json')));
    assert.doesNotMatch(read(path.join(d.dst.grok, 'config.toml')), /mcp_servers/);
    assert.match(read(path.join(d.dst.grok, 'config.toml')), /model = "grok-4"/);
    assert.deepEqual(plan.mcp, []);
  } finally { done(d.base); }
});

test('copyPlan: with Settings unticked and MCP ticked, config.toml brings only its MCP tables', () => {
  const d = makeDesk();
  try {
    const plan = copyPlan({ source: d.src, target: d.dst, choices: { ...defaultChoices(), settings: false }, win });
    const grok = plan.copy.find((c) => c.brand === 'grok' && c.to.endsWith('config.toml'));
    assert.equal(grok.item, 'mcp');
    assert.match(grok.text, /\[mcp_servers\.docs\]/);
    assert.doesNotMatch(grok.text, /model =/);
    assert.ok(!plan.copy.some((c) => c.brand === 'claude' && /settings/.test(path.basename(c.to))));
  } finally { done(d.base); }
});

test('copyPlan: memory, when ticked, is copied once, without the session files beside it', async () => {
  const d = makeDesk();
  try {
    const plan = copyPlan({ source: d.src, target: d.dst, choices: { ...defaultChoices(), memory: true }, win });
    await runCopy(plan, { target: d.dst });
    assert.equal(read(path.join(d.dst.claude, 'memory', 'notes.md')), 'remembered\n');
    assert.equal(read(path.join(d.dst.claude, 'projects', 'C--Work', 'memory', 'MEMORY.md')), '- a fact\n');
    assert.deepEqual(fs.readdirSync(path.join(d.dst.claude, 'projects', 'C--Work')), ['memory']);
    assert.equal(plan.memory.length, 2);
  } finally { done(d.base); }
});

test('copyPlan: the standard home takes its MCP servers from the user folder, and ~/.claude forms are rewritten', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-396-'));
  try {
    const user = path.join(base, 'user'), home = path.join(user, '.claude'), to = path.join(base, 'New', 'claude-home');
    put(path.join(home, 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node ~/.claude/hooks/a.mjs' }] }] } }));
    put(path.join(user, '.claude.json'), JSON.stringify({ mcpServers: { a: { command: 'x' } }, oauthAccount: {} }));
    const plan = copyPlan({ source: { claude: home }, target: { claude: to }, userHome: user, sourceDefault: true, win });
    const mcp = plan.copy.find((c) => c.item === 'mcp');
    assert.equal(mcp.from, path.join(user, '.claude.json'));
    assert.deepEqual(JSON.parse(mcp.text), { mcpServers: { a: { command: 'x' } } });
    const s = JSON.parse(plan.copy.find((c) => c.to.endsWith('settings.json')).text);
    assert.equal(s.hooks.Stop[0].hooks[0].command, `node ${to.replace(/\\/g, '/')}/hooks/a.mjs`);
  } finally { done(base); }
});

test('runCopy: a failure leaves nothing half made, and its temporary folders go to trash', async () => {
  const d = makeDesk();
  try {
    const plan = copyPlan({ source: d.src, target: d.dst, win });
    plan.copy.push({ item: 'rules', brand: 'claude', from: path.join(d.base, 'none'), to: path.join(d.dst.claude, 'none') });
    const trashed = [];
    await assert.rejects(runCopy(plan, { target: d.dst, trash: async (p) => { trashed.push(...p); } }));
    assert.ok(trashed.length >= 1 && trashed.every((t) => /\.copy-/.test(t)), trashed.join('\n'));
    for (const h of Object.values(d.dst)) assert.ok(!fs.existsSync(h), `${h} is not made`);
    put(path.join(d.dst.claude, 'x'), 'y');
    await assert.rejects(runCopy(copyPlan({ source: d.src, target: d.dst, win }), { target: d.dst }), /not empty/);
  } finally { done(d.base); }
});

test('rewritePaths: only whole paths into the home, in each form it is written', () => {
  const from = 'C:\\D\\Old\\claude-home', to = 'C:\\D\\New\\claude-home';
  assert.equal(rewritePaths('C:\\D\\Old\\claude-home\\a', from, to, { win: true }), 'C:\\D\\New\\claude-home\\a');
  assert.equal(rewritePaths('c:/d/old/claude-home/a', from, to, { win: true }), 'C:/D/New/claude-home/a');
  assert.equal(rewritePaths('"C:\\\\D\\\\Old\\\\claude-home\\\\a"', from, to, { win: true }), '"C:\\\\D\\\\New\\\\claude-home\\\\a"');
  assert.equal(rewritePaths('C:\\D\\Old\\claude-home2 C:\\D\\Old\\claude-home.json', from, to, { win: true }), 'C:\\D\\Old\\claude-home2 C:\\D\\Old\\claude-home.json');
  assert.equal(rewritePaths('/Users/pat/Old/home/x', '/Users/pat/Old/home', '/Users/pat/New/home', { win: false }), '/Users/pat/New/home/x');
  assert.equal(rewritePaths('/users/pat/old/home/x', '/Users/pat/Old/home', '/Users/pat/New/home', { win: false }), '/users/pat/old/home/x');
  assert.equal(rewritePaths('%USERPROFILE%\\.claude\\x and ~/.claude/y', 'C:\\Users\\pat\\.claude', 'C:\\D\\New', { userHome: 'C:\\Users\\pat', win: true }), 'C:\\D\\New\\x and C:/D/New/y');
  assert.ok(namesHome('see C:/D/Old/claude-home/x', from, { win: true }));
  assert.ok(!namesHome('see C:/D/Old/claude-home2', from, { win: true }));
});

test('outsidePaths and tomlWithout', () => {
  assert.deepEqual(outsidePaths({ a: 'pwsh -File "C:\\Tools\\a.ps1"', b: ['C:\\Home\\x.mjs', '/opt/tools/b.sh'], c: 'C:\\' }, ['C:\\Home'], true), ['C:\\Tools\\a.ps1', '/opt/tools/b.sh']);
  assert.equal(tomlWithout('a = 1\n[mcp_servers.x]\nb = 2\n[other]\nc = 3', (h) => h.startsWith('mcp_servers')), 'a = 1\n[other]\nc = 3');
});

test('copyGroups: names, colors, folders and order with new ids; archived groups stay behind', () => {
  let n = 0;
  const g = copyGroups([{ id: 'a', name: 'One', color: '#f00', folder: 'C:/Work/one', createdAt: 1 }, { id: 'b', name: 'Old', archived: true }, { id: 'c', name: 'Two' }], () => 'n' + (++n), 5);
  assert.deepEqual(g, [{ id: 'n1', name: 'One', color: '#f00', folder: 'C:/Work/one', createdAt: 5 }, { id: 'n2', name: 'Two', createdAt: 5 }]);
});

test('groupAction (#606): the group route takes a copied group\'s id and an app-made one', () => {
  const copied = copyGroups([{ id: 'a', name: 'One' }])[0].id;
  assert.match(copied, /^g[0-9a-f]{8}$/);
  for (const act of ['rename', 'folder', 'archive', 'restore', 'delete']) {
    assert.deepEqual([...groupAction(`/api/groups/${copied}/${act}`)].slice(1), [copied, act]);
    assert.deepEqual([...groupAction(`/api/groups/g_1a2b3c4d/${act}`)].slice(1), ['g_1a2b3c4d', act]);
  }
  assert.equal(groupAction('/api/groups/order'), null);
  assert.equal(groupAction('/api/groups/g_1a2b3c4d/explode'), null);
  assert.equal(groupAction('/api/groups/x123/delete'), null);
  assert.equal(groupAction('/api/groups/g../delete'), null);
});

test('copyEntry and needsSignIn: connections same / new / off, desk settings, env and where it came from', () => {
  const src = { id: 'old', name: 'Old', home: 'C:/D/Old/claude-home', folder: 'C:/Work', email: 'pat@example.com', awsProfile: 'p', awsRegion: 'us-west-2', defaultEngine: 'grok', color: '#123', links: [{ name: 'a', url: 'https://a' }], env: { A: '1' }, grokHome: 'C:/D/Old/grok-home' };
  const at = '2026-10-31T00:00:00.000Z';
  const same = copyEntry(src, { name: 'Old 2', home: 'C:/D/New/claude-home', grokHome: 'C:/D/New/grok-home', at });
  assert.deepEqual(same, { name: 'Old 2', home: 'C:/D/New/claude-home', folder: 'C:/Work', grokHome: 'C:/D/New/grok-home', email: 'pat@example.com', awsProfile: 'p', awsRegion: 'us-west-2',
    links: [{ name: 'a', url: 'https://a' }], defaultEngine: 'grok', color: '#123', env: { A: '1' }, copiedFrom: { id: 'old', name: 'Old', at } });
  assert.notEqual(same.links, src.links, 'a copy, not the same list');
  const fresh = copyEntry(src, { name: 'N', home: 'h', grokHome: 'g', conn: { claude: { mode: 'new', kind: 'claude', email: ' sam@example.com ' }, grok: { mode: 'off' } }, env: { B: '2' }, choices: { ...defaultChoices(), docket: false }, at });
  assert.equal(fresh.email, 'sam@example.com');
  assert.equal(fresh.awsProfile, undefined);
  assert.equal(fresh.grokHome, undefined);
  assert.equal(fresh.defaultEngine, undefined);
  assert.deepEqual(fresh.env, { B: '2' });
  const off = copyEntry(src, { name: 'N', home: 'h', conn: { claude: { mode: 'off' } }, choices: { ...defaultChoices(), env: false }, at });
  assert.deepEqual(off.brandsOff, ['claude']);
  assert.equal(off.env, undefined);
  assert.equal(off.defaultEngine, undefined, 'grok is off too (no Grok home)');
  assert.deepEqual(needsSignIn(src, { grok: { mode: 'same' }, codex: { mode: 'off' } }), ['grok'], 'a same Bedrock connection works at once');
  assert.deepEqual(needsSignIn({ email: 'x' }, { codex: { mode: 'off' }, grok: { mode: 'off' } }), ['claude'], 'an account signs in again in the new home');
  assert.deepEqual(needsSignIn(src, { claude: { mode: 'new' }, grok: { mode: 'off' }, codex: { mode: 'off' } }), ['claude']);
});

test('targetProblem: not inside Docket, not inside or holding the original home, not holding anything', () => {
  const o = { docket: 'C:\\Docket', sources: ['C:\\D\\Old\\claude-home'], exists: (p) => p === 'C:\\Full', readdir: () => ['x'], win: true };
  const abs = (p) => (win ? p : p.replace(/^C:/, '').replace(/\\/g, '/'));
  const oo = win ? o : { ...o, docket: abs(o.docket), sources: o.sources.map(abs), exists: (p) => p === abs('C:\\Full'), win: false };
  assert.equal(targetProblem(abs('C:\\D\\New\\claude-home'), oo), '');
  assert.match(targetProblem(abs('C:\\Docket\\homes\\a'), oo), /Docket's own folder/);
  assert.match(targetProblem(abs('C:\\D\\Old\\claude-home\\copy'), oo), /original's home/);
  assert.match(targetProblem(abs('C:\\D\\Old'), oo), /original's home/);
  assert.match(targetProblem(abs('C:\\Full'), oo), /not empty/);
  assert.match(targetProblem('relative', oo), /full path/);
});
