// Plugin sources (#574): the source made from what the user typed, git's errors in plain words, and what a source's
// plugins bring, read before any is installed. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sourceFrom, cloneCommands, noPrompts, plainError, hostOf, pluginsIn, bringsText, readMarket, isClone, sourceLine, CLONES } from '../plugin-sources.mjs';
import { buildProfile } from '../profile.mjs';

test('a git address on any host is a git source; owner/repo is GitHub', () => {
  assert.deepEqual(sourceFrom('https://gitlab.example.com/team/plugins.git'), { kind: 'git', url: 'https://gitlab.example.com/team/plugins.git', sub: '', host: 'gitlab.example.com' });
  assert.deepEqual(sourceFrom('git@bitbucket.org:team/plugins.git', 'tools/'), { kind: 'git', url: 'git@bitbucket.org:team/plugins.git', sub: 'tools', host: 'bitbucket.org' });
  assert.deepEqual(sourceFrom('ssh://git@git.example.com:2222/team/plugins.git'), { kind: 'git', url: 'ssh://git@git.example.com:2222/team/plugins.git', sub: '', host: 'git.example.com' });
  assert.deepEqual(sourceFrom('acme/plugins'), { kind: 'git', url: 'https://github.com/acme/plugins.git', sub: '', host: 'github.com' });
  assert.equal(sourceFrom('  "https://example.com/r.git"  ').url, 'https://example.com/r.git', 'quotes and spaces around it are dropped');
});

test('an Azure DevOps page address gives its clone address and the folder it shows', () => {
  const s = sourceFrom('https://dev.azure.com/org/Project/_git/repo?path=/lab/&version=GBmain');
  assert.deepEqual(s, { kind: 'git', url: 'https://dev.azure.com/org/Project/_git/repo', sub: 'lab', host: 'dev.azure.com' });
  assert.equal(sourceFrom('https://dev.azure.com/org/Project/_git/repo?path=/lab', 'other').sub, 'other', 'a subfolder typed in wins');
  assert.equal(sourceFrom('https://org@dev.azure.com/org/P/_git/repo').url, 'https://org@dev.azure.com/org/P/_git/repo', 'a user name alone is kept');
});

test('a sign-in in the address, a subfolder outside the repo, and anything else are refused in plain words', () => {
  assert.throws(() => sourceFrom('https://me:secret@git.example.com/r.git'), /Leave the password or token out/);
  assert.throws(() => sourceFrom('https://git.example.com/r.git', '../up'), /folder inside the repo/);
  assert.throws(() => sourceFrom('https://git.example.com/r.git', 'C:/x'), /folder inside the repo/);
  assert.throws(() => sourceFrom(''), /Type a git address/);
  assert.throws(() => sourceFrom('plugins/here/too'), /full path of a folder/);
  assert.throws(() => sourceFrom('https://git.example.com/a b.git'), /no spaces/);
});

test('a folder is a folder source, on Windows and on a Mac', () => {
  assert.deepEqual(sourceFrom('C:\\Work\\repo', 'lab', path.win32), { kind: 'folder', path: 'C:\\Work\\repo\\lab' });
  assert.deepEqual(sourceFrom('C:/Work/repo/lab', '', path.win32), { kind: 'folder', path: 'C:\\Work\\repo\\lab' });
  assert.deepEqual(sourceFrom('/Users/pat/repo', 'lab', path.posix), { kind: 'folder', path: '/Users/pat/repo/lab' });
  assert.throws(() => sourceFrom('C:\\Work\\repo', '', path.posix), /full path/);
});

test('a subfolder is cloned alone, with no history, and git never prompts', () => {
  assert.deepEqual(cloneCommands({ url: 'https://h/r.git', sub: 'lab' }, '/d/lab'), [
    ['clone', '--depth', '1', '--filter=blob:none', '--sparse', 'https://h/r.git', '/d/lab'], ['-C', '/d/lab', 'sparse-checkout', 'set', 'lab']]);
  const env = noPrompts({ PATH: 'x' });
  assert.equal(env.GIT_TERMINAL_PROMPT, '0'); assert.equal(env.GCM_INTERACTIVE, 'never'); assert.equal(env.PATH, 'x');
  assert.match(env.GIT_SSH_COMMAND, /BatchMode=yes/);
  assert.equal(noPrompts({ GIT_SSH_COMMAND: 'plink' }).GIT_SSH_COMMAND, 'plink', 'a computer\'s own ssh command is kept');
});

test('git\'s errors say what to do', () => {
  assert.match(plainError("fatal: could not read Username for 'https://dev.azure.com': terminal prompts disabled", 'dev.azure.com'), /could not sign in to dev\.azure\.com.*Docket never keeps a sign-in/);
  assert.match(plainError('git@host: Permission denied (publickey).', 'host'), /could not sign in/);
  assert.match(plainError('{"message":"Failed to clone marketplace repository: fatal: Cannot prompt because user interactivity has been disabled."}', 'h'), /could not sign in to h/, 'Git Credential Manager with prompts off');
  assert.match(plainError('fatal: remote error: access denied or repository not exported: /nope'), /found no repo/);
  assert.equal(hostOf({ source: 'github', repo: 'a/b' }), 'github.com');
  assert.equal(hostOf({ url: 'git@ssh.dev.azure.com:v3/o/p/r' }), 'ssh.dev.azure.com');
  assert.equal(hostOf('./plugins/x'), '');
  assert.match(plainError('remote: TF401019: The Git repository with name or identifier x does not exist', 'dev.azure.com'), /found no repo/);
  assert.match(plainError("fatal: unable to access 'https://x/': Could not resolve host: x", 'x'), /Could not reach x/);
  assert.match(plainError('spawn git ENOENT'), /Git is not installed/);
  assert.equal(plainError('noise\n{"outcome":"failed","message":"Plugin \\"a\\" not found in marketplace \\"m\\"."}'), 'Plugin "a" not found in marketplace "m".', 'claude\'s own message is kept');
});

function market() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-src-'));
  const w = (rel, text) => { const f = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  w('.claude-plugin/marketplace.json', JSON.stringify({ name: 'lab', owner: { name: 't' }, metadata: { pluginRoot: './more' }, plugins: [
    { name: 'words', source: './plugins/words', description: 'text only' },
    { name: 'runner', source: 'runner', description: 'from pluginRoot' },
    { name: 'far', source: { source: 'git', url: 'https://git.example.com/far.git' }, description: 'elsewhere' }] }));
  w('plugins/words/.claude-plugin/plugin.json', '{"name":"words","version":"1.2.0"}');
  w('plugins/words/skills/a/SKILL.md', '---\nname: a\n---\n');
  w('plugins/words/skills/b/SKILL.md', '---\nname: b\n---\n');
  w('plugins/words/commands/go.md', 'Go.');
  w('more/runner/.claude-plugin/plugin.json', '{"name":"runner"}');
  w('more/runner/hooks/hooks.json', '{"hooks":{}}');
  w('more/runner/.mcp.json', '{"mcpServers":{"db":{"command":"x"}}}');
  w('more/runner/bin/tool', '#!/bin/sh');
  return dir;
}

test('what each plugin brings is read from the source before install: text, code, or not seen yet', () => {
  const dir = market();
  const [words, runner, far] = pluginsIn(dir);
  assert.deepEqual(words.brings, { text: ['2 skills', '1 command'], code: [], version: '1.2.0' });
  assert.equal(words.version, '1.2.0');
  assert.equal(bringsText(words), '2 skills, 1 command (text only) · runs no code');
  assert.equal(runner.dir, path.join(dir, 'more', 'runner'), 'a bare name is found under metadata.pluginRoot');
  assert.deepEqual(runner.brings.code, ['hooks', 'MCP servers (db)', 'programs in bin/']);
  assert.match(bringsText(runner), /runs code on this computer: hooks, MCP servers \(db\), programs in bin\//);
  assert.equal(far.brings, undefined);
  assert.match(bringsText(far), /comes from https:\/\/git\.example\.com\/far\.git: what it brings shows only once it is installed/);
  assert.equal(readMarket(path.join(dir, 'plugins')), null);
});

test('Docket\'s own clone of a subfolder is known by its folder, and shown by the address it came from', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-home-'));
  const clone = path.join(home, CLONES, 'lab');
  fs.mkdirSync(path.join(clone, 'lab'), { recursive: true });
  fs.writeFileSync(clone + '.json', JSON.stringify({ url: 'https://git.example.com/r.git', sub: 'lab' }));
  assert.equal(isClone(path.join(clone, 'lab'), home), clone);
  assert.equal(isClone(path.join(home, 'elsewhere'), home), '');
  assert.equal(sourceLine({ source: 'directory', path: path.join(clone, 'lab') }, home), 'https://git.example.com/r.git (lab)');
  assert.equal(sourceLine({ source: 'directory', path: 'D:\\mine' }, home), 'D:\\mine');
  assert.equal(sourceLine({ source: 'github', repo: 'a/b' }, home), 'GitHub a/b');
});

test('the Inspector lists each source and its plugins, with Install only for those not installed', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-home-')), dir = market();
  fs.mkdirSync(path.join(home, 'plugins'));
  fs.writeFileSync(path.join(home, 'plugins', 'known_marketplaces.json'), JSON.stringify({ lab: { source: { source: 'directory', path: dir }, installLocation: dir } }));
  fs.writeFileSync(path.join(home, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'words@lab': [{ scope: 'user', installPath: path.join(dir, 'plugins', 'words'), version: '1.2.0' }] } }));
  const { sections } = buildProfile({ id: 't', name: 'T', home, folder: home }, { brands: ['claude'] });
  const s = sections.find((x) => x.id === 'sources');
  assert.ok(s.addSource);
  const [src, list] = s.groups;
  assert.equal(src.items[0].name, 'lab');
  assert.match(src.items[0].note, /3 plugins, 1 installed/);
  assert.deepEqual(src.items[0].actions.map((a) => a.kind), ['source-update', 'source-remove']);
  assert.match(src.items[0].actions[1].confirm, /also uninstalls the 1 plugin/);
  assert.equal(list.title, 'Plugins in lab');
  const by = Object.fromEntries(list.items.map((i) => [i.name, i]));
  assert.equal(by.words.badge, 'installed'); assert.deepEqual(by.words.actions, []);
  assert.equal(by.runner.actions[0].key, 'runner@lab');
  assert.match(by.runner.actions[0].confirm, /runs code on this computer: hooks/);
  assert.match(by.far.actions[0].confirm, /seen only once it is installed/);
  assert.equal(s.count, 4, 'one source and three plugins');
});
