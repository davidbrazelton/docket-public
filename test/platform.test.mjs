// What differs between Windows and macOS, tried for each platform on whatever computer runs the tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openCommand, folderOpenCommand, toolFolders, pathRe, isFullPath, exampleFolder, macTerminalScript, macTerminalOpen, terminalShells, psTerminalScript, cmdTerminalScript, windowsTerminalCommand, processListCommand, parseProcessList, powerWatchCommand, powerEvent, vsCodePaths, vswhereCommand, solutionIn, editorCommand, trashCommand, parseTrashOutput, trash, startupReadCommand, parseStartupRead, startupFiles, startupState, startupNeeds, startupScriptCommand, isTestCopy, folderPickCommand, parseFolderPick, folderPickStart, treeListCommand, parseTreeList, descendants, killCommand, commandLineCommand, relaunchesApp, supervisedBy, leftBehind, envReadCommand, parseEnvRead, freshEnv, findNode,
  keyCodes, fitShot, shotArea, toScreen, screenScript, screenCommand, screenBadgeCommand, SCREEN_BADGE, cloudFolders, profilePathCandidates, batteryCommand, parseBattery } from '../platform.mjs';

test('cloudFolders on Windows: Google Drive on any drive letter first, then OneDrive, Dropbox and iCloud Drive', () => {
  const there = new Set(['H:\\My Drive', 'C:\\Users\\pat\\OneDrive', 'C:\\Users\\pat\\OneDrive - Acme', 'C:\\Users\\pat\\Dropbox', 'C:\\Users\\pat\\iCloudDrive']);
  const list = (d) => d === 'C:\\Users\\pat' ? ['Documents', 'Dropbox', 'OneDrive - Acme', 'OneDrive'] : [];
  const env = { OneDrive: 'C:\\Users\\pat\\OneDrive', OneDriveCommercial: 'C:\\Users\\pat\\OneDrive - Acme' };
  assert.deepEqual(cloudFolders({ platform: 'win32', home: 'C:\\Users\\pat', env, exists: (d) => there.has(d), list }), [
    { kind: 'google', name: 'Google Drive', path: 'H:\\My Drive' },
    { kind: 'onedrive', name: 'OneDrive', path: 'C:\\Users\\pat\\OneDrive' },
    { kind: 'onedrive', name: 'OneDrive (work)', path: 'C:\\Users\\pat\\OneDrive - Acme' },
    { kind: 'dropbox', name: 'Dropbox', path: 'C:\\Users\\pat\\Dropbox' },
    { kind: 'icloud', name: 'iCloud Drive', path: 'C:\\Users\\pat\\iCloudDrive' }]);
  assert.deepEqual(cloudFolders({ platform: 'win32', home: 'C:\\Users\\pat', env: {}, exists: (d) => d === 'C:\\Users\\pat\\My Drive' }),
    [{ kind: 'google', name: 'Google Drive', path: 'C:\\Users\\pat\\My Drive' }], 'Drive mirrored to the home folder');
  assert.deepEqual(cloudFolders({ platform: 'win32', home: 'C:\\Users\\pat', env: {}, exists: () => false }), []);
});

test('cloudFolders on a Mac: each service in ~/Library/CloudStorage, Google Drive first', () => {
  const cs = '/Users/pat/Library/CloudStorage';
  const there = new Set([`${cs}/GoogleDrive-pat@acme.com/My Drive`, `${cs}/OneDrive-Personal`, `${cs}/OneDrive-Acme`, `${cs}/Dropbox`, '/Users/pat/Library/Mobile Documents/com~apple~CloudDocs']);
  const list = (d) => d === cs ? ['OneDrive-Personal', 'Dropbox', 'GoogleDrive-pat@acme.com', 'OneDrive-Acme'] : [];
  assert.deepEqual(cloudFolders({ platform: 'darwin', home: '/Users/pat', env: {}, exists: (d) => there.has(d), list }).map((x) => `${x.name}: ${x.path}`), [
    `Google Drive: ${cs}/GoogleDrive-pat@acme.com/My Drive`,
    `OneDrive (work): ${cs}/OneDrive-Acme`,
    `OneDrive: ${cs}/OneDrive-Personal`,
    `Dropbox: ${cs}/Dropbox`,
    'iCloud Drive: /Users/pat/Library/Mobile Documents/com~apple~CloudDocs']);
  assert.deepEqual(cloudFolders({ platform: 'darwin', home: '/Users/pat', env: {}, exists: (d) => d === '/Users/pat/Dropbox' }).map((x) => x.path), ['/Users/pat/Dropbox'], 'older Dropbox');
});

test('profilePathCandidates: Windows and Mac paths both ways, the home folder mapped to this one', () => {
  const win = { platform: 'win32', home: 'C:\\Users\\pat' }, mac = { platform: 'darwin', home: '/Users/pat' };
  assert.deepEqual(profilePathCandidates('C:\\Users\\pat\\Work\\x', { from: win, platform: 'darwin', home: '/Users/pat' }), ['/Users/pat/Work/x']);
  assert.deepEqual(profilePathCandidates('C:/Projects/x', { from: win, platform: 'darwin', home: '/Users/pat' }), ['/Users/pat/Projects/x'], 'C:/Projects/x <-> ~/Projects/x');
  assert.deepEqual(profilePathCandidates('/Users/pat/Projects/x', { from: mac, platform: 'win32', home: 'C:\\Users\\pat' }), ['C:\\Users\\pat\\Projects\\x']);
  assert.deepEqual(profilePathCandidates('/opt/x', { from: mac, platform: 'win32', home: 'C:\\Users\\pat' }), ['C:\\opt\\x']);
  assert.deepEqual(profilePathCandidates('c:\\users\\PAT\\w', { from: win, platform: 'win32', home: 'C:\\Users\\sam' }), ['C:\\Users\\sam\\w', 'c:\\users\\PAT\\w'], 'another user name: this home first, Windows ignores case');
  assert.deepEqual(profilePathCandidates('D:\\Data', { from: win, platform: 'win32', home: 'C:\\Users\\sam' }), ['D:\\Data']);
  assert.deepEqual(profilePathCandidates('D:/Data', { from: win, platform: 'win32', home: 'C:\\Users\\sam' }), ['D:/Data'], 'kept as written on the same platform');
  assert.deepEqual(profilePathCandidates('/Users/pat/x', { from: mac, platform: 'darwin', home: '/Users/pat' }), ['/Users/pat/x']);
  assert.deepEqual(profilePathCandidates('', { from: mac, platform: 'darwin', home: '/Users/pat' }), []);
});

test('vsCodePaths: Code.exe for the user, for everyone, and beside a code.cmd on the PATH, on Windows', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\pat\\AppData\\Local', ProgramFiles: 'C:\\Program Files',
    PATH: 'C:\\Windows;D:\\Tools\\Microsoft VS Code\\bin;C:\\Other\\bin' };
  assert.deepEqual(vsCodePaths({ platform: 'win32', home: 'C:\\Users\\pat', env }), [
    'C:\\Users\\pat\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
    'C:\\Program Files\\Microsoft VS Code\\Code.exe',
    'D:\\Tools\\Microsoft VS Code\\Code.exe']);
});

test('vsCodePaths: the app in /Applications or ~/Applications on a Mac, code on the PATH on Linux', () => {
  assert.deepEqual(vsCodePaths({ platform: 'darwin', home: '/Users/pat', env: { PATH: '/usr/bin' } }),
    ['/Applications/Visual Studio Code.app', '/Users/pat/Applications/Visual Studio Code.app']);
  assert.deepEqual(vsCodePaths({ platform: 'linux', home: '/home/pat', env: { PATH: '/usr/bin:/snap/bin' } }), ['/usr/bin/code', '/snap/bin/code']);
});

test('vswhereCommand: the installer\'s vswhere.exe asked for the newest devenv.exe', () => {
  assert.deepEqual(vswhereCommand({ 'ProgramFiles(x86)': 'C:\\Program Files (x86)' }), {
    cmd: 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe',
    args: ['-latest', '-property', 'productPath', '-utf8', '-nologo'] });
});

test('solutionIn: the one .sln or .slnx at the top, else none (so the folder opens)', () => {
  assert.equal(solutionIn(['README.md', 'App.sln', 'src']), 'App.sln');
  assert.equal(solutionIn(['App.SLNX']), 'App.SLNX');
  assert.equal(solutionIn(['A.sln', 'B.sln']), null);
  assert.equal(solutionIn(['A.sln', 'A.slnx']), null);
  assert.equal(solutionIn(['package.json']), null);
});

test('editorCommand: the program with the path as one argument; open -a on a Mac', () => {
  assert.deepEqual(editorCommand({ exe: 'C:\\VS Code\\Code.exe', target: 'C:\\Work\\a b', platform: 'win32' }), { cmd: 'C:\\VS Code\\Code.exe', args: ['C:\\Work\\a b'] });
  assert.deepEqual(editorCommand({ exe: '/Applications/Visual Studio Code.app', target: '/Users/pat/a b', platform: 'darwin' }),
    { cmd: 'open', args: ['-a', '/Applications/Visual Studio Code.app', '/Users/pat/a b'] });
});

test('powerWatchCommand: hidden PowerShell on Windows, osascript on a Mac, none elsewhere', () => {
  const w = powerWatchCommand({ root: 'C:\\Docket', parentPid: 42, platform: 'win32' });
  assert.equal(w.cmd, 'powershell.exe');
  assert.deepEqual(w.args.slice(-4), ['-File', 'C:\\Docket\\power-watch.ps1', '-ParentPid', '42']);
  assert.ok(w.args.includes('Hidden') && w.stream === 'stdout');
  assert.deepEqual(powerWatchCommand({ root: '/Users/pat/docket', parentPid: 7, platform: 'darwin' }),
    { cmd: 'osascript', args: ['-l', 'JavaScript', '/Users/pat/docket/power-watch-mac.js', '7'], stream: 'stderr' });
  assert.equal(powerWatchCommand({ root: '/x', parentPid: 1, platform: 'linux' }), null);
});

test('powerEvent: the helper\'s words, with stray spaces and line ends; anything else is ignored', () => {
  assert.equal(powerEvent('sleep\r'), 'sleep');
  assert.equal(powerEvent(' Wake '), 'wake');
  assert.equal(powerEvent('shutdown'), 'shutdown');
  assert.equal(powerEvent('ready'), 'ready');
  assert.equal(powerEvent('Exception calling Run'), null);
});

test('openCommand: explorer.exe on Windows, as before', () => {
  assert.deepEqual(openCommand('C:\\Work\\a b.pdf', 'open', 'win32'), { cmd: 'explorer.exe', args: ['"C:\\Work\\a b.pdf"'], opts: { windowsVerbatimArguments: true } });
  assert.deepEqual(openCommand('C:\\Work\\a b.pdf', 'folder', 'win32').args, ['/select,"C:\\Work\\a b.pdf"']);
});

test('openCommand: open, and open -R to show it in Finder, on a Mac; the path is one argument, unquoted', () => {
  assert.deepEqual(openCommand('/Users/pat/Work/a b.pdf', 'open', 'darwin'), { cmd: 'open', args: ['/Users/pat/Work/a b.pdf'], opts: {} });
  assert.deepEqual(openCommand('/Users/pat/Work/a b.pdf', 'folder', 'darwin'), { cmd: 'open', args: ['-R', '/Users/pat/Work/a b.pdf'], opts: {} });
});

test('openCommand: xdg-open on Linux, which opens the folder for "show in folder"', () => {
  assert.deepEqual(openCommand('/home/pat/a.pdf', 'open', 'linux').args, ['/home/pat/a.pdf']);
  assert.deepEqual(openCommand('/home/pat/a.pdf', 'folder', 'linux'), { cmd: 'xdg-open', args: ['/home/pat'], opts: {} });
});

test('folderOpenCommand: open and open on a Mac and Linux, as before', () => {
  assert.deepEqual(folderOpenCommand('/Users/pat/Work/a b', 'darwin'), openCommand('/Users/pat/Work/a b', 'open', 'darwin'));
  assert.deepEqual(folderOpenCommand('/home/pat/a b', 'linux'), openCommand('/home/pat/a b', 'open', 'linux'));
});

const folderScript = (dir) => Buffer.from(folderOpenCommand(dir, 'win32').args.at(-1), 'base64').toString('utf16le');
test('folderOpenCommand: on Windows a hidden PowerShell, not detached, opens the folder and raises its window', () => {
  const { cmd, args, opts } = folderOpenCommand("C:\\Work\\it's a b", 'win32');
  assert.equal(cmd, 'powershell.exe');
  assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']);
  assert.deepEqual(opts, { windowsHide: true, detached: false });
  const script = folderScript("C:\\Work\\it's a b");
  assert.ok(script.startsWith(`$p = 'C:\\Work\\it''s a b'; `), script);
  assert.ok(script.includes('& explorer.exe $p'), script);
  assert.ok(script.includes('Document.Folder.Self.Path'), 'the window is matched by its folder');
  assert.ok(script.indexOf('mouse_event(1, 0, 0, 0') < script.indexOf('SetForegroundWindow($h)'), 'the mouse moves by nothing before the window is raised');
  assert.doesNotMatch(script, /keybd_event|SendKeys/, 'no key press, which could leave the browser menu selected');
});
test('folderOpenCommand: the Windows script is valid PowerShell', { skip: process.platform !== 'win32' && 'not Windows' }, () => {
  const check = `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseInput([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${Buffer.from(folderScript('C:\\Work\\a b'), 'utf16le').toString('base64')}')), [ref]$null, [ref]$e); $e.Count`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', check], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.stdout.trim(), '0', r.stdout + r.stderr);
});

test('toolFolders: WinGet, npm and the AWS tool on Windows, Homebrew on a Mac', () => {
  assert.deepEqual(toolFolders({ platform: 'win32', home: 'C:\\Users\\pat', env: { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\pat\\AppData\\Local', APPDATA: 'C:\\Users\\pat\\AppData\\Roaming' } }),
    ['C:\\Users\\pat\\.local\\bin', 'C:\\Program Files\\Amazon\\AWSCLIV2', 'C:\\Users\\pat\\AppData\\Local\\Microsoft\\WinGet\\Links', 'C:\\Users\\pat\\AppData\\Roaming\\npm']);
  assert.deepEqual(toolFolders({ platform: 'win32', home: 'C:\\Users\\pat', env: {} }), ['C:\\Users\\pat\\.local\\bin', 'C:\\Program Files\\Amazon\\AWSCLIV2']);
  assert.deepEqual(toolFolders({ platform: 'darwin', home: '/Users/pat', env: {} }), ['/Users/pat/.local/bin', '/opt/homebrew/bin', '/usr/local/bin']);
});

const found = (text, platform) => [...text.matchAll(pathRe(platform))].map((m) => m[0]);

test('pathRe on Windows finds drive-letter paths and nothing else, as before', () => {
  assert.deepEqual(found('Saved C:\\Work\\report.pdf and C:/Work/out/data.csv.', 'win32'), ['C:\\Work\\report.pdf', 'C:/Work/out/data.csv']);
  assert.deepEqual(found('see /Users/pat/report.pdf', 'win32'), []);
});

test('pathRe on a Mac finds paths from /, not web addresses or relative paths', () => {
  assert.deepEqual(found('Saved /Users/pat/Work/report.pdf and "/tmp/x/data.csv".', 'darwin'), ['/Users/pat/Work/report.pdf', '/tmp/x/data.csv']);
  assert.deepEqual(found('Open (/Users/pat/a.html), then /private/var/b.png', 'darwin'), ['/Users/pat/a.html', '/private/var/b.png']);
  assert.deepEqual(found('https://example.com/a/page.html and ./out/page.html and src/app/page.html and ~/x.pdf', 'darwin'), []);
  assert.deepEqual(found('Saved C:\\Work\\report.pdf', 'darwin'), []);
});

test('isFullPath: a drive letter on Windows, a leading / elsewhere', () => {
  assert.equal(isFullPath('C:\\a.pdf', 'win32'), true);
  assert.equal(isFullPath('/Users/a.pdf', 'win32'), false);
  assert.equal(isFullPath('/Users/a.pdf', 'darwin'), true);
  assert.equal(isFullPath('a.pdf', 'darwin'), false);
  assert.equal(isFullPath(undefined, 'darwin'), false);
  assert.equal(isFullPath(42, 'win32'), false);
});

test('exampleFolder: C:\\Work on Windows, the Work folder in the home folder on a Mac', () => {
  assert.equal(exampleFolder('win32', 'C:\\Users\\pat', 'Acme', 'claude-home'), 'C:\\Work\\Acme\\claude-home');
  assert.equal(exampleFolder('darwin', '/Users/pat', 'Acme', 'claude-home'), '/Users/pat/Work/Acme/claude-home');
  assert.equal(exampleFolder('darwin', '', 'grok_home', 'Acme'), '/Users/you/Work/grok_home/Acme');
});

const script = macTerminalScript({ dir: "/Users/pat/Work/O'Brien & co", name: 'Acme', note: 'Acme terminal. 100% yours.',
  vars: { CLAUDE_CONFIG_DIR: '/Users/pat/Work/Acme/claude-home', CLAUDE_CODE_USE_BEDROCK: '', AWS_PROFILE: 'acme', AWS_REGION: '', GH_CONFIG_DIR: '' } });

test('macTerminalScript: clears Claude\'s variables, sets the company\'s, goes to the folder, then leaves a shell open', () => {
  const lines = script.split('\n');
  assert.equal(lines[0], '#!/bin/zsh');
  assert.ok(lines.includes('rm -f "$0"'));
  assert.ok(lines.includes("export CLAUDE_CONFIG_DIR='/Users/pat/Work/Acme/claude-home'"));
  assert.ok(lines.includes("export AWS_PROFILE='acme'"));
  for (const k of ['CLAUDE_CODE_USE_BEDROCK', 'AWS_REGION', 'GH_CONFIG_DIR']) assert.ok(lines.includes(`unset ${k}`), k);
  // the clearing comes before the company's own CLAUDE_CONFIG_DIR is set
  assert.ok(lines.findIndex((l) => l.includes('ANTHROPIC')) < lines.findIndex((l) => l.startsWith('export CLAUDE_CONFIG_DIR')));
  assert.ok(lines.includes("cd '/Users/pat/Work/O'\\''Brien & co' || exit 1"));
  assert.ok(lines.some((l) => l.includes('100%% yours.')));
  assert.equal(lines.at(-2), 'exec "${SHELL:-/bin/zsh}" -l');
});

// Where zsh is installed (a Mac, most Linux), the script is checked for syntax, and the part that clears and sets
// the variables is run for real (without the cd and the shell it would leave open).
const zsh = spawnSync('zsh', ['-c', 'true']).status === 0;
test('macTerminalScript runs in zsh', { skip: !zsh && 'zsh is not installed here' }, () => {
  assert.equal(spawnSync('zsh', ['-n'], { input: script }).status, 0);
  const setup = script.split('\n').filter((l) => /^(for |export |unset )/.test(l)).join('\n') + '\nenv';
  const r = spawnSync('zsh', ['-f'], { input: setup, encoding: 'utf8', env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'x', CLAUDECODE: '1', CLAUDE_CODE_USE_BEDROCK: '1', GH_CONFIG_DIR: '/x' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^CLAUDE_CONFIG_DIR=\/Users\/pat\/Work\/Acme\/claude-home$/m);
  assert.match(r.stdout, /^AWS_PROFILE=acme$/m);
  assert.doesNotMatch(r.stdout, /ANTHROPIC_API_KEY|CLAUDECODE|CLAUDE_CODE_USE_BEDROCK|GH_CONFIG_DIR/);
});

test('terminalShells: PowerShell 5, 7 when installed and Command Prompt on Windows; Terminal and iTerm2 when installed on a Mac', () => {
  const ids = (p, found) => terminalShells(p, found).map((s) => s.id);
  assert.deepEqual(ids('win32', { pwsh: true }), ['powershell', 'pwsh', 'cmd']);
  assert.deepEqual(ids('win32', {}), ['powershell', 'cmd']);
  assert.deepEqual(terminalShells('win32', { pwsh: true }).map((s) => s.name), ['Windows PowerShell 5', 'PowerShell 7', 'Command Prompt']);
  assert.deepEqual(ids('darwin', { iterm: true }), ['terminal', 'iterm']);
  assert.deepEqual(ids('darwin', {}), ['terminal']); // one choice: a plain button, no menu
  assert.deepEqual(ids('linux', { iterm: true }), ['terminal']);
});

test('macTerminalOpen: Terminal or iTerm2 through open on a Mac, x-terminal-emulator elsewhere', () => {
  assert.deepEqual(macTerminalOpen('terminal', '/tmp/a.command', 'darwin'), { cmd: 'open', args: ['-a', 'Terminal', '/tmp/a.command'] });
  assert.deepEqual(macTerminalOpen('iterm', '/tmp/a.command', 'darwin'), { cmd: 'open', args: ['-a', 'iTerm', '/tmp/a.command'] });
  assert.deepEqual(macTerminalOpen('terminal', '/tmp/a.command', 'linux'), { cmd: 'x-terminal-emulator', args: ['-e', '/tmp/a.command'] });
});

const winJob = { dir: "C:\\Work\\O'Brien & co (100%)", name: 'Acme & co', note: 'Acme terminal. 100% yours.',
  vars: { CLAUDE_CONFIG_DIR: 'C:\\Work\\Acme\\claude-home', CLAUDE_CODE_USE_BEDROCK: '', AWS_PROFILE: 'acme', AWS_REGION: '', GH_CONFIG_DIR: '' } };
const decode = (cmd) => Buffer.from(cmd.match(/-EncodedCommand (\S+)/)[1], 'base64').toString('utf16le');

test('windowsTerminalCommand: each shell, in Windows Terminal when it is there', () => {
  const ps = psTerminalScript(winJob);
  const five = windowsTerminalCommand({ shell: 'powershell', script: ps, wt: true });
  assert.match(five, /^start "" wt\.exe -w new -d \. powershell\.exe -NoLogo -NoExit -EncodedCommand \S+$/);
  assert.equal(decode(five), ps);
  assert.match(windowsTerminalCommand({ shell: 'pwsh', script: ps, wt: false }), /^start "" pwsh\.exe -NoLogo -NoExit -EncodedCommand /);
  assert.match(windowsTerminalCommand({ shell: 'pwsh', script: ps, exe: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', wt: true }),
    /^start "" wt\.exe -w new -d \. "C:\\Program Files\\PowerShell\\7\\pwsh\.exe" -NoLogo /);
  assert.equal(windowsTerminalCommand({ shell: 'cmd', file: 'C:\\Temp\\t.cmd', wt: false }), 'start "" cmd.exe /k "C:\\Temp\\t.cmd"');
  assert.equal(windowsTerminalCommand({ shell: 'cmd', file: 'C:\\Temp\\t.cmd', wt: true }), 'start "" wt.exe -w new -d . cmd.exe /k "C:\\Temp\\t.cmd"');
});

test('psTerminalScript: clears Claude\'s variables, sets the company\'s, goes to the folder and comes to the front', () => {
  const lines = psTerminalScript(winJob).split('\n');
  assert.match(lines[0], /\^\(CLAUDE\|ANTHROPIC\|USE_LOCAL_OAUTH\|USE_STAGING_OAUTH\|CODEX_\|GROK_\|DOCKET_\)/);
  assert.ok(lines.includes("$env:CLAUDE_CONFIG_DIR = 'C:\\Work\\Acme\\claude-home'"));
  for (const k of ['CLAUDE_CODE_USE_BEDROCK', 'AWS_REGION', 'GH_CONFIG_DIR']) assert.ok(lines.includes(`Remove-Item env:${k} -ErrorAction SilentlyContinue`), k);
  assert.ok(lines.includes("Set-Location -LiteralPath 'C:\\Work\\O''Brien & co (100%)'"));
  assert.ok(lines.some((l) => l.includes('SetForegroundWindow($h)')));
  assert.ok(lines.includes("$Host.UI.RawUI.WindowTitle = 'Docket · Acme & co'"));
});

test('cmdTerminalScript: the same steps for Command Prompt, with cmd\'s special characters escaped', () => {
  const text = cmdTerminalScript({ ...winJob, tag: 'Docket 123' });
  assert.ok(!/[^\r]\n/.test(text), 'CRLF line ends');
  const lines = text.split('\r\n');
  assert.ok(lines.includes('chcp 65001 >nul'));
  assert.ok(lines.includes(`for /f "delims==" %%v in ('set ANTHROPIC 2^>nul') do set "%%v="`));
  assert.ok(lines.indexOf(`for /f "delims==" %%v in ('set CLAUDE 2^>nul') do set "%%v="`) < lines.indexOf('set "CLAUDE_CONFIG_DIR=C:\\Work\\Acme\\claude-home"'));
  assert.ok(lines.includes('set "AWS_REGION="'));
  assert.ok(lines.includes('cd /d "C:\\Work\\O\'Brien & co (100%%)"'));
  assert.ok(lines.includes('title Docket 123'));
  assert.ok(lines.includes('title Docket · Acme ^& co'));
  assert.ok(lines.includes('echo Acme terminal. 100%% yours.'));
  const front = lines.find((l) => l.startsWith('powershell.exe'));
  assert.match(decode(front), /^\$t = 'Docket 123'\n/);
  assert.equal(lines.at(-2), '(goto) 2>nul & del "%~f0"');
});

// On Windows the part of each script that clears and sets the variables is run for real.
const win = process.platform === 'win32';
test('cmdTerminalScript runs in cmd', { skip: !win && 'not Windows' }, async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const lines = cmdTerminalScript({ ...winJob, tag: 'Docket 123' }).split('\r\n');
  const setup = [...lines.filter((l) => /^(@echo|for |chcp|set )/.test(l)), 'set'].join('\r\n');
  const file = path.join(os.tmpdir(), `docket-test-${process.pid}.cmd`);
  fs.writeFileSync(file, setup);
  try {
    const r = spawnSync('cmd.exe', ['/d', '/c', file], { encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, ANTHROPIC_API_KEY: 'x', CLAUDECODE: '1', CLAUDE_CODE_USE_BEDROCK: '1', GH_CONFIG_DIR: 'C:\\x', DOCKET_ENGINE: 'claude', CODEX_HOME: 'C:\\c' } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^CLAUDE_CONFIG_DIR=C:\\Work\\Acme\\claude-home\r?$/m);
    assert.match(r.stdout, /^AWS_PROFILE=acme\r?$/m);
    assert.doesNotMatch(r.stdout, /ANTHROPIC_API_KEY|CLAUDECODE|CLAUDE_CODE_USE_BEDROCK|GH_CONFIG_DIR|DOCKET_|CODEX_|OLDCP/);
  } finally { fs.unlinkSync(file); }
});
// The AI program starts after the batch file has deleted itself, with the company's variables, in the folder.
test('cmdTerminalScript starts the AI program after the batch file ends', { skip: !win && 'not Windows' }, async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-test-'));
  const file = path.join(os.tmpdir(), `docket-test-run-${process.pid}.cmd`);
  const lines = cmdTerminalScript({ ...winJob, dir, tag: 'Docket 123', run: { exe: 'cmd.exe', args: ['/c', 'echo ran in %CD% as %AWS_PROFILE%'] } }).split('\r\n');
  fs.writeFileSync(file, lines.filter((l) => !/^(title|powershell)/.test(l)).join('\r\n'));
  try {
    const r = spawnSync('cmd.exe', ['/d', '/c', file], { encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH } });
    assert.match(r.stdout, new RegExp(`ran in ${dir.replace(/\\/g, '\\\\')} as acme`));
    assert.equal(fs.existsSync(file), false, 'the batch file deleted itself');
  } finally { fs.rmSync(file, { force: true }); fs.rmdirSync(dir); }
});
test('each terminal script starts the AI program last, if asked', () => {
  const run = { exe: 'C:\\Users\\pat\\.local\\bin\\claude.exe', args: [] };
  assert.equal(psTerminalScript({ ...winJob, run }).split('\n').at(-1), "& 'C:\\Users\\pat\\.local\\bin\\claude.exe'");
  assert.equal(psTerminalScript(winJob).split('\n').at(-1).startsWith('Write-Host'), true);
  assert.equal(cmdTerminalScript({ ...winJob, tag: 't', run }).split('\r\n').at(-2), '(goto) 2>nul & del "%~f0" & "C:\\Users\\pat\\.local\\bin\\claude.exe"');
  const mac = macTerminalScript({ ...winJob, dir: '/Users/pat', run: { exe: "/Users/pat/.grok/bin/grok", args: ["it's"] } }).split('\n');
  assert.equal(mac.at(-3), "trap : INT; '/Users/pat/.grok/bin/grok' 'it'\\''s'; trap - INT");
  assert.equal(mac.at(-2), 'exec "${SHELL:-/bin/zsh}" -l');
});
test('psTerminalScript runs in PowerShell', { skip: !win && 'not Windows' }, () => {
  const setup = psTerminalScript(winJob).split('\n').filter((l) => /^(Get-ChildItem|\$env:|Remove-Item env:)/.test(l)).join('\n')
    + "\nGet-ChildItem env: | ForEach-Object { $_.Name + '=' + $_.Value }";
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(setup, 'utf16le').toString('base64')],
    { encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: 'x', CLAUDECODE: '1', CLAUDE_CODE_USE_BEDROCK: '1', GH_CONFIG_DIR: 'C:\\x' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^CLAUDE_CONFIG_DIR=C:\\Work\\Acme\\claude-home\r?$/m);
  assert.doesNotMatch(r.stdout, /ANTHROPIC_API_KEY|CLAUDECODE|CLAUDE_CODE_USE_BEDROCK|GH_CONFIG_DIR/);
});

test('processListCommand: one PowerShell call on Windows, ps elsewhere', () => {
  const w = processListCommand('win32');
  assert.equal(w.cmd, 'powershell.exe');
  assert.match(w.args.at(-1), /Win32_Process.*ProcessId,ParentProcessId,Name,WorkingSetSize,KernelModeTime,UserModeTime.*ConvertTo-Json/);
  assert.deepEqual(processListCommand('darwin'), { cmd: 'ps', args: ['-axo', 'pid=,ppid=,rss=,time=,comm='] });
});

test('parseProcessList on Windows: the JSON list, or the single object PowerShell gives for one program', () => {
  assert.deepEqual(parseProcessList('[{"ProcessId":10,"ParentProcessId":4,"Name":"Claude.exe","WorkingSetSize":2048,"KernelModeTime":5000000,"UserModeTime":20000000},{"ProcessId":11,"ParentProcessId":10,"Name":"node.exe","WorkingSetSize":null}]', 'win32'),
    [{ pid: 10, ppid: 4, name: 'claude', mem: 2048, cpu: 2.5 }, { pid: 11, ppid: 10, name: 'node', mem: 0, cpu: 0 }]);
  assert.deepEqual(parseProcessList('{"ProcessId":10,"ParentProcessId":4,"Name":"chrome.exe","WorkingSetSize":5}', 'win32'), [{ pid: 10, ppid: 4, name: 'chrome', mem: 5, cpu: 0 }]);
  assert.deepEqual(parseProcessList('', 'win32'), []);
});

test('parseProcessList on a Mac: kilobytes to bytes, processor time to seconds, program paths with spaces', () => {
  const out = '    1     0  12000 2-01:00:05.50 /sbin/launchd\n  501   1  2048   1:02.25 /Users/pat/.local/bin/claude\n  502   501   100 0:00.00 /Applications/Google Chrome for Testing.app/Contents/Frameworks/Google Chrome for Testing Helper (Renderer)\n\n';
  assert.deepEqual(parseProcessList(out, 'darwin'), [
    { pid: 1, ppid: 0, name: 'launchd', mem: 12000 * 1024, cpu: 2 * 86400 + 3600 + 5.5 },
    { pid: 501, ppid: 1, name: 'claude', mem: 2048 * 1024, cpu: 62.25 },
    { pid: 502, ppid: 501, name: 'google chrome for testing helper (renderer)', mem: 100 * 1024, cpu: 0 },
  ]);
});

test('processListCommand with command lines: CommandLine on Windows; on a Mac a second ps after a line of its own', () => {
  assert.match(processListCommand('win32', { commands: true }).args.at(-1), /UserModeTime,CommandLine \| ConvertTo-Json/);
  assert.doesNotMatch(processListCommand('win32').args.at(-1), /CommandLine/);
  assert.deepEqual(processListCommand('darwin', { commands: true }),
    { cmd: '/bin/sh', args: ['-c', 'ps -axo pid=,ppid=,rss=,time=,comm= && echo --docket-args-- && ps -axww -o pid=,args='] });
});

test('parseProcessList with command lines: cmd on each program, on Windows and a Mac', () => {
  assert.deepEqual(parseProcessList('[{"ProcessId":10,"ParentProcessId":4,"Name":"node.exe","WorkingSetSize":1,"CommandLine":"node C:\\\\Docket\\\\runner.mjs"},{"ProcessId":4,"ParentProcessId":0,"Name":"System","WorkingSetSize":1,"CommandLine":null}]', 'win32'),
    [{ pid: 10, ppid: 4, name: 'node', mem: 1, cpu: 0, cmd: 'node C:\\Docket\\runner.mjs' }, { pid: 4, ppid: 0, name: 'system', mem: 1, cpu: 0, cmd: '' }]);
  const out = '  501   1  2048   1:02.25 /Users/pat/.local/bin/claude\n  502   501   100 0:00.00 /Applications/Google Chrome for Testing.app/Contents/Frameworks/Google Chrome for Testing Helper (Renderer)\n  503   1  10 0:00.00 /usr/local/bin/node\n'
    + '--docket-args--\n  501 /Users/pat/.local/bin/claude --session-id=abc\n  502 /Applications/Google Chrome for Testing.app/Contents/Frameworks/Google Chrome for Testing Helper (Renderer) --type=renderer\n';
  assert.deepEqual(parseProcessList(out, 'darwin').map((p) => [p.pid, p.name, p.cmd]), [
    [501, 'claude', '/Users/pat/.local/bin/claude --session-id=abc'],
    [502, 'google chrome for testing helper (renderer)', '/Applications/Google Chrome for Testing.app/Contents/Frameworks/Google Chrome for Testing Helper (Renderer) --type=renderer'],
    [503, 'node', ''], // ended between the two ps
  ]);
});

// The real command on this computer gives a list that holds this test's own program.
test('processListCommand with command lines runs here and gives this program its own', () => {
  const { cmd, args } = processListCommand(process.platform, { commands: true });
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 << 20 });
  assert.equal(r.status, 0, r.stderr);
  const me = parseProcessList(r.stdout).find((p) => p.pid === process.pid);
  assert.ok(me && me.name === 'node' && /platform\.test\.mjs|node/.test(me.cmd), JSON.stringify(me));
});

test('processListCommand runs here and lists this program', () => {
  const { cmd, args } = processListCommand();
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 << 20 });
  assert.equal(r.status, 0, r.stderr);
  const me = parseProcessList(r.stdout).find((p) => p.pid === process.pid);
  assert.ok(me && me.name === 'node' && me.mem > 0, JSON.stringify(me));
});

test('trashCommand: the Recycle Bin through PowerShell on Windows, with each path quoted inside the script', () => {
  const { cmd, args } = trashCommand(['C:\\Home\\projects\\C--Work\\a.jsonl', "C:\\Home\\projects\\C--Work\\it's"], 'win32');
  assert.equal(cmd, 'powershell.exe');
  assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']);
  const script = Buffer.from(args[args.length - 1], 'base64').toString('utf16le');
  assert.doesNotMatch(script, /Remove-Item|\.Delete\(|InvokeVerb|OnlyErrorDialogs|DeleteDirectory/);
  assert.ok(script.includes(`Send-ToBin 'C:\\Home\\projects\\C--Work\\a.jsonl'`), script);
  assert.ok(script.includes(`Send-ToBin 'C:\\Home\\projects\\C--Work\\it''s'`), script);
  assert.ok(script.includes(`[char]9 + 'C:\\Home\\projects\\C--Work\\it''s'`), script); // the path it reports is the one given
});

test('trashCommand: SHFileOperation deletes to the Recycle Bin with no dialog, after a rename test for locks', () => {
  const script = Buffer.from(trashCommand(['C:\\x'], 'win32').args.at(-1), 'base64').toString('utf16le');
  assert.ok(script.includes('SHFileOperation'), script);
  assert.ok(script.includes('wFunc = 3'), 'FO_DELETE');
  // FOF_SILENT 0x4, FOF_NOCONFIRMATION 0x10, FOF_ALLOWUNDO 0x40, FOF_NOERRORUI 0x400, FOF_WANTNUKEWARNING 0x4000
  assert.equal(Number(script.match(/fFlags = (0x[0-9a-f]+)/i)[1]), 0x4 | 0x10 | 0x40 | 0x400 | 0x4000);
  assert.ok(script.includes('pFrom = p + "\\0\\0"'), 'pFrom ends in two nulls');
  assert.match(script, /\[IO\.Directory\]::Move\(\$p, \$probe\)[^\n]*catch \{ return "locked" \}/);
  assert.match(script, /DriveType -ne "Fixed"\) \{ return "nobin" \}/);
});

test('parseTrashOutput: Windows says per path; anything it did not mention failed; elsewhere all or nothing', () => {
  const paths = ['C:\\a', 'C:\\b b', "C:\\it's", 'C:\\d', 'C:\\e'];
  const out = 'recycled\tC:\\a\r\nlocked\tC:\\b b\r\ngone\tC:\\it\'s\r\nfailed 120\tC:\\d\r\n';
  assert.deepEqual(parseTrashOutput(paths, { ok: true, out }, 'win32').map((r) => r.status), ['recycled', 'locked', 'gone', 'failed', 'failed']);
  assert.deepEqual(parseTrashOutput(['/a', '/b'], { ok: true }, 'darwin'), [{ path: '/a', status: 'recycled' }, { path: '/b', status: 'recycled' }]);
  assert.deepEqual(parseTrashOutput(['/a'], { ok: false }, 'linux'), [{ path: '/a', status: 'failed' }]);
});

test('trashCommand: on Windows a folder in use is left and reported locked, with no dialog; the rest go to the Recycle Bin', { skip: process.platform !== 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-424-'));
  const busy = path.join(dir, 'busy'), free = path.join(dir, "free it's"), file = path.join(dir, 'f.txt');
  fs.mkdirSync(busy); fs.mkdirSync(path.join(free, 'sub'), { recursive: true }); fs.writeFileSync(path.join(free, 'sub', 'x.txt'), 'x'); fs.writeFileSync(file, 'y');
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { cwd: busy, stdio: 'ignore' });
  try {
    const paths = [busy, free, file, path.join(dir, 'none')];
    const { cmd, args } = trashCommand(paths);
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(parseTrashOutput(paths, { ok: true, out: r.stdout }).map((x) => x.status), ['locked', 'recycled', 'recycled', 'gone']);
    assert.ok(fs.existsSync(busy) && !fs.existsSync(free) && !fs.existsSync(file));
    assert.deepEqual(fs.readdirSync(dir), ['busy']); // no probe name left behind
  } finally { holder.kill(); spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 300']); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('trashCommand: Finder on a Mac, with the paths as arguments; gio trash on Linux', () => {
  const mac = trashCommand(['/Users/pat/h/projects/x/a.jsonl', '/Users/pat/h/projects/x/a'], 'darwin');
  assert.equal(mac.cmd, 'osascript');
  assert.deepEqual(mac.args.slice(-2), ['/Users/pat/h/projects/x/a.jsonl', '/Users/pat/h/projects/x/a']);
  assert.ok(mac.args.some((a) => a.includes('Finder" to delete')));
  assert.deepEqual(trashCommand(['/h/a'], 'linux'), { cmd: 'gio', args: ['trash', '--', '/h/a'] });
});

test('trashCommand: the Windows script runs, and does nothing for a path that is not there', { skip: process.platform !== 'win32' }, () => {
  const { cmd, args } = trashCommand(['C:\\no-such-folder-docket-409\\x.jsonl']);
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

// Starting Docket after a restart.
const PS = 'C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const lnk = (folder, extra = '') => `${PS} -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${folder}\\start-hidden.ps1"${extra}`;
const LAUNCHER = 'C:\\Users\\pat\\AppData\\Local\\Docket\\signin-launcher.ps1';
const viaLauncher = (folder) => `${PS} -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${LAUNCHER}" -Folder "${folder}"`;

test('startupState on Windows: the Startup shortcut to this folder starts it at sign-in; one to another folder does not count', () => {
  const root = 'C:\\Projects\\docket';
  assert.deepEqual(startupState({ platform: 'win32', root, found: { signIn: lnk(root, ' '), startMenu: lnk(root, ' -Open'), desktop: null, drive: 'Fixed' } }),
    { signIn: true, startMenu: true, desktop: false, repair: false, mode: 'signin' });
  // An old or moved folder, including one whose name starts the same.
  const moved = { signIn: lnk('C:\\Old\\docket'), startMenu: lnk('C:\\Projects\\docket-old', ' -Open'), desktop: null };
  assert.deepEqual(startupState({ platform: 'win32', root, found: moved }), { signIn: false, startMenu: false, desktop: false, repair: false, mode: 'neither' });
  assert.equal(startupState({ platform: 'win32', root, found: { signIn: viaLauncher('C:\\Projects\\docket-old'), launcher: 'x' }, launcher: 'x' }).signIn, false);
  // Shortcuts only; capitals and forward slashes do not matter on Windows; the old desktop icon ran start-docket.cmd.
  assert.equal(startupState({ platform: 'win32', root: 'c:/projects/Docket', found: { signIn: null, startMenu: lnk(root, ' -Open'), desktop: null } }).mode, 'shortcut');
  assert.equal(startupState({ platform: 'win32', root, found: { desktop: 'C:\\Projects\\docket\\start-docket.cmd ' } }).desktop, true);
  assert.equal(startupState({ platform: 'win32', root, found: undefined }).mode, 'neither');
});

test('startupState on Windows: through the launcher, sign-in works while its copy is there and up to date', () => {
  const root = 'V:\\Repos\\docket', found = (launcher) => ({ signIn: viaLauncher(root), startMenu: lnk(root, ' -Open'), desktop: null, launcher, drive: 'Network' });
  assert.deepEqual(startupState({ platform: 'win32', root, found: found('param()\r\nrun\r\n'), launcher: 'param()\nrun\n' }),
    { signIn: true, startMenu: true, desktop: false, repair: false, mode: 'signin' });
  // Missing, or older than the one in this folder: made again.
  assert.deepEqual(startupState({ platform: 'win32', root, found: found(null), launcher: 'param()' }),
    { signIn: false, startMenu: true, desktop: false, repair: true, mode: 'shortcut' });
  assert.equal(startupState({ platform: 'win32', root, found: found('old'), launcher: 'new' }).repair, true);
});

test('startupState on Windows: a Startup shortcut straight to a folder on a drive that connects late needs the launcher', () => {
  const root = 'V:\\Repos\\docket', direct = { signIn: lnk(root, ' '), startMenu: lnk(root, ' -Open'), desktop: null };
  // The computer this was found on: V: a mapped (network) drive or a subst drive.
  assert.deepEqual(startupState({ platform: 'win32', root, found: { ...direct, drive: 'Network' } }),
    { signIn: false, startMenu: true, desktop: false, repair: true, mode: 'shortcut' });
  assert.equal(startupState({ platform: 'win32', root, found: { ...direct, drive: 'Fixed', subst: true } }).repair, true);
  const unc = '\\\\server\\share\\docket';
  assert.equal(startupState({ platform: 'win32', root: unc, found: { signIn: lnk(unc, ' ') } }).repair, true);
  // A local drive is fine as it is.
  assert.equal(startupState({ platform: 'win32', root, found: { ...direct, drive: 'Fixed', subst: false } }).signIn, true);
});

test('startupState on a Mac: the LaunchAgent naming this folder\'s supervisor.mjs, and Docket.command running its start-docket.sh', () => {
  const root = '/Users/pat/A & B/docket';
  const plist = (f) => `<array><string>/opt/homebrew/bin/node</string><string>${f.replace(/&/g, '&amp;')}/supervisor.mjs</string></array>`;
  const command = (f) => `#!/bin/bash\nexec '${f.replace(/'/g, `'\\''`)}/start-docket.sh'\n`;
  assert.deepEqual(startupState({ platform: 'darwin', root, found: { signIn: plist(root), startMenu: command(root), desktop: null } }),
    { signIn: true, startMenu: true, desktop: false, repair: false, mode: 'signin' });
  assert.equal(startupState({ platform: 'darwin', root, found: { signIn: plist('/Users/pat/old/docket'), startMenu: null, desktop: null } }).mode, 'neither');
  const odd = "/Users/pat/pat's docket";
  assert.deepEqual(startupState({ platform: 'darwin', root: odd, found: { signIn: null, startMenu: null, desktop: command(odd) } }),
    { signIn: false, startMenu: false, desktop: true, repair: false, mode: 'shortcut' });
  assert.equal(startupState({ platform: 'darwin', root, found: { signIn: null, startMenu: command('/Users/pat/A & B/docket2'), desktop: null } }).mode, 'neither');
});

test('startupReadCommand: PowerShell reading the three Docket.lnk, the launcher and the drive on Windows, files on a Mac', () => {
  const { cmd, args } = startupReadCommand('win32', "V:\\Pat's\\docket");
  assert.equal(cmd, 'powershell.exe');
  const script = Buffer.from(args[args.length - 1], 'base64').toString('utf16le');
  for (const k of ["'Startup'", "'Programs'", "'Desktop'", "'Start Docket.lnk'", "'V:\\Pat''s\\docket'", 'signin-launcher.ps1', 'subst']) assert.ok(script.includes(k), k);
  assert.equal(startupReadCommand('darwin'), null);
  assert.deepEqual(startupFiles('/Users/pat'), { signIn: '/Users/pat/Library/LaunchAgents/local.docket.plist',
    startMenu: '/Users/pat/Applications/Docket.command', desktop: '/Users/pat/Desktop/Docket.command' });
  const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
  assert.deepEqual(parseStartupRead(b64({ Startup: 'C:\\José\\docket\\start-hidden.ps1', Programs: null, Desktop: null, Launcher: 'x', Drive: 'Network', Subst: false }) + '\r\n'),
    { signIn: 'C:\\José\\docket\\start-hidden.ps1', startMenu: null, desktop: null, launcher: 'x', drive: 'Network', subst: false });
  assert.deepEqual(parseStartupRead('not json'), { signIn: null, startMenu: null, desktop: null, launcher: null, drive: null, subst: false });
});

test('startupReadCommand: the Windows script runs and gives every answer', { skip: process.platform !== 'win32' }, () => {
  const { cmd, args } = startupReadCommand(process.platform, process.cwd());
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(Buffer.from(r.stdout.trim(), 'base64').toString('utf8'));
  assert.deepEqual(Object.keys(j).sort(), ['Desktop', 'Drive', 'Launcher', 'Programs', 'Startup', 'Subst']);
  assert.ok(['Fixed', 'Network', 'Removable'].includes(j.Drive), j.Drive);
  assert.equal(typeof j.Subst, 'boolean');
  assert.ok(j.Launcher === null || typeof j.Launcher === 'string', 'the launcher copy comes back as its text');
});

test('startupNeeds: the banner when nothing starts or opens Docket, unless the person said no or chose shortcuts', () => {
  const neither = { signIn: false, startMenu: false, desktop: false, repair: false, mode: 'neither' };
  assert.deepEqual(startupNeeds(neither, undefined), { ask: true, remake: null });
  assert.deepEqual(startupNeeds(neither, 'signin'), { ask: true, remake: null }); // chose it, then it went
  assert.deepEqual(startupNeeds(neither, 'none'), { ask: false, remake: null });
  assert.deepEqual(startupNeeds(neither, 'shortcut'), { ask: false, remake: 'shortcut' });
  assert.deepEqual(startupNeeds({ signIn: false, startMenu: true, desktop: false, mode: 'shortcut' }, 'shortcut'), { ask: false, remake: 'shortcut' });
  assert.deepEqual(startupNeeds({ signIn: false, startMenu: true, desktop: true, mode: 'shortcut' }, 'shortcut'), { ask: false, remake: null });
  assert.deepEqual(startupNeeds({ signIn: false, startMenu: true, desktop: false, mode: 'shortcut' }, undefined), { ask: false, remake: null });
  assert.deepEqual(startupNeeds({ signIn: true, startMenu: false, desktop: false, mode: 'signin' }, 'shortcut'), { ask: false, remake: null });
  assert.deepEqual(startupNeeds({ error: 'no PowerShell' }, undefined), { ask: false, remake: null });
});

test('startupNeeds: an install that will not start after a restart is made again by itself, whatever the choice', () => {
  const broken = { signIn: false, startMenu: true, desktop: false, repair: true, mode: 'shortcut' };
  for (const choice of [undefined, 'signin', 'none', 'shortcut']) assert.deepEqual(startupNeeds(broken, choice), { ask: false, remake: 'signin' });
  assert.equal(startupNeeds({ ...broken, startMenu: false, mode: 'neither' }, undefined).ask, false);
});

test('startupScriptCommand: the install and remove scripts, with the same choices on Windows and a Mac', () => {
  const w = (to, port) => startupScriptCommand({ platform: 'win32', root: 'C:\\D', to, port }).args.slice(5);
  assert.deepEqual(w('signin'), ['C:\\D\\install-windows.ps1']);
  assert.deepEqual(w('shortcut'), ['C:\\D\\install-windows.ps1', '-ShortcutOnly']);
  assert.deepEqual(w('shortcut', 4401), ['C:\\D\\install-windows.ps1', '-ShortcutOnly', '-Port', '4401']);
  assert.deepEqual(w('off', 4401), ['C:\\D\\remove-windows.ps1']);
  assert.equal(startupScriptCommand({ platform: 'win32', root: 'C:\\D', to: 'signin' }).cmd, 'powershell.exe');
  const m = (to, port) => startupScriptCommand({ platform: 'darwin', root: '/U/d', to, port });
  assert.deepEqual(m('signin'), { cmd: '/bin/bash', args: ['/U/d/install-mac.sh'] });
  assert.deepEqual(m('shortcut', 4401).args, ['/U/d/install-mac.sh', '--shortcut-only', '--port', '4401']);
  assert.deepEqual(m('off').args, ['/U/d/remove-mac.sh']);
  assert.equal(startupScriptCommand({ platform: 'linux', root: '/d', to: 'signin' }), null);
});

// install-mac.sh --shortcut-only needs neither launchd nor node, so any computer with bash can run it, into a
// home folder made for the test; what it writes must pass the same check the app makes.
const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0;
test('install-mac.sh --shortcut-only: its Docket.command files pass startupState, and remove-mac.sh takes them away', { skip: !hasBash }, async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-434-'));
  try {
    fs.mkdirSync(path.join(home, '.Trash'));
    const dir = path.join(import.meta.dirname, '..');
    const env = { ...process.env, HOME: home };
    const run = (file, ...args) => spawnSync('bash', [path.join(dir, file), ...args], { env, encoding: 'utf8' });
    const root = spawnSync('bash', ['-c', 'cd "$1" && pwd', 'x', dir], { encoding: 'utf8' }).stdout.trim();
    let r = run('install-mac.sh', '--shortcut-only', '--port', '4401');
    assert.equal(r.status, 0, r.stderr);
    const read = (...p) => { try { return fs.readFileSync(path.join(home, ...p), 'utf8'); } catch { return null; } };
    const found = () => ({ signIn: read('Library', 'LaunchAgents', 'local.docket.plist'), startMenu: read('Applications', 'Docket.command'), desktop: read('Desktop', 'Docket.command') });
    assert.deepEqual(startupState({ platform: 'darwin', root, found: found() }), { signIn: false, startMenu: true, desktop: true, repair: false, mode: 'shortcut' });
    assert.match(found().desktop, /^export PORTAL_PORT=4401$/m);
    r = run('remove-mac.sh');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(found(), { signIn: null, startMenu: null, desktop: null });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// signin-launcher.ps1, run from a copy in a folder of its own as at sign-in, against a stand-in Docket folder
// whose start-hidden.ps1 only leaves a mark.
test('signin-launcher.ps1: waits for a Docket folder that appears late, runs its start-hidden.ps1, and logs giving up', { skip: process.platform !== 'win32' }, async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const { spawn } = await import('node:child_process');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-434-'));
  try {
    const here = path.join(base, 'LocalAppData', 'Docket'), folder = path.join(base, 'late drive', 'docket');
    fs.mkdirSync(here, { recursive: true });
    fs.copyFileSync(path.join(import.meta.dirname, '..', 'signin-launcher.ps1'), path.join(here, 'signin-launcher.ps1'));
    const run = (...extra) => new Promise((resolve) => spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(here, 'signin-launcher.ps1'), '-Folder', folder, ...extra], { windowsHide: true }).on('exit', resolve));
    const log = () => fs.readFileSync(path.join(here, 'signin.log'), 'utf8');
    assert.equal(await run('-WaitSeconds', '1'), 1);
    assert.match(log(), /gave up: .*start-hidden\.ps1 was not there after 1 seconds/);
    // The folder turns up a few seconds after sign-in.
    const waiting = run('-Port', '4499', '-WaitSeconds', '60');
    await new Promise((r) => setTimeout(r, 3000));
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'start-hidden.ps1'), 'param([switch]$Open, [int]$Port = 4400)\nSet-Content -LiteralPath (Join-Path $PSScriptRoot "ran.txt") -Value $Port\n');
    assert.equal(await waiting, 0);
    assert.equal(fs.readFileSync(path.join(folder, 'ran.txt'), 'utf8').trim(), '4499');
    assert.match(log(), /started Docket from .* after waiting \d+ seconds for the folder/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('trash: runs the Recycle Bin command for the platform and reads what it says; never a permanent delete', async () => {
  const ran = [];
  const run = async (cmd, args) => { ran.push([cmd, args]); return cmd === 'powershell.exe' ? { ok: true, out: 'recycled\tC:\\A\\home\nlocked\tC:\\A\\grok\n' } : { ok: true, out: '' }; };
  assert.deepEqual(await trash(['C:\\A\\home', 'C:\\A\\grok'], run, 'win32'), [{ path: 'C:\\A\\home', status: 'recycled' }, { path: 'C:\\A\\grok', status: 'locked' }]);
  assert.equal(ran[0][0], 'powershell.exe');
  const script = Buffer.from(ran[0][1].at(-1), 'base64').toString('utf16le');
  assert.ok(script.includes('SHFileOperation'));
  assert.doesNotMatch(script, /Remove-Item|\.Delete\(/);
  assert.deepEqual(await trash(['/Users/pat/Desks/A'], run, 'darwin'), [{ path: '/Users/pat/Desks/A', status: 'recycled' }]);
  assert.equal(ran[1][0], 'osascript');
  assert.ok(ran[1][1].some((a) => a.includes('"Finder" to delete')), 'the Finder moves it to the Trash');
  assert.equal(ran.length, 2);
  assert.deepEqual(await trash([], run, 'win32'), []);
  assert.equal(ran.length, 2, 'an empty list runs nothing');
  assert.deepEqual(await trash(['/x'], async () => { throw new Error('no osascript'); }, 'darwin'), [{ path: '/x', status: 'failed' }]);
  assert.deepEqual(await trash(['C:\\x'], async () => ({ ok: true, out: '' }), 'win32'), [{ path: 'C:\\x', status: 'failed' }]);
});

test('isTestCopy: a working copy in docket-work, or any port but 4400, is a test copy; the real Docket is not', () => {
  assert.equal(isTestCopy({ root: 'C:\\Work\\docket', port: 4400 }), false);
  assert.equal(isTestCopy({ root: '/Users/pat/docket' }), false);
  assert.equal(isTestCopy({ root: 'C:\\Work\\docket-work\\shift-first-edit', port: 4400 }), true);
  assert.equal(isTestCopy({ root: 'C:/Work/Docket-Work/fix/', port: 4400 }), true);
  assert.equal(isTestCopy({ root: '/Users/pat/docket-work/fix' }), true);
  assert.equal(isTestCopy({ root: 'C:\\Work\\docket', port: 4401 }), true);
  assert.equal(isTestCopy({ root: '/Users/pat/docket', port: '4401' }), true);
});

test('open-docket.ps1: opens Docket as an app window in a Chromium browser, or a plain tab when there is none', { skip: process.platform !== 'win32' }, () => {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(import.meta.dirname, '..', 'open-docket.ps1'), '-Print', '-Port', '4499'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout.trim(), /^(.+\\(chrome|msedge|brave|vivaldi)\.exe --app=http:\/\/localhost:4499|http:\/\/localhost:4499)$/i);
});

const decodePs = (args) => Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');

test('folderPickCommand: Windows asks the modern picker for a folder, from a hidden STA PowerShell, in front', () => {
  const { cmd, args } = folderPickCommand({ start: "C:\\Work\\Pat's", title: 'Choose a folder', platform: 'win32' });
  assert.equal(cmd, 'powershell.exe');
  assert.ok(args.includes('-STA') && args.includes('-NoProfile'));
  const script = decodePs(args);
  assert.match(script, /IFileDialog/, 'the modern picker, not FolderBrowserDialog');
  assert.doesNotMatch(script, /FolderBrowserDialog/);
  assert.match(script, /0x20/, 'FOS_PICKFOLDERS');
  assert.match(script, /'C:\\Work\\Pat''s'/, 'the start folder as one quoted PowerShell string');
  assert.match(script, /TopMost = \$true/);
  assert.match(script, /\[DocketPick\]::Front/);
  assert.match(script, /Add-Type -TypeDefinition @'\n[\s\S]*\n'@/, 'a here-string, closed at the start of a line');
  assert.match(decodePs(folderPickCommand({ platform: 'win32' }).args), /::Pick\(\$f\.Handle, '', 'Choose a folder'\)/);
});

test('folderPickCommand: choose folder in osascript on a Mac, with the start and title as arguments; zenity on Linux', () => {
  assert.deepEqual(folderPickCommand({ start: '/Users/pat/Work', title: 'Pick', platform: 'darwin' }), { cmd: 'osascript', args: ['-e', 'on run argv', '-e', 'activate',
    '-e', 'set f to choose folder with prompt (item 2 of argv) default location (POSIX file (item 1 of argv))', '-e', 'return POSIX path of f', '-e', 'end run', '/Users/pat/Work', 'Pick'] });
  assert.equal(folderPickCommand({ title: 'Pick', platform: 'darwin' }).args[5], 'set f to choose folder with prompt (item 2 of argv)', 'no start: the picker\'s own');
  assert.deepEqual(folderPickCommand({ start: '/home/pat', title: 'Pick', platform: 'linux' }), { cmd: 'zenity', args: ['--file-selection', '--directory', '--title=Pick', '--filename=/home/pat/'] });
});

test('parseFolderPick: the folder, Cancel, or what went wrong, per platform', () => {
  assert.deepEqual(parseFolderPick({ ok: true, out: 'C:\\Work\\Acme' }, 'win32'), { folder: 'C:\\Work\\Acme' });
  assert.deepEqual(parseFolderPick({ ok: true, out: 'D:\\' }, 'win32'), { folder: 'D:\\' });
  assert.deepEqual(parseFolderPick({ ok: true, out: '' }, 'win32'), { cancelled: true });
  assert.deepEqual(parseFolderPick({ ok: false, err: 'Add-Type : Cannot add type\r\nmore' }, 'win32'), { error: 'Add-Type : Cannot add type' });
  assert.deepEqual(parseFolderPick({ ok: true, out: '/Users/pat/Work/\n' }, 'darwin'), { folder: '/Users/pat/Work' });
  assert.deepEqual(parseFolderPick({ ok: true, out: '/\n' }, 'darwin'), { folder: '/' });
  assert.deepEqual(parseFolderPick({ ok: false, err: '0:52: execution error: User canceled. (-128)' }, 'darwin'), { cancelled: true });
  assert.deepEqual(parseFolderPick({ ok: false, err: 'osascript: not found' }, 'darwin'), { error: 'osascript: not found' });
  assert.deepEqual(parseFolderPick({ ok: false, err: '' }, 'linux'), { cancelled: true });
  assert.deepEqual(parseFolderPick({ ok: false, err: '' }, 'win32'), { error: 'The folder picker did not open' });
});

test('folderPickStart: the typed folder, else the nearest one above it that exists, else none', () => {
  const have = (...dirs) => (p) => dirs.includes(p);
  assert.equal(folderPickStart('C:/Work/Acme', have('C:\\Work\\Acme'), 'win32'), 'C:\\Work\\Acme', 'slashes turned for the picker');
  assert.equal(folderPickStart(' "C:\\Work\\Acme\\new" ', have('C:\\Work\\Acme'), 'win32'), 'C:\\Work\\Acme');
  assert.equal(folderPickStart('Z:\\gone\\away', have(), 'win32'), '');
  assert.equal(folderPickStart('\\\\server\\share\\x', have('\\\\server\\share\\x'), 'win32'), '\\\\server\\share\\x');
  assert.equal(folderPickStart('Work\\Acme', have('Work\\Acme'), 'win32'), '', 'not a full path');
  assert.equal(folderPickStart('', have(''), 'win32'), '');
  assert.equal(folderPickStart('/Users/pat/Work/new', have('/Users/pat/Work'), 'darwin'), '/Users/pat/Work');
  assert.equal(folderPickStart('/nowhere', have(), 'darwin'), '');
  assert.equal(folderPickStart('~/Work', have('~/Work'), 'darwin'), '');
});

// ☰ > Restart Docket: everything below the app and the runner, and whether the app is started again.
test('parseTreeList: Windows JSON with start times, or the single object for one program; ps on a Mac', () => {
  assert.deepEqual(parseTreeList('[{"ProcessId":10,"ParentProcessId":4,"Start":500},{"ProcessId":11,"ParentProcessId":10,"Start":null}]', 'win32'),
    [{ pid: 10, ppid: 4, start: 500 }, { pid: 11, ppid: 10, start: 0 }]);
  assert.deepEqual(parseTreeList('{"ProcessId":10,"ParentProcessId":4,"Start":7}', 'win32'), [{ pid: 10, ppid: 4, start: 7 }]);
  assert.deepEqual(parseTreeList('', 'win32'), []);
  assert.deepEqual(parseTreeList('    1     0\n  501     1\n\n', 'darwin'), [{ pid: 1, ppid: 0, start: 0 }, { pid: 501, ppid: 1, start: 0 }]);
});

test('descendants: every depth below the roots, not the roots, and not a program that only took a dead parent\'s number', () => {
  const list = [
    { pid: 1, ppid: 0, start: 1 },     // the supervisor
    { pid: 10, ppid: 1, start: 10 },   // the app
    { pid: 20, ppid: 999, start: 20 }, // the runner (detached: its parent is gone)
    { pid: 21, ppid: 20, start: 21 }, { pid: 22, ppid: 21, start: 22 }, { pid: 23, ppid: 22, start: 23 }, // claude, an MCP server, its browser
    { pid: 11, ppid: 10, start: 11 },  // a helper the app started
    { pid: 30, ppid: 20, start: 5 },   // older than the runner: its parent was an earlier program numbered 20
    { pid: 31, ppid: 30, start: 6 },
    { pid: 40, ppid: 40, start: 40 },  // its own parent (Windows' idle process)
  ];
  assert.deepEqual(descendants(list, [20, 10]).sort((a, b) => a - b), [11, 21, 22, 23]);
  assert.deepEqual(descendants(list, [20]).sort((a, b) => a - b), [21, 22, 23]);
  assert.deepEqual(descendants(list, [404]), []);
  // Left out (the app's own listing helper): neither it nor what it started.
  assert.deepEqual(descendants(list, [20, 10], new Set([11, 22])).sort((a, b) => a - b), [21]);
  // No start times (a Mac): parent numbers alone.
  assert.deepEqual(descendants(list.map((p) => ({ ...p, start: 0 })), [20]).sort((a, b) => a - b), [21, 22, 23, 30, 31]);
});

test('leftBehind: a stopped program still running, and one its stopped parent started meanwhile; not a newcomer that took a number', () => {
  const before = [{ pid: 20, ppid: 1, start: 20 }, { pid: 21, ppid: 20, start: 21 }];
  const after = [
    { pid: 21, ppid: 20, start: 21 }, // did not stop
    { pid: 22, ppid: 21, start: 30 }, // started by 21 after the list was read
    { pid: 20, ppid: 5, start: 99 },  // a new program that got 20's number
    { pid: 50, ppid: 20, start: 15 }, // older than 20: not its child
    { pid: 60, ppid: 7, start: 60 },  // nothing to do with it
  ];
  assert.deepEqual(leftBehind(before, after, new Set([20, 21])), [21, 22]);
  assert.deepEqual(leftBehind(before, [], new Set([20, 21])), []);
});

test('killCommand: taskkill /F on Windows, kill -9 elsewhere, nothing for no programs', () => {
  assert.deepEqual(killCommand([5, 6], 'win32'), { cmd: 'taskkill.exe', args: ['/F', '/PID', '5', '/PID', '6'] });
  assert.deepEqual(killCommand([5, 6], 'darwin'), { cmd: 'kill', args: ['-9', '5', '6'] });
  assert.equal(killCommand([], 'win32'), null);
});

test('commandLineCommand and relaunchesApp: the supervisor and start-docket.cmd start the app again; a bare node does not', () => {
  assert.equal(commandLineCommand(42, 'win32').cmd, 'powershell.exe');
  assert.match(commandLineCommand(42, 'win32').args.at(-1), /ProcessId=42/);
  assert.deepEqual(commandLineCommand(42, 'darwin'), { cmd: 'ps', args: ['-o', 'command=', '-p', '42'] });
  assert.equal(relaunchesApp('"C:\\Program Files\\nodejs\\node.exe" "V:\\Repos\\docket\\supervisor.mjs"'), true);
  assert.equal(relaunchesApp('/opt/homebrew/bin/node /Users/pat/Docket/supervisor.mjs'), true);
  assert.equal(relaunchesApp('C:\\WINDOWS\\system32\\cmd.exe /c ""V:\\Repos\\docket\\start-docket.cmd" "'), true);
  assert.equal(relaunchesApp('/usr/bin/bash'), false);
  assert.equal(relaunchesApp(''), false);
});

// The real commands on this computer: the list holds this test's program below its parent, and this program's
// own command line is found.
test('treeListCommand and commandLineCommand run here', () => {
  const { cmd, args } = treeListCommand();
  const list = parseTreeList(spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 << 20 }).stdout);
  assert.ok(list.some((p) => p.pid === process.pid && p.ppid === process.ppid));
  assert.ok(descendants(list, [process.ppid]).includes(process.pid));
  const c = commandLineCommand(process.pid);
  assert.match(spawnSync(c.cmd, c.args, { encoding: 'utf8', windowsHide: true }).stdout, /node/i);
});

// ---------- screen and mouse control (#822) ----------
test('keyCodes: combinations as people write them, as Windows virtual keys and macOS key codes', () => {
  assert.deepEqual(keyCodes('ctrl+s', 'win32'), { codes: [0x11, 0x53], names: ['ctrl', 's'], typesText: false });
  assert.deepEqual(keyCodes('Ctrl + Shift + Esc', 'win32').codes, [0x11, 0x10, 0x1b]);
  assert.deepEqual(keyCodes('alt+f4', 'win32').codes, [0x12, 0x73]);
  assert.deepEqual(keyCodes('ctrl++', 'win32').names, ['ctrl', 'plus']);
  assert.deepEqual(keyCodes('cmd+s', 'darwin').codes, [55, 1]);
  assert.deepEqual(keyCodes('cmd+shift+z', 'darwin').codes, [55, 56, 6]);
  assert.deepEqual(keyCodes('enter', 'darwin').codes, [36]);
  assert.deepEqual(keyCodes('f5', 'darwin').codes, [96]);
  // a character, alone or with Shift, counts as typing (the password-field check); a shortcut or Enter does not
  assert.equal(keyCodes('a', 'win32').typesText, true);
  assert.equal(keyCodes('shift+a', 'win32').typesText, true);
  assert.equal(keyCodes('enter', 'win32').typesText, false);
  assert.equal(keyCodes('ctrl+v', 'win32').typesText, false);
  assert.throws(() => keyCodes('ctrl+banana', 'win32'), /Unknown key "banana"/);
  assert.throws(() => keyCodes('', 'win32'), /No key given/);
});

test('fitShot: scaled down to what the model reads (1568 on the long side, ~1.15 megapixels), never up', () => {
  assert.deepEqual(fitShot(1280, 720), { w: 1280, h: 720, scale: 1 });
  assert.equal(fitShot(3840, 1080).w, 1568);
  const big = fitShot(2560, 1600);
  assert.ok(big.w * big.h <= 1150000 && big.w <= 1568, `${big.w}×${big.h}`);
});

test('shotArea and toScreen: every monitor, one monitor, a region of the last shot, mapped back to the screen', () => {
  // a 125% main monitor and a second one to its left (negative x), as Windows numbers them in physical pixels
  const screens = [{ x: 0, y: 0, w: 2400, h: 1350, primary: true }, { x: -1920, y: 200, w: 1920, h: 1080 }];
  assert.deepEqual(shotArea(screens), { x: -1920, y: 0, w: 4320, h: 1350 });
  assert.deepEqual(shotArea(screens, { monitor: 2 }), { x: -1920, y: 200, w: 1920, h: 1080 });
  assert.throws(() => shotArea(screens, { monitor: 3 }), /no monitor 3/);
  const fit = fitShot(2400, 1350), shot = { x: 0, y: 0, w: 2400, h: 1350, iw: fit.w, ih: fit.h };
  assert.deepEqual(toScreen(shot, fit.w / 2, fit.h / 2), { x: 1200, y: 675 });
  const left = { x: -1920, y: 200, w: 1920, h: 1080, iw: 960, ih: 540 };
  assert.deepEqual(toScreen(left, 100, 50), { x: -1720, y: 300 });
  assert.deepEqual(shotArea(screens, { region: [100, 50, 200, 100], from: left }), { x: -1720, y: 300, w: 400, h: 200 });
  assert.throws(() => shotArea(screens, { region: [0, 0, 10, 10] }), /take a screen_shot/);
});

test('screenCommand: PowerShell with the request as base64 JSON on Windows, osascript JavaScript on a Mac', () => {
  const req = { op: 'type', text: 'Hello "world" & $env:PATH ü' };
  const win = screenCommand('C:\\D\\screen-control.ps1', req, 'win32');
  assert.equal(win.cmd, 'powershell.exe');
  assert.deepEqual(win.args.slice(0, 6), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\D\\screen-control.ps1']);
  assert.deepEqual(JSON.parse(Buffer.from(win.args[6], 'base64').toString('utf8')), req);
  assert.deepEqual(screenCommand('/d/screen-control.js', req, 'darwin'), { cmd: 'osascript', args: ['-l', 'JavaScript', '/d/screen-control.js', JSON.stringify(req)] });
  assert.throws(() => screenCommand('/d/x', req, 'linux'), /Windows and macOS only/);
  assert.equal(screenScript('linux'), null);
});

test('the screen scripts: DPI aware SendInput on Windows, CoreGraphics on a Mac, each request and the password check', () => {
  const win = screenScript('win32'), mac = screenScript('darwin');
  assert.equal(win.file, 'screen-control.ps1');
  assert.equal(mac.file, 'screen-control.js');
  for (const op of ['screens', 'shot', 'move', 'click', 'drag', 'scroll', 'type', 'keys']) {
    assert.ok(win.text.includes(`'${op}' {`), `Windows ${op}`);
    assert.ok(mac.text.includes(`r.op === '${op}'`), `Mac ${op}`);
  }
  assert.ok(win.text.includes('SetProcessDpiAwarenessContext(new IntPtr(-4))')); // per-monitor aware: physical pixels at any scaling
  assert.ok(win.text.includes('GetDpiForMonitor'));
  assert.ok(win.text.includes('SendInput'));
  assert.ok(win.text.includes('FocusedElement.Current.IsPassword'));
  for (const s of ['CGEventCreateMouseEvent', 'CGEventSetFlags', 'screencapture -x', 'backingScaleFactor', 'IsSecureEventInputEnabled']) assert.ok(mac.text.includes(s), s);
});

test('screenBadgeCommand: the on-screen Stop bar on Windows, closing with Docket; none on a Mac', () => {
  const c = screenBadgeCommand('C:\\D\\screen-badge.ps1', 'Docket: "Fix" is using the mouse', 'win32', 1234);
  assert.equal(Buffer.from(c.args[6], 'base64').toString('utf8'), 'Docket: "Fix" is using the mouse');
  assert.equal(c.args[7], '1234');
  assert.equal(screenBadgeCommand('/d/b', 'x', 'darwin'), null);
  assert.ok(SCREEN_BADGE.text.includes('ShowWithoutActivation')); // never takes the keyboard from the program being worked on
});

// The Windows script for real, on a Windows computer: the monitors it finds, read without moving or typing anything.
test('the Windows screen script lists the monitors in physical pixels', { skip: process.platform !== 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-'));
  try {
    const sc = screenScript('win32'), file = path.join(dir, sc.file);
    fs.writeFileSync(file, sc.text);
    const c = screenCommand(file, { op: 'screens' }, 'win32');
    const r = JSON.parse(spawnSync(c.cmd, c.args, { encoding: 'utf8', windowsHide: true }).stdout.trim());
    assert.equal(r.ok, true);
    assert.ok(r.screens.length >= 1 && r.screens.some((s) => s.primary));
    for (const s of r.screens) assert.ok(s.w > 0 && s.h > 0 && s.scale >= 1, JSON.stringify(s));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('batteryCommand and parseBattery on Windows: Win32_Battery, discharging or on mains, none on a desktop', () => {
  assert.equal(batteryCommand('win32').cmd, 'powershell.exe');
  assert.match(batteryCommand('win32').args.at(-1), /Win32_Battery/);
  assert.deepEqual(parseBattery('{"BatteryStatus":1,"EstimatedChargeRemaining":54}', 'win32'), { battery: true, onBattery: true, percent: 54 });
  assert.deepEqual(parseBattery('{"BatteryStatus":2,"EstimatedChargeRemaining":100}', 'win32'), { battery: true, onBattery: false, percent: 100 });
  assert.deepEqual(parseBattery('{"BatteryStatus":6,"EstimatedChargeRemaining":80}', 'win32'), { battery: true, onBattery: false, percent: 80 }, 'charging');
  assert.deepEqual(parseBattery('{"BatteryStatus":4,"EstimatedChargeRemaining":8}', 'win32'), { battery: true, onBattery: true, percent: 8 }, 'low');
  assert.deepEqual(parseBattery('[{"BatteryStatus":2,"EstimatedChargeRemaining":90},{"BatteryStatus":1,"EstimatedChargeRemaining":70}]', 'win32'),
    { battery: true, onBattery: true, percent: 80 }, 'two batteries');
  assert.deepEqual(parseBattery('', 'win32'), { battery: false, onBattery: null, percent: null }, 'a desktop prints nothing');
  assert.deepEqual(parseBattery('not json', 'win32'), { battery: false, onBattery: null, percent: null });
});

test('batteryCommand and parseBattery on a Mac: pmset -g batt, AC or battery, none on a desktop', () => {
  assert.deepEqual(batteryCommand('darwin'), { cmd: 'pmset', args: ['-g', 'batt'] });
  assert.equal(batteryCommand('linux'), null);
  assert.deepEqual(parseBattery("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=4653155)\t72%; discharging; 4:31 remaining present: true\n", 'darwin'),
    { battery: true, onBattery: true, percent: 72 });
  assert.deepEqual(parseBattery("Now drawing from 'AC Power'\n -InternalBattery-0 (id=4653155)\t100%; charged; 0:00 remaining present: true\n", 'darwin'),
    { battery: true, onBattery: false, percent: 100 });
  assert.deepEqual(parseBattery("Now drawing from 'AC Power'\n", 'darwin'), { battery: false, onBattery: null, percent: null }, 'a Mac mini');
  assert.deepEqual(parseBattery('anything', 'linux'), { battery: false, onBattery: null, percent: null });
});

test('supervisedBy: only supervisor.mjs is replaced by Restart Docket; start-docket.cmd and a bare node are not', () => {
  assert.equal(supervisedBy('"C:\\Program Files\\nodejs\\node.exe" "V:\\Repos\\docket\\supervisor.mjs" --after 1234'), true);
  assert.equal(supervisedBy('/opt/homebrew/bin/node /Users/pat/Docket/supervisor.mjs'), true);
  assert.equal(supervisedBy('C:\\WINDOWS\\system32\\cmd.exe /c ""V:\\Repos\\docket\\start-docket.cmd" "'), false);
  assert.equal(supervisedBy(''), false);
});

test('envReadCommand and parseEnvRead: the registry on Windows, nothing elsewhere', () => {
  const c = envReadCommand('win32');
  assert.equal(c.cmd, 'powershell.exe');
  assert.match(c.args.at(-1), /HKCU:\\Environment/);
  assert.match(c.args.at(-1), /Session Manager\\Environment/);
  assert.match(c.args.at(-1), /DoNotExpandEnvironmentNames/);
  assert.equal(envReadCommand('darwin'), null);
  assert.equal(envReadCommand('linux'), null);
  assert.deepEqual(parseEnvRead('{"user":{"name":"A","kind":"String","value":"1"},"system":[]}'), { user: [{ name: 'A', kind: 'String', value: '1' }], system: [], volatile: [] }, 'one value comes as an object');
  assert.deepEqual(parseEnvRead('{"user":[{"name":"B","kind":"ExpandString","value":null}],"system":null}'), { user: [{ name: 'B', kind: 'ExpandString', value: '' }], system: [], volatile: [] });
  assert.equal(parseEnvRead('not json'), null);
  assert.equal(parseEnvRead(''), null);
});

test('freshEnv on Windows: registry over the old values, expanded, user Path after system Path, deleted ones dropped', () => {
  const current = { Path: 'C:\\old', USERPROFILE: 'C:\\Users\\pat', SystemRoot: 'C:\\WINDOWS', OLD_SETTING: 'stale', GONE: 'was set', PORTAL_PORT: '4403', TEMP: 'C:\\stale' };
  const read = {
    system: [{ name: 'Path', kind: 'ExpandString', value: '%SystemRoot%\\system32;C:\\Program Files\\nodejs\\;' }, { name: 'OS', kind: 'String', value: 'Windows_NT' }],
    user: [{ name: 'Path', kind: 'ExpandString', value: '%USERPROFILE%\\.local\\bin;%NOT_SET%\\x' }, { name: 'TEMP', kind: 'ExpandString', value: '%USERPROFILE%\\AppData\\Local\\Temp' },
      { name: 'OLD_SETTING', kind: 'String', value: 'new' }, { name: 'ROOT', kind: 'String', value: 'D:\\notes' }, { name: 'NOTES', kind: 'ExpandString', value: '%root%\\today' }],
  };
  const f = freshEnv({ current, read, managed: ['GONE', 'OLD_SETTING'], platform: 'win32' });
  assert.deepEqual(f.env, {
    USERPROFILE: 'C:\\Users\\pat', SystemRoot: 'C:\\WINDOWS', PORTAL_PORT: '4403', OS: 'Windows_NT',
    Path: 'C:\\WINDOWS\\system32;C:\\Program Files\\nodejs\\;C:\\Users\\pat\\.local\\bin;%NOT_SET%\\x',
    OLD_SETTING: 'new', ROOT: 'D:\\notes', TEMP: 'C:\\Users\\pat\\AppData\\Local\\Temp', NOTES: 'D:\\notes\\today' });
  assert.deepEqual(f.dropped, ['GONE'], 'in the registry before, not now: deleted');
  assert.deepEqual(f.changed.sort(), ['NOTES', 'OLD_SETTING', 'OS', 'Path', 'ROOT', 'TEMP']);
  assert.deepEqual(f.names.sort(), ['GONE', 'NOTES', 'OLD_SETTING', 'OS', 'PATH', 'ROOT', 'TEMP'], 'kept, so the next start drops GONE again');
  // A name the registry never had stays, whatever the case of the name it is given in.
  const g = freshEnv({ current: { PATH: 'x', DOCKET_X: '1' }, read: { system: [{ name: 'Path', kind: 'String', value: 'C:\\a' }], user: [] }, platform: 'win32' });
  assert.deepEqual(g.env, { DOCKET_X: '1', Path: 'C:\\a' });
  assert.deepEqual(g.dropped, []);
  // The sign-in's own values come over the computer's USERNAME=SYSTEM, and the person's can use them.
  const v = freshEnv({ current: { USERNAME: 'pat', TEMP: 'C:\\Users\\PAT~1.X\\Temp', TMP: 'C:\\elsewhere' }, platform: 'win32', samePath: (a, b) => a.replace('PAT~1.X', 'pat.x') === b, read: {
    system: [{ name: 'USERNAME', kind: 'String', value: 'SYSTEM' }],
    volatile: [{ name: 'USERNAME', kind: 'String', value: 'pat' }, { name: 'USERPROFILE', kind: 'String', value: 'C:\\Users\\pat.x' }],
    user: [{ name: 'TEMP', kind: 'ExpandString', value: '%USERPROFILE%\\Temp' }, { name: 'TMP', kind: 'ExpandString', value: '%USERPROFILE%\\Temp' }] } });
  assert.deepEqual(v.env, { USERNAME: 'pat', USERPROFILE: 'C:\\Users\\pat.x', TEMP: 'C:\\Users\\PAT~1.X\\Temp', TMP: 'C:\\Users\\pat.x\\Temp' }, 'a short TEMP for the same folder stays');
  // The runtime\ folders of a Docket-Setup.exe copy go last.
  assert.equal(freshEnv({ current: {}, read: { system: [{ name: 'Path', kind: 'String', value: 'C:\\a;' }], user: [] }, extraPath: ['C:\\rt\\node', 'C:\\rt\\git\\cmd'], platform: 'win32' }).env.Path,
    'C:\\a;C:\\rt\\node;C:\\rt\\git\\cmd');
});

test('freshEnv on a Mac, or with nothing read: the environment as it is', () => {
  const current = { PATH: '/usr/bin', HOME: '/Users/pat' };
  const read = { system: [{ name: 'PATH', kind: 'String', value: '/x' }], user: [] };
  for (const [platform, r] of [['darwin', read], ['linux', read], ['win32', null]]) {
    const f = freshEnv({ current, read: r, managed: ['A'], platform });
    assert.deepEqual(f.env, current, platform);
    assert.notEqual(f.env, current, 'a copy');
    assert.deepEqual([f.changed, f.dropped, f.names], [[], [], ['A']]);
  }
});

test('findNode: the first node on the PATH, else the fallback', () => {
  const there = new Set(['C:\\Program Files\\nodejs\\node.exe', 'D:\\node2\\node.exe', '/opt/homebrew/bin/node']);
  const exists = (f) => there.has(f);
  assert.equal(findNode({ env: { Path: 'C:\\WINDOWS;"C:\\Program Files\\nodejs\\";D:\\node2;' }, exists, fallback: 'old', platform: 'win32' }), 'C:\\Program Files\\nodejs\\node.exe');
  assert.equal(findNode({ env: { Path: 'C:\\WINDOWS;relative' }, exists, fallback: 'old', platform: 'win32' }), 'old');
  assert.equal(findNode({ env: {}, exists, fallback: 'old', platform: 'win32' }), 'old');
  assert.equal(findNode({ env: { PATH: '/usr/bin:/opt/homebrew/bin' }, exists, fallback: 'old', platform: 'darwin' }), '/opt/homebrew/bin/node');
  assert.equal(findNode({ env: { Path: '/opt/homebrew/bin' }, exists, fallback: 'old', platform: 'darwin' }), 'old', 'names are case-sensitive on a Mac');
});

// The real registry on a Windows computer: the computer's Path is there, and the result starts a node.
test('envReadCommand and freshEnv run here', { skip: process.platform !== 'win32' }, () => {
  const c = envReadCommand();
  const r = spawnSync(c.cmd, c.args, { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  const read = parseEnvRead(r.stdout);
  assert.ok(read?.system.some((v) => v.name.toUpperCase() === 'PATH'), r.stderr);
  const f = freshEnv({ current: process.env, read });
  const node = findNode({ env: f.env, exists: (p) => fs.existsSync(p), fallback: process.execPath });
  assert.equal(spawnSync(node, ['-e', 'process.stdout.write("ok")'], { env: f.env, encoding: 'utf8' }).stdout, 'ok');
});
