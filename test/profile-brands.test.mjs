// Tests for the Inspector's Codex and Grok readers in profile.mjs, on made-up homes. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildProfile, codexProfile, grokProfile, parseToml } from '../profile.mjs';

const put = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const fwd = (p) => p.replace(/\\/g, '/');

function homes() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-brands-'));
  const claude = path.join(root, 'claude'), codex = path.join(root, 'codex'), grok = path.join(root, 'grok'), folder = path.join(root, 'work');
  put(path.join(claude, 'CLAUDE.md'), '# Claude rules\n');
  put(path.join(claude, 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node stop.mjs' }] }] } }));
  put(path.join(folder, 'AGENTS.md'), '# Repo rules for Codex and Grok\n');

  // Codex: hooks in both hooks.json and config.toml, an MCP server with a key that must not show, two plugins
  const script = path.join(codex, 'hooks', 'guard.mjs');
  put(script, '// a hook script\n');
  put(path.join(codex, 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `node "${fwd(script)}"`, timeout: 5, statusMessage: 'Checking' }] }] } }));
  put(path.join(codex, 'config.toml'), [
    'model = "gpt-6"   # a comment', '',
    '[features]', 'hooks = true', '',
    '[mcp_servers.tracker]', 'command = "npx"', 'args = [', '  "-y",', '  "tracker-mcp", # the package', ']', 'env = { TRACKER_TOKEN = "secret-123" }', '',
    '[mcp_servers."web docs"]', 'url = "https://docs.example.com/mcp"', 'enabled = false', '',
    '[plugins."tidy@market"]', 'enabled = true', '', '[plugins."old@market"]', 'enabled = false', '',
    '[[hooks.SessionStart]]', '[[hooks.SessionStart.hooks]]', 'type = "command"', "command = 'echo started'", '',
  ].join('\n'));
  put(path.join(codex, 'AGENTS.md'), '# Codex home rules\n');
  put(path.join(codex, 'AGENTS.override.md'), '# Override\n');
  put(path.join(codex, 'rules', 'default.rules'), 'prefix_rule(pattern=["git", "status"], decision="allow")\n');
  put(path.join(codex, 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: Ship it\n---\n');
  put(path.join(codex, 'skills', '.system', 'skill-creator', 'SKILL.md'), '---\nname: skill-creator\ndescription: Make skills\n---\n');
  put(path.join(codex, 'prompts', 'review.md'), '---\ndescription: Review the diff\n---\n');
  put(path.join(codex, 'memories', 'MEMORY.md'), '- a fact\n');
  put(path.join(codex, 'plugins', 'cache', 'market', 'tidy', '1.2.0', '.codex-plugin', 'plugin.json'), '{"name":"tidy"}');
  put(path.join(codex, 'plugins', 'cache', 'market', 'tidy', '1.2.0', 'skills', 'clean', 'SKILL.md'), '---\nname: clean\ndescription: Tidy up\n---\n');
  put(path.join(codex, 'plugins', 'cache', 'market', 'tidy', '1.2.0', 'hooks', 'hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'tidy-stop' }] }] } }));

  // Grok: [compat.claude] with some switches set, hooks in config.toml and hooks/, Docket's own hook file
  put(path.join(grok, 'config.toml'), [
    '[compat.claude]', 'hooks = false', 'rules = false', 'skills = true', '',
    '[mcp_servers.docs]', 'command = "node"', 'args = ["docs.mjs"]', '',
    '[[hooks.PreToolUse]]', 'matcher = "Bash"', '[[hooks.PreToolUse.hooks]]', 'type = "command"', 'command = "grok-guard"', '',
  ].join('\n'));
  put(path.join(grok, 'hooks', 'mine.json'), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'nudge' }] }] } }));
  put(path.join(grok, 'hooks', 'docket.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node bash-cmdline-guard.js' }] }] } }));
  put(path.join(grok, 'AGENTS.md'), '# Grok home rules\n');
  put(path.join(grok, 'rules', 'style.md'), 'Be brief.\n');
  put(path.join(grok, 'skills', 'triage', 'SKILL.md'), '---\nname: triage\ndescription: Sort issues\n---\n');
  put(path.join(grok, 'memory', 'notes.md'), '---\nname: a note\ndescription: Something to keep\ntype: project\n---\n');
  return { root, claude, codex, grok, folder, client: { id: 'acme', name: 'Acme', home: claude, folder, codexHome: codex, grokHome: grok } };
}
const collect = () => { const allowed = new Set(); const item = (o) => { if (o.path) { o.path = path.resolve(o.path); allowed.add(o.path.toLowerCase()); } return o; }; return { item, allowed }; };
const names = (groups) => groups.flatMap((g) => g.items.map((i) => i.name));
const docketHooks = [{ name: 'bash-cmdline-guard', event: 'PreToolUse', matcher: 'Bash', command: 'node bash-cmdline-guard.js' }];

test('parseToml reads config.toml tables, arrays of tables, strings, arrays and inline tables', () => {
  const j = parseToml([
    'top = "a \\"quoted\\" \\u00e9"', "lit = 'C:\\Users\\x'", 'n = 1_000', 'f = -1.5e2', 'on = true', 'when = 1979-05-27T07:32:00Z',
    'multi = """', 'line one', 'line two"""', '[a.b]', 'c = [1, [2, 3], { d = "e" }]', '[[list]]', 'x = 1', '[[list]]', 'x = 2', '[list.sub]', 'y = 3',
  ].join('\r\n'));
  assert.equal(j.top, 'a "quoted" é');
  assert.equal(j.lit, 'C:\\Users\\x');
  assert.equal(j.n, 1000); assert.equal(j.f, -150); assert.equal(j.on, true); assert.equal(j.when, '1979-05-27T07:32:00Z');
  assert.equal(j.multi, 'line one\r\nline two');
  assert.deepEqual(j.a.b.c, [1, [2, 3], { d: 'e' }]);
  assert.deepEqual(j.list, [{ x: 1 }, { x: 2, sub: { y: 3 } }]);
  assert.equal(parseToml('a = '), null);
  assert.equal(parseToml('[unclosed'), null);
  assert.deepEqual(parseToml(''), {});
});

test('the Codex reader finds hooks in hooks.json, config.toml and plugins, grouped by when they run', () => {
  const h = homes(), { item, allowed } = collect();
  const c = codexProfile(h.codex, h.folder, item);
  assert.ok([...c.hooks, ...c.instructions, ...c.mcp, ...c.skills, ...c.memory, ...c.docket].every((g) => g.brand === 'codex'));
  assert.deepEqual(c.hooks.map((g) => g.title), ['When a session starts or resumes (SessionStart)', 'Before a tool runs (can block it) (PreToolUse)', 'When Codex finishes a reply (Stop)']);
  const pre = c.hooks[1].items[0];
  assert.equal(pre.name, 'Only for: Bash');
  assert.match(pre.note, /hooks\.json in the Codex home · stops after 5s · shows "Checking"/);
  assert.deepEqual(pre.links.map((l) => l.name), ['guard.mjs']);
  assert.equal(c.hooks[0].items[0].detail, 'echo started');
  assert.match(c.hooks[0].items[0].note, /config\.toml in the Codex home/);
  assert.match(c.hooks[2].items[0].note, /plugin tidy@market/);
  assert.ok(allowed.has(path.join(h.codex, 'hooks.json').toLowerCase()) && allowed.has(path.resolve(path.join(h.codex, 'hooks', 'guard.mjs')).toLowerCase()));
});

test('the Codex reader lists AGENTS.md, rules, MCP servers without their keys, skills, prompts, plugins and memories', () => {
  const h = homes(), { item, allowed } = collect();
  const c = codexProfile(h.codex, h.folder, item);
  const inst = c.instructions[0].items;
  assert.deepEqual(inst.map((i) => [i.name, i.badge || '']), [['AGENTS.override.md (every Codex session in this desk)', 'in use'], ['AGENTS.md (every Codex session in this desk)', 'not read'], ['AGENTS.md in the desk folder', '']]);
  assert.deepEqual(names([c.instructions[1]]), ['default.rules']);
  const mcp = c.mcp[0].items;
  assert.deepEqual(mcp.map((m) => [m.name, m.detail, m.badge]), [['tracker', 'npx -y tracker-mcp', 'command'], ['web docs', 'https://docs.example.com/mcp', 'http']]);
  assert.match(mcp[1].note, /turned off/);
  assert.ok(!JSON.stringify(c).includes('secret-123'), 'an MCP server\'s env never shows');
  const skills = c.skills.find((g) => g.title === 'Skills').items;
  assert.deepEqual(skills.filter((s) => !s.note.includes('~/.agents')).map((s) => [s.name, s.note]), [['deploy', 'made in this Codex home'], ['skill-creator', 'comes with Codex'], ['tidy:clean', 'plugin tidy@market']]);
  assert.deepEqual(names(c.skills.filter((g) => g.title.startsWith('Prompts'))), ['/prompts:review']);
  const plugins = c.skills.find((g) => g.title === 'Plugins').items;
  assert.deepEqual(plugins.map((p) => [p.name, p.badge, p.note]), [['tidy@market', 'on', 'version 1.2.0'], ['old@market', 'off', '']]);
  assert.ok(allowed.has(path.join(h.codex, 'plugins', 'cache', 'market', 'tidy', '1.2.0', '.codex-plugin', 'plugin.json').toLowerCase()));
  assert.deepEqual(names(c.memory), ['MEMORY.md']);
});

test('an empty Codex home says so in every section, and a broken config.toml is named', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-brands-')), home = path.join(root, 'codex');
  put(path.join(home, 'config.toml'), 'model = \n');
  const { item } = collect();
  const c = codexProfile(home, path.join(root, 'work'), item);
  assert.deepEqual(names(c.hooks), ['No hooks in this Codex home', 'config.toml could not be read']);
  assert.deepEqual(names(c.instructions), ['No AGENTS.md in this Codex home']);
  assert.deepEqual(names(c.mcp), ['None set up']);
  assert.deepEqual(names(c.memory), ['No memory saved yet']);
});

test('the Grok reader shows its own hooks apart from Docket\'s, and what is not read yet', () => {
  const h = homes(), { item, allowed } = collect();
  const g = grokProfile(h.grok, h.folder, item, { docketHooks });
  assert.equal(g.instructions.length, 1, '[compat.claude] is left to the Switches section');
  assert.deepEqual(names([g.instructions[0]]),['AGENTS.md (every Grok session in this desk)', 'AGENTS.md in the desk folder', 'style.md']);
  assert.deepEqual(g.hooks.map((x) => x.title), ['Each time a message is sent (UserPromptSubmit)', 'Before a tool runs (can block it) (PreToolUse)']);
  assert.match(g.hooks[0].items[0].note, /hooks\/mine\.json in the Grok home/);
  assert.equal(g.hooks[1].items[0].detail, 'grok-guard');
  assert.ok(!JSON.stringify(g.hooks).includes('bash-cmdline-guard'), 'Docket\'s hook file is listed under Docket\'s additions, not the home\'s own hooks');
  assert.deepEqual(g.docket[0].items.map((i) => i.name), ['bash-cmdline-guard']);
  assert.match(g.docket[0].items[0].note, /Grok sessions · on/);
  assert.ok(allowed.has(path.join(h.grok, 'hooks', 'docket.json').toLowerCase()));
  assert.deepEqual(g.mcp[0].items.map((m) => [m.name, m.detail]), [['docs', 'node docs.mjs']]);
  assert.deepEqual(names(g.skills.filter((x) => x.title === 'Skills')), ['triage']);
  assert.ok(g.skills.find((x) => x.title === 'Plugins').items[0].notRead);
  assert.deepEqual(g.memory[0].items.map((i) => [i.name, i.badge]), [['a note', 'project']]);
});

test('buildProfile: a Claude-only desk is as before; a three-brand desk adds each brand\'s groups after Claude\'s', () => {
  const h = homes();
  const only = buildProfile({ id: 'a', name: 'A', home: h.claude, folder: h.folder });
  const same = buildProfile({ ...h.client }, { brands: ['claude'] });
  const shape = (p) => p.sections.map((s) => [s.id, s.count, s.groups.map((g) => g.title)]);
  assert.deepEqual(shape(same), shape(only), 'Codex and Grok homes are not read when those brands are off');
  assert.deepEqual(only.client.brands, ['claude']);
  assert.ok(only.sections.every((s) => s.groups.every((g) => g.brand === 'claude' || g.brand === null)));

  const all = buildProfile(h.client, { brands: ['claude', 'grok', 'codex'], docketHooks, grokHookFile: 'docket.json' });
  assert.deepEqual(all.client.brands, ['claude', 'grok', 'codex']);
  for (const id of ['hooks', 'instructions', 'mcp', 'skills', 'memory', 'docket']) {
    const order = [...new Set(all.sections.find((s) => s.id === id).groups.map((g) => g.brand).filter(Boolean))];
    assert.deepEqual(order, ['claude', 'grok', 'codex'], `${id}: Claude first, then the others in the desk's order`);
  }
  assert.ok(all.allowed.has(path.join(h.codex, 'AGENTS.override.md').toLowerCase()), 'the file viewer may open the new files');
  assert.ok(all.allowed.has(path.join(h.grok, 'rules', 'style.md').toLowerCase()));
  const sw = all.sections.find((s) => s.id === 'switches').groups;
  assert.deepEqual(sw.map((g) => g.brand), [null, null, null, 'claude', 'claude', 'grok'], 'plans, splitting work and resuming after a sign-in are every brand\'s, reloading on a config change and the settings layers Claude\'s, the [compat.claude] checkboxes Grok\'s');
  assert.equal(JSON.stringify(all.sections).match(/compat\.claude\]/g).length, 1, 'Grok\'s [compat.claude] is listed once, in Switches');
  assert.ok(!buildProfile(h.client, { brands: ['claude', 'codex'] }).sections.find((s) => s.id === 'switches').groups.some((g) => g.brand === 'grok'), 'a desk with Grok off has no Grok switches');
  const skills = all.sections.find((s) => s.id === 'skills');
  assert.equal(skills.count, skills.groups.reduce((n, g) => n + g.items.filter((i) => !i.notRead && !/^No |^None /.test(i.name)).length, 0));
});

test('buildProfile: a desk with Claude turned off shows only its other brands', () => {
  const h = homes();
  const p = buildProfile(h.client, { brands: ['codex'] });
  assert.deepEqual(p.client.brands, ['codex']);
  assert.ok(p.sections.length);
  for (const s of p.sections) for (const g of s.groups) assert.ok(g.brand === 'codex' || g.brand === null, `${s.id}: ${g.title}`);
  assert.ok(!p.sections.some((s) => s.id === 'defaults'), 'Claude Code\'s own defaults are left out');
});
