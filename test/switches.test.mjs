// Tests for the profile page's on/off switches (switches.mjs and buildProfile). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanSettingSources, setPluginOn, writePluginOn, readGrokCompat, setGrokCompat, writeGrokCompat } from '../switches.mjs';
import { buildProfile } from '../profile.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'docket-switches-'));

test('settings layers: all three, or none set, means Claude Code\'s default', () => {
  assert.equal(cleanSettingSources(undefined), undefined);
  assert.equal(cleanSettingSources(['local', 'user', 'project']), undefined);
  assert.deepEqual(cleanSettingSources(['local', 'user', 'bogus']), ['user', 'local']);
  assert.deepEqual(cleanSettingSources([]), []);
});

test('a plugin switch edits only enabledPlugins and keeps the file\'s shape', () => {
  const text = '{\r\n    "model": "opus",\r\n    "hooks": { "PreToolUse": [] },\r\n    "enabledPlugins": {\r\n        "a@m": true\r\n    },\r\n    "zz": 1\r\n}\r\n';
  const out = setPluginOn(text, 'a@m', false);
  assert.deepEqual(JSON.parse(out), { model: 'opus', hooks: { PreToolUse: [] }, enabledPlugins: { 'a@m': false }, zz: 1 });
  assert.ok(out.includes('\r\n    "model": "opus",\r\n'), 'indent and line endings kept');
  assert.ok(out.endsWith('}\r\n'));
  assert.deepEqual(Object.keys(JSON.parse(out)), ['model', 'hooks', 'enabledPlugins', 'zz'], 'key order kept');
  // only that one value or line changes; the rest of the text stays exactly as it was
  assert.equal(out, text.replace('"a@m": true', '"a@m": false'));
  assert.equal(setPluginOn(text, 'b@m', true), text.replace('"a@m": true\r\n', '"a@m": true,\r\n        "b@m": true\r\n'));
  const odd = '{\n    "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "echo \\"}\\"" } ] } ] },\n    "x": [1, 2]\n}\n';
  assert.equal(setPluginOn(odd, 'p@m', false), odd.replace('"x": [1, 2]\n', '"x": [1, 2],\n    "enabledPlugins": {\n        "p@m": false\n    }\n'));
  assert.equal(setPluginOn('{"model":"x"}', 'b@m', true), '{"model":"x", "enabledPlugins": { "b@m": true }}');
  assert.equal(setPluginOn('{"enabledPlugins": {}}', 'b@m', true), '{"enabledPlugins": { "b@m": true }}');
  assert.equal(setPluginOn('{ }', 'b@m', true), '{ "enabledPlugins": { "b@m": true }}');
  assert.equal(setPluginOn('{"enabledPlugins": {"b@m": true, "b@m": false}}', 'b@m', true), '{"enabledPlugins": {"b@m": true, "b@m": true}}', 'the one that counts is edited');
  assert.deepEqual(JSON.parse(setPluginOn('', 'b@m', false)), { enabledPlugins: { 'b@m': false } });
  assert.throws(() => setPluginOn('{ not json', 'a@m', true));
  assert.throws(() => setPluginOn('{"enabledPlugins": []}', 'a@m', true));
});

test('a plugin switch writes a missing settings.json and leaves a broken one alone', () => {
  const d = tmp(), f = path.join(d, 'settings.json');
  writePluginOn(f, 'a@m', false);
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { enabledPlugins: { 'a@m': false } });
  fs.writeFileSync(f, '{ broken');
  assert.throws(() => writePluginOn(f, 'a@m', true));
  assert.equal(fs.readFileSync(f, 'utf8'), '{ broken');
});

test('Grok compat: reads each form, unset is undefined', () => {
  assert.deepEqual(readGrokCompat('[compat.claude]\nhooks = false\nrules = true # keep\n'), { hooks: false, rules: true, skills: undefined, agents: undefined, mcps: undefined, sessions: undefined });
  assert.equal(readGrokCompat('compat.claude.skills = false\n[other]\n').skills, false);
  assert.equal(readGrokCompat('[compat]\nclaude.agents = false\n').agents, false);
  assert.equal(readGrokCompat('[other]\nhooks = false\n').hooks, undefined, 'a hooks key in another table is not compat');
  assert.equal(readGrokCompat(null).hooks, undefined);
});

test('Grok compat: edits only the one key, keeping comments, order and line endings', () => {
  const text = '# mine\r\nmodel = "grok-4"\r\n\r\n[compat.claude]\r\nhooks = false  # no hooks\r\nrules = false\r\n\r\n# next\r\n[ui]\r\ntheme = "dark"\r\n';
  assert.equal(setGrokCompat(text, 'hooks', true), text.replace('hooks = false  # no hooks', 'hooks = true  # no hooks'));
  // a new key goes after the table's last setting, before the blank line and the next table's comment
  assert.equal(setGrokCompat(text, 'skills', false), text.replace('rules = false\r\n', 'rules = false\r\nskills = false\r\n'));
  // no table yet: one is added at the end
  assert.equal(setGrokCompat('model = "x"', 'mcps', false), 'model = "x"\n\n[compat.claude]\nmcps = false\n');
  assert.equal(setGrokCompat('', 'sessions', true), '[compat.claude]\nsessions = true\n');
  // the dotted forms are edited where they are
  assert.equal(setGrokCompat('compat.claude.agents = false\n', 'agents', true), 'compat.claude.agents = true\n');
  assert.equal(setGrokCompat('[compat]\nclaude.rules = true\n', 'rules', false), '[compat]\nclaude.rules = false\n');
  assert.throws(() => setGrokCompat('compat = { claude = { hooks = false } }\n', 'rules', false), /inline table/);
  assert.throws(() => setGrokCompat('', 'model', false));
});

test('Grok compat: writeGrokCompat makes config.toml when it is missing', () => {
  const d = tmp(), f = path.join(d, 'config.toml');
  writeGrokCompat(f, 'hooks', false);
  assert.equal(fs.readFileSync(f, 'utf8'), '[compat.claude]\nhooks = false\n');
});

test('the profile shows a checkbox for each switch, with what it is now', () => {
  const home = tmp(), grokHome = tmp(), folder = tmp();
  const plugDir = path.join(home, 'plugins', 'cache', 'p');
  fs.mkdirSync(plugDir, { recursive: true });
  fs.writeFileSync(path.join(home, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'p@m': [{ installPath: plugDir, version: '1' }], 'q@m': [{ installPath: plugDir }] } }));
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ enabledPlugins: { 'p@m': false } }));
  fs.mkdirSync(path.join(folder, '.claude'));
  fs.writeFileSync(path.join(folder, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'q@m': true } }));
  fs.writeFileSync(path.join(grokHome, 'config.toml'), '[compat.claude]\nhooks = false\n');
  const client = { id: 't', name: 'T', home, folder, grokHome, settingSources: ['user'], docketHooks: { off: ['a'] } };
  const pr = buildProfile(client, { isDefaultHome: false, docketHooks: [{ name: 'a', event: 'PreToolUse', off: true }, { name: 'b', event: 'PreToolUse' }] });
  const items = (sec, title) => pr.sections.find((s) => s.id === sec).groups.find((g) => g.title.startsWith(title)).items;
  assert.deepEqual(items('skills', 'Plugins').map((i) => [i.toggle.key, i.toggle.on]), [['p@m', false], ['q@m', true]]);
  assert.match(items('skills', 'Plugins')[1].toggle.note, /desk folder settings, which wins/);
  assert.deepEqual(items('docket', 'Hooks').map((i) => [i.toggle.key, i.toggle.on]), [['a', false], ['b', true]]);
  assert.deepEqual(items('switches', 'Settings layers').map((i) => [i.toggle.key, i.toggle.on]), [['user', true], ['project', false], ['local', false]]);
  const grok = items('switches', 'What Grok');
  assert.deepEqual(grok.map((i) => [i.toggle.key, i.toggle.on]), [['hooks', false], ['rules', true], ['skills', true], ['agents', true], ['mcps', true], ['sessions', true]]);
  assert.ok(pr.allowed.has(path.join(grokHome, 'config.toml').toLowerCase()), 'config.toml can be opened and shown in its folder');
  // sending work to child sessions: on unless the desk set splitWork false
  assert.deepEqual(items('switches', 'How sessions split').map((i) => [i.toggle.kind, i.toggle.on]), [['split', true]]);
  const off = buildProfile({ ...client, splitWork: false }, { isDefaultHome: false });
  assert.equal(off.sections.find((s) => s.id === 'switches').groups.find((g) => g.title.startsWith('How sessions split')).items[0].toggle.on, false);
  // carrying on after signing in again (#719): on unless the desk set resumeAfterSignIn false
  assert.deepEqual(items('switches', 'When the sign-in').map((i) => [i.toggle.kind, i.toggle.on]), [['resume', true]]);
  const noResume = buildProfile({ ...client, resumeAfterSignIn: false }, { isDefaultHome: false });
  assert.equal(noResume.sections.find((s) => s.id === 'switches').groups.find((g) => g.title.startsWith('When the sign-in')).items[0].toggle.on, false);
  // reloading a session whose config changed: Automatic unless the desk set Ask
  assert.deepEqual(items('switches', 'When a running session').map((i) => [i.toggle.kind, i.toggle.value]), [['reload', 'auto']]);
  const ask = buildProfile({ ...client, configReload: 'ask' }, { isDefaultHome: false });
  assert.equal(ask.sections.find((s) => s.id === 'switches').groups.find((g) => g.title.startsWith('When a running session')).items[0].toggle.value, 'ask');
  // no Grok home: no Grok switches
  const noGrok = buildProfile({ ...client, grokHome: undefined }, { isDefaultHome: false });
  assert.deepEqual(noGrok.sections.find((s) => s.id === 'switches').groups.map((g) => g.title), ['Plans', 'How sessions split work', 'When the sign-in runs out', 'When a running session\'s config changes', 'Settings layers Claude sessions load']);
});
