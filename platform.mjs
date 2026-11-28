// What differs between Windows and macOS: showing a file, opening a terminal, finding file paths in a
// session's text, where installed programs live, and the example folders in error messages. Each takes the
// platform, so the tests can try every one on any computer. Linux gets the macOS answers, with xdg-open.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CLEARED } from './company-env.mjs';

// The program that opens a file in its default program (how 'open') or shows it in its folder (how 'folder').
// Windows: explorer.exe, whose /select, takes the path in quotes as one argument. macOS: open, or open -R to
// show it in Finder. Linux has no "show in folder", so it opens the folder.
export function openCommand(file, how, platform = process.platform) {
  if (platform === 'win32') return { cmd: 'explorer.exe', args: [how === 'folder' ? `/select,"${file}"` : `"${file}"`], opts: { windowsVerbatimArguments: true } };
  if (platform === 'darwin') return { cmd: 'open', args: how === 'folder' ? ['-R', file] : [file], opts: {} };
  return { cmd: 'xdg-open', args: [how === 'folder' ? path.posix.dirname(file) : file], opts: {} };
}

// The person's Downloads folder, where a copy of a remote desk's file is saved (#1232), under Docket\<desk>.
// Windows: %USERPROFILE%\Downloads (a Downloads folder moved elsewhere is not followed). macOS and Linux: ~/Downloads.
export function downloadsFolder({ platform = process.platform, home, env = process.env }) {
  if (platform === 'win32') return path.win32.join(env.USERPROFILE || home, 'Downloads');
  return path.posix.join(home, 'Downloads');
}

// The per-user folder for Docket's throwaway files that must not sit in Docket's folder or its data, such as the
// private browser's snapshots and screenshots (#1284): a session's tool writing into Docket's data looks to Claude
// Code's Auto mode like one tampering with its overseer. Windows: %LOCALAPPDATA%\Docket. macOS: ~/Library/Caches/Docket.
// Linux: $XDG_CACHE_HOME/docket, or ~/.cache/docket.
export function userCacheFolder({ platform = process.platform, home, env = process.env }) {
  if (platform === 'win32') return path.win32.join(env.LOCALAPPDATA || path.win32.join(env.USERPROFILE || home, 'AppData', 'Local'), 'Docket');
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Caches', 'Docket');
  return path.posix.join(env.XDG_CACHE_HOME || path.posix.join(home, '.cache'), 'docket');
}

// The program that opens a web address in the default browser. Windows: rundll32's FileProtocolHandler, which takes the
// address as it is (explorer.exe and start both mangle an address with & in it). macOS: open. Linux: xdg-open.
export function urlOpenCommand(url, platform = process.platform) {
  if (platform === 'win32') return { cmd: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url], opts: {} };
  return { cmd: platform === 'darwin' ? 'open' : 'xdg-open', args: [url], opts: {} };
}

// Where an installer puts a program that may not be on the PATH Docket started with.
// WinGet\Links is where winget puts a program like Codex (winget install OpenAI.Codex); AppData\Roaming\npm is where
// npm install -g puts one, which is on no PATH when Node.js came with Docket-Setup.exe rather than its own installer.
// Homebrew uses /opt/homebrew/bin on Apple silicon and /usr/local/bin on Intel, and a launchd start has neither on its PATH.
export function toolFolders({ platform = process.platform, home, env = process.env }) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform !== 'win32') return [p.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  return [p.join(home, '.local', 'bin'), p.join(env.ProgramFiles || 'C:\\Program Files', 'Amazon', 'AWSCLIV2'),
    ...(env.LOCALAPPDATA ? [p.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links')] : []),
    ...(env.APPDATA ? [p.join(env.APPDATA, 'npm')] : [])];
}

// A full file path with an extension, as written in a session's text. Windows: a drive letter (C:\… or C:/…).
// Elsewhere: a path from / (/Users/…, /tmp/…), not the tail of a web address or of a relative path.
const END = String.raw`\.[A-Za-z0-9]{1,5}(?=[\s"'\x60<>|),;:\]]|\.(?:\s|$)|$)`;
const WIN_PATH_RE = new RegExp(String.raw`[A-Za-z]:[\\/][^\s"'\x60<>|*?\r\n]+?` + END, 'g');
const POSIX_PATH_RE = new RegExp(String.raw`(?<![\w.:/~\\-])\/[^\s"'\x60<>|*?\r\n]+?` + END, 'g');
export const pathRe = (platform = process.platform) => platform === 'win32' ? WIN_PATH_RE : POSIX_PATH_RE;

// Where an @path line in a CLAUDE.md points (#1021): ~/ from the home folder, anything else from the importing file's
// folder. On Windows a path from \ or / with no drive letter (@/Acme/x.md) is on the importing file's drive.
export function importTarget(ref, fromFile, { home = '', platform = process.platform } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (/^~[\\/]/.test(ref)) return p.join(home, ref.slice(2));
  return p.resolve(p.dirname(fromFile), ref);
}
// One key per file however it is written: Windows and macOS ignore letter case in paths.
export const fileKey = (f, platform = process.platform) => {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const n = p.normalize(f);
  return platform === 'win32' || platform === 'darwin' ? n.toLowerCase() : n;
};
// Whether a path given by a tool (Write, present_file) is a full one on this platform.
export const isFullPath = (p, platform = process.platform) =>
  typeof p === 'string' && (platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(p) : p.startsWith('/'));

// What the present_file tool tells a session: where the user can show a file, and what a full path is here.
export function presentFileText(platform = process.platform) {
  const where = platform === 'win32' ? 'show it in File Explorer' : platform === 'darwin' ? 'show it in Finder' : 'show its folder';
  return `Show the user files you produced. They appear in the portal's Files list for this session and as a card in the chat, where the user can open each one or ${where}. `
    + (platform === 'win32' ? 'Use full Windows paths.' : 'Use full paths, starting with /.');
}

// An example folder for an error message: C:\Work\… on Windows, ~/Work/… (written out) elsewhere.
export function exampleFolder(platform, home, ...parts) {
  return platform === 'win32' ? path.win32.join('C:\\Work', ...parts) : path.posix.join(home || '/Users/you', 'Work', ...parts);
}

// A terminal clears the variables whose names start as CLEARED says (company-env.mjs): Claude's, Codex's and Grok's
// own, and Docket's, which would make its hooks act as if a claude run in the terminal were a Docket session.

// The zsh script a macOS terminal runs: it clears Claude's own variables, sets the company's sign-ins (vars: name ->
// value, or empty to unset), goes to the folder and prints what it is. Terminal.app opens a .command file as a
// script in a new window (so does iTerm2, macTerminalOpen); the script deletes itself once read, and then leaves the
// login shell ($SHELL: zsh, or bash for someone who chose it) open. run: { exe, args }, an AI program to start first
//; its Ctrl+C does not end the script, so the shell is still left open when it exits.
export function macTerminalScript({ dir, vars, name, note, run }) {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  return [
    '#!/bin/zsh',
    'rm -f "$0"',
    `for v in ${'${'}(k)parameters[(I)(${CLEARED.join('|')})*]}; do unset $v; done`,
    ...Object.entries(vars).map(([k, v]) => v ? `export ${k}=${q(v)}` : `unset ${k}`),
    `cd ${q(dir)} || exit 1`,
    `printf '\\033]0;%s\\007' ${q('Docket · ' + name)}`,
    `print -P ${q('%F{8}' + note.replace(/%/g, '%%') + '%f')}`,
    ...(run ? [`trap : INT; ${[run.exe, ...(run.args || [])].map(q).join(' ')}; trap - INT`] : []),
    'exec "${SHELL:-/bin/zsh}" -l',
    '',
  ].join('\n');
}

// How a Mac opens that script: Terminal or iTerm2 opens a .command file in a new window. Linux: x-terminal-emulator.
export function macTerminalOpen(shell, file, platform = process.platform) {
  if (platform === 'darwin') return { cmd: 'open', args: ['-a', shell === 'iterm' ? 'iTerm' : 'Terminal', file] };
  return { cmd: 'x-terminal-emulator', args: ['-e', file] };
}

// The terminals Docket can open, as [{ id, name }], the first being the default; found says which optional
// ones are installed here. Windows: Windows PowerShell 5, PowerShell 7 (pwsh) when installed, which reads its own
// profile (Documents\PowerShell) where 5 reads Documents\WindowsPowerShell, and Command Prompt. macOS: Terminal
// and, when installed, iTerm2, each running the login shell. Linux: whatever x-terminal-emulator is.
export function terminalShells(platform = process.platform, found = {}) {
  if (platform === 'win32') return [{ id: 'powershell', name: 'Windows PowerShell 5' }, ...(found.pwsh ? [{ id: 'pwsh', name: 'PowerShell 7' }] : []), { id: 'cmd', name: 'Command Prompt' }];
  if (platform === 'darwin') return [{ id: 'terminal', name: 'Terminal' }, ...(found.iterm ? [{ id: 'iterm', name: 'iTerm2' }] : [])];
  return [{ id: 'terminal', name: 'Terminal' }];
}

// The file names a program can have in a folder on the PATH: name.exe, or name.cmd as npm installs it, on Windows;
// the bare name elsewhere.
export const exeNames = (name, platform = process.platform) => platform === 'win32' ? [name + '.exe', name + '.cmd'] : [name];

// What brings a Windows terminal to the front, in PowerShell, for the window titled $t. Windows keeps a window that
// a background program (Docket) opens behind the one in use, so the window is found by a one-off title and comes
// forward by borrowing the front window's input.
const FRONT_API = `$w = Add-Type -PassThru -Name Front -Namespace Docket -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p); [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId(); [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);'`;
const FRONT_RAISE = `if ($h -ne [IntPtr]::Zero) { $a = $w::GetCurrentThreadId(); $b = $w::GetWindowThreadProcessId($w::GetForegroundWindow(), [IntPtr]::Zero); [void]$w::AttachThreadInput($a, $b, $true); [void]$w::SetForegroundWindow($h); [void]$w::AttachThreadInput($a, $b, $false) }`;
const FRONT_PS = [
  `try { ${FRONT_API}`,
  // [NullString]::Value, because PowerShell passes $null to a string as '', which matches no window;
  // and an empty handle is true in PowerShell, so it is compared with Zero.
  `  for ($i = 0; $i -lt 30 -and ($h = $w::FindWindow([NullString]::Value, $t)) -eq [IntPtr]::Zero; $i++) { Start-Sleep -Milliseconds 100 }`,
  `  ${FRONT_RAISE} } catch {}`,
];

// Opens a folder in the file manager and brings its window to the front. On Windows, explorer.exe started
// by Docket opens the folder behind the window in use, or reuses a window already showing it and leaves that
// behind, so a PowerShell opens it and then raises its window: the folder's window is found through
// Shell.Application (a new one if one appears within a second or so, else the one already open) and un-minimized.
// Borrowing the front window's input, as FRONT_PS does for a terminal, is not enough from a hidden PowerShell that
// Docket starts: Windows lets it take the front only once it has sent the last input, so it first moves the mouse
// by nothing (no key, which could leave the browser's menu selected). Not detached: a PowerShell started with no
// console at all runs nothing. Elsewhere it is openCommand's open.
export function folderOpenCommand(dir, platform = process.platform) {
  if (platform !== 'win32') return openCommand(dir, 'open', platform);
  const script = [
    `$p = ${psq(dir)}; $d = $p.TrimEnd('\\')`,
    `$s = New-Object -ComObject Shell.Application`,
    `$f = { @($s.Windows() | ForEach-Object { try { if ($_.Document.Folder.Self.Path.TrimEnd('\\') -eq $d) { [IntPtr][long]$_.HWND } } catch {} }) }`,
    `$old = & $f`,
    `& explorer.exe $p`,
    `try { ${FRONT_API}`,
    `  $h = [IntPtr]::Zero`,
    `  for ($i = 0; $i -lt 50 -and $h -eq [IntPtr]::Zero; $i++) { Start-Sleep -Milliseconds 100; $now = & $f; $new = @($now | Where-Object { $old -notcontains $_ }); if ($new.Count) { $h = $new[0] } elseif ($i -ge 12 -and $now.Count) { $h = $now[0] } }`,
    `  if ($h -ne [IntPtr]::Zero -and $w::IsIconic($h)) { [void]$w::ShowWindow($h, 9) }`,
    `  $w::mouse_event(1, 0, 0, 0, [UIntPtr]::Zero)`,
    `  ${FRONT_RAISE} } catch {}`,
  ].join('\n');
  return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePs(script)], opts: { windowsHide: true, detached: false } };
}
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
const encodePs = (script) => Buffer.from(script, 'utf16le').toString('base64');

// The PowerShell (5 or 7) a Windows terminal runs: it clears Claude's own variables, sets the company's sign-ins
// (vars: name -> value, or empty to unset), goes to the folder, comes to the front and says what it is, then starts
// run ({ exe, args }, an AI program) if given. -NoExit keeps the shell open after it.
export function psTerminalScript({ dir, vars, name, note, run }) {
  return [
    `Get-ChildItem env: | Where-Object Name -match '^(${CLEARED.join('|')})' | ForEach-Object { Remove-Item ('env:' + $_.Name) -ErrorAction SilentlyContinue }`,
    ...Object.entries(vars).map(([k, v]) => v ? `$env:${k} = ${psq(v)}` : `Remove-Item env:${k} -ErrorAction SilentlyContinue`),
    `Set-Location -LiteralPath ${psq(dir)}`,
    `$t = 'Docket ' + [guid]::NewGuid(); $Host.UI.RawUI.WindowTitle = $t`,
    ...FRONT_PS,
    `$Host.UI.RawUI.WindowTitle = ${psq('Docket · ' + name)}`,
    `Remove-Variable t, w, h, a, b, i -ErrorAction SilentlyContinue`,
    `Write-Host ${psq(note)} -ForegroundColor DarkGray`,
    ...(run ? [`& ${[run.exe, ...(run.args || [])].map(psq).join(' ')}`] : []),
  ].join('\n');
}

// The batch file a Command Prompt terminal runs: the same steps. cmd cannot bring its window forward, so a
// PowerShell in the same window does that part, for the one-off title tag. The file is read as UTF-8, for a folder
// or company name outside the code page, which is put back after; it deletes itself once run, and cmd /k leaves the
// prompt open. run ({ exe, args }, an AI program) starts on the same line as the deleting, after the batch file has
// ended, so its Ctrl+C does not ask "Terminate batch job?".
export function cmdTerminalScript({ dir, vars, name, note, tag, run }) {
  const pct = (s) => String(s).replace(/%/g, '%%');
  const bare = (s) => pct(s).replace(/[\^&|<>()]/g, '^$&'); // outside quotes, for title and echo
  return [
    '@echo off',
    `for /f "tokens=2 delims=:." %%c in ('chcp') do set "OLDCP=%%c"`,
    'chcp 65001 >nul',
    ...CLEARED.map((p) => `for /f "delims==" %%v in ('set ${p} 2^>nul') do set "%%v="`),
    ...Object.entries(vars).map(([k, v]) => `set "${k}=${v ? pct(v) : ''}"`),
    `cd /d "${pct(dir)}"`,
    `title ${tag}`,
    `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${encodePs([`$t = ${psq(tag)}`, ...FRONT_PS].join('\n'))}`,
    `title ${bare('Docket · ' + name)}`,
    `echo ${bare(note)}`,
    'chcp %OLDCP% >nul',
    'set "OLDCP="',
    '(goto) 2>nul & del "%~f0"' + (run ? ' & ' + [`"${pct(run.exe)}"`, ...(run.args || []).map((a) => /[\s&|<>^()]/.test(a) ? `"${pct(a)}"` : pct(a))].join(' ') : ''),
    '',
  ].join('\r\n');
}

// The command line, for cmd's start (run through `cmd.exe /d /c`), that opens a Windows terminal: shell 'cmd' runs
// the batch file (file); 'powershell' and 'pwsh' run the script as an encoded command, which keeps the folder name
// out of the command line. exe: where pwsh is, when it is not on the PATH. wt: Windows Terminal is installed. It may
// hand the window to a copy of itself already running, which does not pass the environment along, so each script
// sets it itself.
export function windowsTerminalCommand({ shell, script, file, exe, wt }) {
  const run = shell === 'cmd' ? `cmd.exe /k "${file}"`
    : `${shell === 'pwsh' ? (exe ? `"${exe}"` : 'pwsh.exe') : 'powershell.exe'} -NoLogo -NoExit -EncodedCommand ${encodePs(script)}`;
  return `start "" ${wt ? 'wt.exe -w new -d . ' : ''}${run}`;
}

// Every running program with its parent, memory and the processor time it has used so far, for ☰ > Memory and disk
// and the gauges. Windows: one PowerShell call (WorkingSetSize is in bytes; KernelModeTime and
// UserModeTime in 100-nanosecond steps). macOS and Linux: ps, whose rss is in kilobytes, whose time is
// [[dd-]hh:]mm:ss[.ss], and whose last column is the program path, which may hold spaces ("Google Chrome for
// Testing Helper (Renderer)"). commands: each program's command line too, for the breakdown in the window (only
// while it is open: the lines are long and hold the sessions' settings, so they never leave the app). On a Mac
// that is a second ps in the same call, after a line of its own, since comm and args both may hold spaces.
export const PS_SPLIT = '--docket-args--';
export function processListCommand(platform = process.platform, { commands = false } = {}) {
  if (platform === 'win32') return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command',
    `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,KernelModeTime,UserModeTime${commands ? ',CommandLine' : ''} | ConvertTo-Json -Compress`] };
  if (commands) return { cmd: '/bin/sh', args: ['-c', `ps -axo pid=,ppid=,rss=,time=,comm= && echo ${PS_SPLIT} && ps -axww -o pid=,args=`] };
  return { cmd: 'ps', args: ['-axo', 'pid=,ppid=,rss=,time=,comm='] };
}
// ps's time column in seconds.
const psSeconds = (t) => {
  const [d, rest] = t.includes('-') ? t.split('-') : [0, t];
  return rest.split(':').reduce((a, x) => a * 60 + Number(x), 0) + Number(d) * 86400 || 0;
};
// The output of processListCommand as [{ pid, ppid, name, mem, cpu }]: name is the program's own name in lower
// case, without its folder or .exe; mem is in bytes; cpu is the processor time used so far, in seconds; cmd, only
// when the command lines were asked for, is the command line ('' where the system does not say).
export function parseProcessList(text, platform = process.platform) {
  const name = (s) => String(s || '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
  if (platform === 'win32') {
    let l; try { l = JSON.parse(text); } catch { return []; }
    return (Array.isArray(l) ? l : [l]).filter(Boolean)
      .map((p) => ({ pid: Number(p.ProcessId), ppid: Number(p.ParentProcessId), name: name(p.Name), mem: Number(p.WorkingSetSize) || 0,
        cpu: ((Number(p.KernelModeTime) || 0) + (Number(p.UserModeTime) || 0)) / 1e7, ...('CommandLine' in p ? { cmd: p.CommandLine || '' } : {}) }));
  }
  const [list, args] = String(text).split(new RegExp(`^${PS_SPLIT}\\r?$`, 'm'));
  const cmds = new Map();
  for (const line of String(args ?? '').split('\n')) { const m = line.match(/^\s*(\d+)\s(.*?)\s*$/); if (m) cmds.set(Number(m[1]), m[2].trim()); }
  return list.split('\n').map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d:.-]+)\s+(.+?)\s*$/)).filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), name: name(m[5]), mem: Number(m[3]) * 1024, cpu: psSeconds(m[4]),
      ...(args !== undefined ? { cmd: cmds.get(Number(m[1])) || '' } : {}) }));
}

// The helper that hears the computer go to sleep, wake, or shut down: Node cannot hear these itself.
// Windows: a hidden PowerShell running power-watch.ps1 (SystemEvents), which writes to stdout. macOS:
// osascript running power-watch-mac.js (NSWorkspace), whose console.log writes to stderr. Elsewhere: none,
// and the clock check in server.mjs stands in. Each ends by itself when the Docket app (parentPid) is gone.
export function powerWatchCommand({ root, parentPid, platform = process.platform }) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32') return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', p.join(root, 'power-watch.ps1'), '-ParentPid', String(parentPid)], stream: 'stdout' };
  if (platform === 'darwin') return { cmd: 'osascript', args: ['-l', 'JavaScript', p.join(root, 'power-watch-mac.js'), String(parentPid)], stream: 'stderr' };
  return null;
}
// One line from the helper: 'sleep', 'wake', 'shutdown' (or 'ready' when it started), or null for anything else.
export function powerEvent(line) {
  const w = String(line).trim().toLowerCase();
  return ['sleep', 'wake', 'shutdown', 'ready'].includes(w) ? w : null;
}

// Where LiteLLM's `lite` program is, for a gateway company that doesn't name it. Its installer puts it in
// %USERPROFILE%\.litellm-cli\Scripts\lite.exe on Windows; on a Mac uv puts it in ~/.local/bin/lite. Else the PATH.
// PORTAL_LITE_EXE names the tests' stand-in. exists: whether a file is there (fs.existsSync, or a stand-in in tests).
export function findLite({ platform = process.platform, home, env = process.env, exists }) {
  if (env.PORTAL_LITE_EXE) return env.PORTAL_LITE_EXE;
  const p = platform === 'win32' ? path.win32 : path.posix;
  const spots = platform === 'win32' ? [p.join(env.USERPROFILE || home, '.litellm-cli', 'Scripts', 'lite.exe')] : [p.join(home, '.local', 'bin', 'lite'), '/opt/homebrew/bin/lite', '/usr/local/bin/lite'];
  return spots.find((f) => exists(f)) || (platform === 'win32' ? 'lite.exe' : 'lite');
}

// Where VS Code may be installed, first match wins. Windows: Code.exe itself, for the user's install, the
// one for every user, and beside a code.cmd on the PATH (its bin folder sits in the install folder); running
// Code.exe spares a trip through cmd, which mangles a folder name holding & or %. macOS: the app, opened with
// open -a. Linux: code on the PATH.
export function vsCodePaths({ platform = process.platform, home, env = process.env }) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const dirs = String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  if (platform === 'darwin') return [p.join('/Applications', 'Visual Studio Code.app'), ...(home ? [p.join(home, 'Applications', 'Visual Studio Code.app')] : [])];
  if (platform !== 'win32') return dirs.map((d) => p.join(d, 'code'));
  return [...(env.LOCALAPPDATA ? [p.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe')] : []),
    p.join(env.ProgramFiles || 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe'),
    ...dirs.filter((d) => p.basename(d).toLowerCase() === 'bin' && /code/i.test(d)).map((d) => p.join(p.dirname(d), 'Code.exe'))];
}
// The Visual Studio installer's own finder (Windows only): it prints the newest devenv.exe's full path.
export function vswhereCommand(env = process.env) {
  return { cmd: path.win32.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
    args: ['-latest', '-property', 'productPath', '-utf8', '-nologo'] };
}
// What Visual Studio opens for a folder: its one solution (.sln or .slnx) at the top, or else the folder itself.
export function solutionIn(names) {
  const sln = names.filter((n) => /\.slnx?$/i.test(n));
  return sln.length === 1 ? sln[0] : null;
}
// The command that opens a folder (or, for Visual Studio, a solution) in an editor found by vsCodePaths or vswhere.
// The path is one argument; on a Mac, open -a starts the app on it.
export function editorCommand({ exe, target, platform = process.platform }) {
  if (platform === 'darwin') return { cmd: 'open', args: ['-a', exe, target] };
  return { cmd: exe, args: [target] };
}

// Sends files and folders to the Recycle Bin (Windows) or the Trash (macOS), never deleting them for good (the
// Undo of Bring in past sessions, and the recycle tool). Windows: one PowerShell call, with the paths inside the
// encoded script so no name can break the command line, that never shows a dialog. Each path is first renamed to a
// sibling name and back, which fails while any program has a file in it open or works in it (a session's folder);
// such a path is left alone and reported "locked". The rest go through SHFileOperation with FOF_ALLOWUNDO
// (Recycle Bin), FOF_NOCONFIRMATION, FOF_NOERRORUI and FOF_SILENT, plus FOF_WANTNUKEWARNING so nothing too big for
// the Recycle Bin is deleted for good without asking. A drive with no Recycle Bin (a network share, a removable
// drive) is reported "nobin". One line per path comes back, "<status>\t<path>": parseTrashOutput reads them.
// macOS: Finder, which asks once for permission to be driven; the paths are osascript's arguments. Linux: gio trash.
const RECYCLE_PS = [
  '$ErrorActionPreference = "Stop"',
  "Add-Type -TypeDefinition @'",
  'using System; using System.Runtime.InteropServices;',
  'public static class DocketBin {',
  '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
  '  struct Op { public IntPtr hwnd; public uint wFunc; public string pFrom; public string pTo; public ushort fFlags; public bool fAnyOperationsAborted; public IntPtr hNameMappings; public string lpszProgressTitle; }',
  '  [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHFileOperation(ref Op op);',
  // FO_DELETE = 3; FOF_SILENT 0x4 | FOF_NOCONFIRMATION 0x10 | FOF_ALLOWUNDO 0x40 | FOF_NOERRORUI 0x400 | FOF_WANTNUKEWARNING 0x4000
  '  public static int Recycle(string p) { var op = new Op { wFunc = 3, pFrom = p + "\\0\\0", fFlags = 0x4454 }; int r = SHFileOperation(ref op); return r != 0 ? r : op.fAnyOperationsAborted ? -1 : 0; }',
  '}',
  "'@",
  'function Send-ToBin([string]$p) {',
  '  if (-not (Test-Path -LiteralPath $p)) { return "gone" }',
  '  $root = [IO.Path]::GetPathRoot($p)',
  '  if ($root.StartsWith("\\\\") -or ([IO.DriveInfo]::new($root)).DriveType -ne "Fixed") { return "nobin" }',
  '  $dir = Test-Path -LiteralPath $p -PathType Container',
  '  $p = $p.TrimEnd("\\"); $probe = "$p.docket-check-$PID"',
  '  try { if ($dir) { [IO.Directory]::Move($p, $probe) } else { [IO.File]::Move($p, $probe) } } catch { return "locked" }',
  '  try { if ($dir) { [IO.Directory]::Move($probe, $p) } else { [IO.File]::Move($probe, $p) } } catch { $p = $probe }',
  '  $r = [DocketBin]::Recycle($p)',
  '  if (Test-Path -LiteralPath $p) { return "failed $r" }',
  '  return "recycled"',
  '}',
];
export function trashCommand(paths, platform = process.platform) {
  if (platform === 'win32') {
    const one = (p) => `try { $s = Send-ToBin ${psq(p)} } catch { $s = 'failed' }; [Console]::Out.WriteLine($s + [char]9 + ${psq(p)})`;
    const script = [...RECYCLE_PS, ...paths.map(one)].join('\n');
    return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePs(script)] };
  }
  if (platform === 'darwin') return { cmd: 'osascript', args: ['-e', 'on run argv', '-e', 'repeat with p in argv', '-e', 'tell application "Finder" to delete (POSIX file (p as text) as alias)', '-e', 'end repeat', '-e', 'end run', ...paths] };
  return { cmd: 'gio', args: ['trash', '--', ...paths] };
}
// What became of each path given to trashCommand: [{ path, status }], status 'recycled', 'gone' (was not there),
// 'locked' (in use: try again later), 'nobin' (that drive has no Recycle Bin) or 'failed'. Windows says per path;
// on a Mac or Linux the command either worked for all of them (ok) or not.
export function parseTrashOutput(paths, { ok, out = '' }, platform = process.platform) {
  if (platform !== 'win32') return paths.map((p) => ({ path: p, status: ok ? 'recycled' : 'failed' }));
  const said = new Map();
  for (const line of String(out).split(/\r?\n/)) {
    const tab = line.indexOf('\t');
    if (tab > 0) said.set(line.slice(tab + 1), line.slice(0, tab).split(' ')[0]);
  }
  return paths.map((p) => ({ path: p, status: said.get(p) || 'failed' }));
}
// Sends paths to the Recycle Bin (the Trash on a Mac), never deleting anything for good: trashCommand run through
// run(cmd, args), which resolves { ok, out }, and read by parseTrashOutput. [{ path, status }].
export async function trash(paths, run, platform = process.platform) {
  if (!paths.length) return [];
  const { cmd, args } = trashCommand(paths, platform);
  let r; try { r = await run(cmd, args); } catch (e) { r = { ok: false, out: String(e?.message || e) }; }
  return parseTrashOutput(paths, r || { ok: false }, platform);
}

// Whether Docket starts again after this computer restarts. Three things count, each named Docket and each
// pointing at THIS folder (one from an old or moved folder does not count): signIn starts it at sign-in, startMenu
// and desktop open it, starting it first if needed. Windows: the scheduled task "Docket (<user name>)" that runs at
// sign-in (Task), or, where Windows would not make one, Docket.lnk in the Startup folder (which Windows runs only after
// every sign-in Run entry, minutes late on a busy computer); Docket.lnk in the Start menu (Programs), and Start
// Docket.lnk on the desktop, where a browser may have put its own Docket.lnk for a pinned page (the old desktop icon,
// Docket.lnk running start-docket.cmd, counts too). install-windows.ps1 makes them; they are read through PowerShell,
// which asks Windows where each folder is (the desktop may be in OneDrive). The sign-in one runs signin-launcher.ps1
// from %LOCALAPPDATA%\Docket, which waits for a Docket folder on a drive that connects late, so the same script also
// gives that copy (Launcher), the first line of the task-refused marker the install leaves beside it when Windows
// would not make the task (Refused: the TASK_SETUP it was refused at), and what kind of drive root is on (Drive, and
// Subst for a subst drive). port: a test copy's (install-windows.ps1 -Port), whose task and shortcuts carry the port
// in their names. macOS: the LaunchAgent install-mac.sh writes, and the Docket.command it puts in ~/Applications and
// on the desktop, read as files (startupFiles).
export function startupReadCommand(platform = process.platform, root = '', port = 4400) {
  if (platform !== 'win32') return null;
  const n = Number(port) !== 4400 ? ` ${Number(port)}` : '';
  const script = [
    `$ProgressPreference = 'SilentlyContinue'; $s = New-Object -ComObject WScript.Shell; $r = @{}; $q = [IO.Path]::GetPathRoot(${psq(root)})`,
    "$f = Join-Path $env:LOCALAPPDATA 'Docket\\signin-launcher.ps1'; $r.Launcher = if (Test-Path -LiteralPath $f) { [IO.File]::ReadAllText($f) } else { $null }",
    `$f = Join-Path $env:LOCALAPPDATA 'Docket\\task-refused${n}.txt'; $r.Refused = if (Test-Path -LiteralPath $f) { [string](Get-Content -LiteralPath $f -TotalCount 1) } else { $null }`,
    `$r.Task = try { $t = Get-ScheduledTask -TaskPath '\\' -TaskName "Docket${n} ($env:USERNAME)" -ErrorAction Stop; if ([string]$t.State -ne 'Disabled') { ($t.Actions | ForEach-Object { $_.Execute + ' ' + $_.Arguments }) -join "\`n" } } catch { $null }`,
    "$r.Drive = if ($q -like '\\\\*') { 'Network' } else { try { [string][IO.DriveInfo]::new($q).DriveType } catch { $null } }",
    "$r.Subst = [bool](subst | Where-Object { $q -and $_ -like ($q.Substring(0, 2) + '\\: =>*') })",
    "foreach ($k in 'Startup', 'Programs', 'Desktop') {",
    `  $l = @(if ($k -eq 'Desktop') { 'Start Docket${n}.lnk', 'Docket${n}.lnk' } else { 'Docket${n}.lnk' }) | ForEach-Object { Join-Path ([Environment]::GetFolderPath($k)) $_ } |`,
    "    Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { $x = $s.CreateShortcut($_); $x.TargetPath + ' ' + $x.Arguments }",
    "  $r[$k] = if ($l) { $l -join \"`n\" } else { $null } }",
    // As UTF-8 in base64, so a folder name outside the console's code page arrives whole.
    '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($r | ConvertTo-Json -Compress)))',
  ].join('\n');
  return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePs(script)] };
}
// What that prints, as { signIn, startMenu, desktop }: each the program and arguments a shortcut runs, or null
// (signIn is the Startup shortcut); task, the same for the sign-in task; and launcher, refused, drive and subst, as above.
export function parseStartupRead(text) {
  let r; try { r = JSON.parse(Buffer.from(String(text).trim(), 'base64').toString('utf8')); } catch { r = null; }
  return { signIn: r?.Startup || null, task: r?.Task || null, startMenu: r?.Programs || null, desktop: r?.Desktop || null,
    launcher: typeof r?.Launcher === 'string' ? r.Launcher : null, refused: r?.Refused ? String(r.Refused).trim() : null,
    drive: r?.Drive || null, subst: !!r?.Subst };
}
export function startupFiles(home) {
  const p = path.posix;
  return { signIn: p.join(home, 'Library', 'LaunchAgents', 'local.docket.plist'), startMenu: p.join(home, 'Applications', 'Docket.command'), desktop: p.join(home, 'Desktop', 'Docket.command') };
}
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
// A test copy: a working copy in docket-work, or any Docket on a port other than 4400. It must never set up
// how Docket starts: its install would point the Start menu and sign-in at the test copy, which has none of the
// person's desks or groups, so Docket would look wiped. Either path style, so the tests try both on any computer.
export function isTestCopy({ root, port = 4400 }) {
  const parts = String(root || '').split(/[\\/]+/).filter(Boolean);
  return Number(port) !== 4400 || (parts.length > 1 && parts[parts.length - 2].toLowerCase() === 'docket-work');
}
// The sign-in task's setup, as install-windows.ps1 has it ($taskSetup; a test checks they agree). A computer where
// Windows refused the task at this setup keeps the Startup shortcut without trying again at every start; raising it
// tries again everywhere once.
export const TASK_SETUP = '1';
// found:{ signIn, startMenu, desktop, and on Windows task, launcher, refused, drive, subst }, what startupReadCommand
// or startupFiles found (null for none). launcher: what signin-launcher.ps1 in root holds now, so an older copy counts
// as out of date. Gives which of them point at root and work, and mode: 'signin' (starts at sign-in), 'shortcut' (only
// a shortcut) or 'neither'. repair: the install is run again, because a sign-in start points at root but will not
// work (its launcher copy is missing or out of date, or a Startup shortcut runs start-hidden.ps1 straight from a folder
// on a drive that connects late: network, mapped or subst, where it fails before the drive is there), or because it
// starts through the Startup shortcut instead of the task (old: it works, only late; also when the task is there too,
// so it would start twice). A Startup shortcut kept because Windows refused the task at this TASK_SETUP is left alone.
export function startupState({ platform = process.platform, root, found, launcher = null }) {
  let here, signIn, repair = false, old = false;
  if (platform === 'win32') {
    const low = (s) => String(s || '').replace(/\//g, '\\').toLowerCase();
    const dir = low(path.win32.normalize(root)).replace(/(?<!:)\\$/, '');
    const files = ['start-hidden.ps1', 'start-docket.cmd'].map((f) => path.win32.join(dir, f));
    here = (s) => files.some((f) => low(s).includes(f));
    const late = dir.startsWith('\\\\') || found?.drive === 'Network' || !!found?.subst;
    const viaLauncher = (s) => low(s).includes('signin-launcher.ps1') && low(s).includes(`-folder "${dir}"`);
    const same = (a, b) => String(a).replace(/\r/g, '').trim() === String(b).replace(/\r/g, '').trim();
    const launcherOk = typeof found?.launcher === 'string' && (launcher == null || same(found.launcher, launcher));
    const taskHere = viaLauncher(found?.task), task = taskHere && launcherOk;
    const lnkHere = viaLauncher(found?.signIn) || here(found?.signIn);
    const lnk = viaLauncher(found?.signIn) ? launcherOk : here(found?.signIn) && !late;
    const refused = !taskHere && found?.refused === TASK_SETUP;
    signIn = task || lnk;
    old = lnk && !refused;
    repair = (taskHere && !task) || (lnkHere && !(lnk && refused));
  } else {
    const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const plist = `<string>${xml(path.posix.join(root, 'supervisor.mjs'))}</string>`, cmd = shq(path.posix.join(root, 'start-docket.sh'));
    here = (s, k) => typeof s === 'string' && s.includes(k === 'signIn' ? plist : cmd);
    signIn = here(found?.signIn, 'signIn');
  }
  const startMenu = here(found?.startMenu), desktop = here(found?.desktop);
  return { signIn, startMenu, desktop, repair, old, mode: signIn ? 'signin' : startMenu || desktop ? 'shortcut' : 'neither' };
}
// What to do about it. choice is the person's answer, kept in portal-state.json: 'signin', 'shortcut' (shortcuts
// only: no banner, and missing ones are made again) or 'none' (don't ask again). ask: show the banner. remake: the
// install to run again by itself, 'signin' for a repair (whatever the choice: that install was made on purpose; but
// a Startup shortcut that works, only late, stays when the person chose shortcuts or none) or 'shortcut' for missing
// shortcuts; null for none.
export function startupNeeds(now, choice) {
  if (!now?.mode) return { ask: false, remake: null };
  if (now.repair && !(now.old && (choice === 'shortcut' || choice === 'none'))) return { ask: false, remake: 'signin' };
  return { ask: now.mode === 'neither' && choice !== 'none' && choice !== 'shortcut',
    remake: choice === 'shortcut' && now.mode !== 'signin' && !(now.startMenu && now.desktop) ? 'shortcut' : null };
}
// The script, in root, that makes it so: to 'signin' (start at sign-in, plus the Start menu or Applications entry),
// 'shortcut' (no start at sign-in; the Start menu or Applications entry and one on the desktop) or 'off' (the remove
// script: neither). port: a test copy's own, so its shortcuts start that copy. Null where there is none.
export function startupScriptCommand({ platform = process.platform, root, to, port = 4400 }) {
  // remove-mac.sh has one LaunchAgent to remove whatever the port; remove-windows.ps1 removes the port's own task and shortcuts.
  const portArgs = (flag) => (to !== 'off' || flag === '-Port') && port !== 4400 ? [flag, String(port)] : [];
  if (platform === 'win32') return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.win32.join(root, to === 'off' ? 'remove-windows.ps1' : 'install-windows.ps1'), ...(to === 'shortcut' ? ['-ShortcutOnly'] : []), ...portArgs('-Port')] };
  if (platform === 'darwin') return { cmd: '/bin/bash', args: [path.posix.join(root, to === 'off' ? 'remove-mac.sh' : 'install-mac.sh'),
    ...(to === 'shortcut' ? ['--shortcut-only'] : []), ...portArgs('--port')] };
  return null;
}

// The docket:// link (docket-link.ps1, #1275): what Windows runs for it, read from this account's registry, and
// whether that starts the Docket in root on port, so the page may offer Start Docket when this Docket stops
// answering. Not on a Mac yet (install-mac.sh registers no link), so null there.
export function startLinkReadCommand(platform = process.platform) {
  if (platform !== 'win32') return null;
  return { cmd: 'reg.exe', args: ['query', 'HKCU\\Software\\Classes\\docket\\shell\\open\\command', '/ve'] };
}
export function startLinkHere({ text, root, port = 4400 }) {
  const low = String(text || '').replace(/\//g, '\\').toLowerCase();
  const dir = String(root || '').replace(/\//g, '\\').toLowerCase().replace(/(?<!:)\\$/, '');
  if (!dir || !low.includes(`"${dir}\\docket-link.ps1"`)) return false;
  return Number(low.match(/-port (\d+)/)?.[1] || 4400) === Number(port);
}

// The Browse… button beside a folder box: the computer's own folder picker, starting in start (a folder that
// exists, or '' for the picker's own choice), printing the chosen folder, or nothing on Cancel. Windows: the modern
// picker (IFileOpenDialog with FOS_PICKFOLDERS, which has an address bar; the .NET FolderBrowserDialog is the old
// tree), from a hidden PowerShell. A program in the background cannot take the front, so the dialog's owner is a
// window too small to see, kept on top, that borrows the front window's input first, as FRONT_PS does. macOS:
// choose folder in osascript, brought forward with activate, giving the POSIX path. Linux: zenity.
const PICK_CS = String.raw`
using System; using System.Runtime.InteropServices;
public static class DocketPick {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialog {}
  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileDialog {
    [PreserveSig] int Show(IntPtr owner); void SetFileTypes(uint n, IntPtr t); void SetFileTypeIndex(uint i); void GetFileTypeIndex(out uint i);
    void Advise(IntPtr e, out uint c); void Unadvise(uint c); void SetOptions(uint o); void GetOptions(out uint o);
    void SetDefaultFolder(IShellItem i); void SetFolder(IShellItem i); void GetFolder(out IShellItem i); void GetCurrentSelection(out IShellItem i);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string n); void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string n);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string t); void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string t);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string t); void GetResult(out IShellItem i);
  }
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(IntPtr c, ref Guid h, ref Guid r, out IntPtr p); void GetParent(out IShellItem i);
    void GetDisplayName(uint f, [MarshalAs(UnmanagedType.LPWStr)] out string n); void GetAttributes(uint m, out uint a); void Compare(IShellItem i, uint h, out int o);
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string p, IntPtr c, [MarshalAs(UnmanagedType.LPStruct)] Guid r, out IShellItem i);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  public static void Front(IntPtr h) {
    uint a = GetCurrentThreadId(), b = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
    AttachThreadInput(a, b, true); SetForegroundWindow(h); AttachThreadInput(a, b, false);
  }
  public static string Pick(IntPtr owner, string start, string title) {
    IFileDialog d = (IFileDialog)new FileOpenDialog();
    uint o; d.GetOptions(out o); d.SetOptions(o | 0x20 | 0x40 | 0x8 | 0x800); // folders, real ones only, keep the current folder, must exist
    d.SetTitle(title);
    if (!string.IsNullOrEmpty(start)) { try { IShellItem s; SHCreateItemFromParsingName(start, IntPtr.Zero, typeof(IShellItem).GUID, out s); d.SetFolder(s); } catch {} }
    if (d.Show(owner) != 0) return ""; // Cancel, or the window closed
    IShellItem r; d.GetResult(out r); string p; r.GetDisplayName(0x80058000, out p); return p; // SIGDN_FILESYSPATH
  }
}`;
export function folderPickCommand({ start = '', title = 'Choose a folder', platform = process.platform } = {}) {
  if (platform === 'win32') {
    const script = [
      `$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'`,
      `[Console]::OutputEncoding = [Text.Encoding]::UTF8`,
      `Add-Type -AssemblyName System.Windows.Forms, System.Drawing`,
      `Add-Type -TypeDefinition @'${PICK_CS}\n'@`,
      // the owner, on top in the middle of the screen the mouse is on, so the dialog opens there in front
      `$f = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; FormBorderStyle = 'None'; Opacity = 0; Width = 1; Height = 1; StartPosition = 'Manual' }`,
      `$a = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea`,
      `$f.Location = New-Object System.Drawing.Point([int]($a.X + $a.Width / 2), [int]($a.Y + $a.Height / 3))`,
      `$f.Show(); [DocketPick]::Front($f.Handle); $f.Activate()`,
      `$p = [DocketPick]::Pick($f.Handle, ${psq(start)}, ${psq(title)})`,
      `$f.Close()`,
      `[Console]::Out.Write($p)`,
    ].join('\n');
    return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encodePs(script)] };
  }
  if (platform === 'darwin') {
    const at = start ? ' default location (POSIX file (item 1 of argv))' : '';
    return { cmd: 'osascript', args: ['-e', 'on run argv', '-e', 'activate', '-e', `set f to choose folder with prompt (item 2 of argv)${at}`,
      '-e', 'return POSIX path of f', '-e', 'end run', start, title] };
  }
  return { cmd: 'zenity', args: ['--file-selection', '--directory', `--title=${title}`, ...(start ? [`--filename=${start.replace(/\/?$/, '/')}`] : [])] };
}
// What the picker said, from its exit (ok), what it printed (out) and its error text (err): { folder }, { cancelled },
// or { error }. Windows prints nothing on Cancel; a Mac's Cancel is error -128, and zenity's is exit 1 saying nothing.
// A Mac ends a folder's path with /, which is taken off (but not from / itself).
export function parseFolderPick({ ok, out = '', err = '' }, platform = process.platform) {
  const folder = String(out).replace(/[\r\n]+$/, '');
  if (ok && folder) return { folder: platform === 'win32' || folder === '/' ? folder : folder.replace(/\/+$/, '') };
  if (ok || /-128|User cancel/i.test(err) || (platform !== 'win32' && platform !== 'darwin' && !String(err).trim())) return { cancelled: true };
  return { error: String(err).trim().split(/\r?\n/)[0] || 'The folder picker did not open' };
}
// Where the picker starts for what is typed: that folder, or the nearest one above it that exists (exists(path)
// says), or '' when none does or what is typed is not a full path, for the picker's own choice.
export function folderPickStart(typed, exists, platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  let dir = String(typed || '').trim().replace(/^"(.*)"$/, '$1');
  if (platform === 'win32') dir = dir.replace(/\//g, '\\'); // the picker reads C:\Work, not C:/Work
  if (!isFullPath(dir, platform) && !(platform === 'win32' && /^\\\\[^\\]+\\[^\\]+/.test(dir))) return '';
  for (let i = 0; i < 64; i++) {
    if (exists(dir)) return dir;
    const up = p.dirname(dir);
    if (up === dir) return '';
    dir = up;
  }
  return '';
}

// ☰ > Restart Docket stops everything the app and the runner started, at any depth: the session programs, their
// connected services and the private browser. The list is read once, before anything is stopped, so a program whose
// parent goes first is still found. Windows: one PowerShell call, with each program's start time (Windows keeps a
// dead parent's number on its children, and a new program may get that number, so a child counts only if it started
// after its parent). macOS and Linux: ps (a program whose parent ends goes to launchd, so numbers are not reused).
export function treeListCommand(platform = process.platform) {
  if (platform === 'win32') return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,@{n='Start';e={if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }}} | ConvertTo-Json -Compress"] };
  return { cmd: 'ps', args: ['-axo', 'pid=,ppid='] };
}
// The output of treeListCommand as [{ pid, ppid, start }]; start is 0 where it is not known.
export function parseTreeList(text, platform = process.platform) {
  if (platform === 'win32') {
    let l; try { l = JSON.parse(text); } catch { return []; }
    return (Array.isArray(l) ? l : [l]).filter(Boolean).map((p) => ({ pid: Number(p.ProcessId), ppid: Number(p.ParentProcessId), start: Number(p.Start) || 0 }));
  }
  return String(text).split('\n').map((line) => line.match(/^\s*(\d+)\s+(\d+)\s*$/)).filter(Boolean).map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), start: 0 }));
}
// Every program below the roots (process numbers) in a parseTreeList list, at any depth, not the roots themselves.
export function descendants(list, roots, skip = new Set()) {
  const byPid = new Map(list.map((p) => [p.pid, p]));
  const kids = new Map();
  for (const p of list) if (p.pid !== p.ppid) (kids.get(p.ppid) || kids.set(p.ppid, []).get(p.ppid)).push(p);
  const found = new Set(), todo = roots.filter((r) => byPid.has(r));
  const seen = new Set(todo);
  while (todo.length) {
    const parent = byPid.get(todo.shift());
    for (const c of kids.get(parent.pid) || []) {
      if (seen.has(c.pid) || (c.start && parent.start && c.start < parent.start)) continue; // started before its "parent": not its child
      if (skip.has(c.pid)) continue; // left out, and what it started with it
      seen.add(c.pid); found.add(c.pid); todo.push(c.pid);
    }
  }
  return [...found];
}
// The command that stops these programs at once, without waiting for them to close: taskkill /F on Windows (not
// /T, which goes by parent numbers alone; the caller lists again for anything started meanwhile), else kill -9.
export function killCommand(pids, platform = process.platform) {
  if (!pids.length) return null;
  if (platform === 'win32') return { cmd: 'taskkill.exe', args: ['/F', ...pids.flatMap((p) => ['/PID', String(p)])] };
  return { cmd: 'kill', args: ['-9', ...pids.map(String)] };
}
// The command line of the program that started the app (pid), to tell whether it starts the app again when it
// exits with the restart code: supervisor.mjs (Windows sign-in, the shortcuts, launchd on a Mac) or start-docket.cmd
// (its console window) do; `node server.mjs` typed by hand, or a test copy, does not.
export function commandLineCommand(pid, platform = process.platform) {
  if (platform === 'win32') return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`] };
  return { cmd: 'ps', args: ['-o', 'command=', '-p', String(Number(pid))] };
}
export const relaunchesApp = (commandLine) => /supervisor\.mjs|start-docket\.cmd/i.test(String(commandLine || ''));
// Started by supervisor.mjs, which ☰ > Restart Docket replaces with a new one; start-docket.cmd's window is kept.
export const supervisedBy = (commandLine) => /supervisor\.mjs/i.test(String(commandLine || ''));
// A second list, read after the first stop, for anything left: a program stopped then that is still running (the
// same number and start time), and a program whose parent was stopped and that started after it (started while
// the rest went). stopped: the numbers stopped; before: the first list, which has their start times.
export function leftBehind(before, after, stopped) {
  const was = new Map(before.map((p) => [p.pid, p]));
  return after.filter((p) => {
    if (stopped.has(p.pid)) return !p.start || p.start === was.get(p.pid)?.start;
    const parent = stopped.has(p.ppid) && was.get(p.ppid);
    return !!parent && (!p.start || !parent.start || p.start >= parent.start);
  }).map((p) => p.pid);
}


// ---------- the profile folder (profile-sync.mjs) ----------
// The cloud folders a setup can be kept in, in the order ☰ > Docket settings > Setup > Keep my setup in a folder suggests them: Google Drive
// for desktop first, then OneDrive, Dropbox and iCloud Drive. Each service's own app moves the file; Docket only sees a
// folder. exists(path): whether a folder is there; list(dir): the names in a folder ([] when it can't be read).
// Windows: Google Drive streams to a drive letter (G: unless another was taken) with My Drive at its top, or mirrors to
// ~\My Drive; OneDrive sets %OneDrive% (and %OneDriveCommercial% for a work account); Dropbox is ~\Dropbox, or
// ~\Dropbox (Company) for a team; iCloud for Windows uses ~\iCloudDrive. macOS: each lives in ~/Library/CloudStorage
// (GoogleDrive-<account>/My Drive, OneDrive-<name>, Dropbox), older Dropbox in ~/Dropbox, iCloud in Mobile Documents.
export function cloudFolders({ platform = process.platform, home, env = process.env, exists, list = () => [] }) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const out = [];
  const add = (kind, name, dir) => { if (dir && !out.some((x) => x.path.toLowerCase() === dir.toLowerCase()) && exists(dir)) out.push({ kind, name, path: dir }); };
  const named = (dir, re) => list(dir).filter((n) => re.test(n)).sort().map((n) => p.join(dir, n));
  if (platform === 'win32') {
    for (const l of 'GHIJKLMNOPQRSTUVWXYZDEF') add('google', 'Google Drive', `${l}:\\My Drive`);
    add('google', 'Google Drive', p.join(home, 'My Drive'));
    for (const k of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) add('onedrive', k === 'OneDriveCommercial' ? 'OneDrive (work)' : 'OneDrive', env[k]);
    for (const d of named(home, /^OneDrive( - .+)?$/)) add('onedrive', p.basename(d) === 'OneDrive' ? 'OneDrive' : 'OneDrive (work)', d);
    for (const d of named(home, /^Dropbox( \(.+\))?$/)) add('dropbox', 'Dropbox', d);
    add('icloud', 'iCloud Drive', p.join(home, 'iCloudDrive'));
    return out;
  }
  const cs = p.join(home, 'Library', 'CloudStorage');
  for (const d of named(cs, /^GoogleDrive-/)) add('google', 'Google Drive', p.join(d, 'My Drive'));
  for (const d of named(cs, /^OneDrive/)) add('onedrive', ['OneDrive', 'OneDrive-Personal'].includes(p.basename(d)) ? 'OneDrive' : 'OneDrive (work)', d);
  for (const d of named(cs, /^Dropbox/)) add('dropbox', 'Dropbox', d);
  add('dropbox', 'Dropbox', p.join(home, 'Dropbox'));
  add('icloud', 'iCloud Drive', p.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'));
  return out;
}

// A folder path written on another computer, as this one might have it, best guess first, for a profile import to try
// in turn (the first that exists wins; when none does, the person is asked, with the first as the suggestion).
// from: { platform, home } of the computer that wrote it. A path in that home goes to the same place in this home
// (C:\Users\pat\Work\x <-> /Users/pat/Work/x); one elsewhere on a Windows drive goes to the same folder in this home on
// a Mac (C:\Projects\x -> ~/Projects/x); a Mac one outside the home goes on the C: drive (/opt/x -> C:\opt\x).
export function profilePathCandidates(file, { from, platform = process.platform, home }) {
  const fromWin = from?.platform === 'win32', p = platform === 'win32' ? path.win32 : path.posix;
  const src = String(file || '').trim();
  if (!src) return [];
  const norm = fromWin ? src.replace(/\//g, '\\') : src;
  const out = [];
  const add = (x) => { if (x && !out.includes(x)) out.push(x); };
  const fromHome = !from?.home ? '' : fromWin ? from.home.replace(/\//g, '\\').replace(/\\+$/, '') : from.home.replace(/\/+$/, '');
  const sep = fromWin ? '\\' : '/', low = (s) => fromWin ? s.toLowerCase() : s;
  const inHome = fromHome && (low(norm) === low(fromHome) || low(norm).startsWith(low(fromHome) + sep));
  const parts = (rest) => rest.split(sep).filter(Boolean);
  if (inHome) add(p.join(home, ...parts(norm.slice(fromHome.length))));
  if (fromWin === (platform === 'win32') && p.isAbsolute(norm)) add(src); // as written: C:/Work stays C:/Work
  const drive = /^[A-Za-z]:\\(.*)$/.exec(norm);
  if (!inHome && fromWin && platform !== 'win32' && drive) add(p.join(home, ...parts(drive[1])));
  if (!inHome && !fromWin && platform === 'win32' && norm.startsWith('/')) add(p.join('C:\\', ...parts(norm)));
  return out;
}

// Whether this computer runs on its battery, how full that is, and its power mode plugged in and on battery, for
// ☰ > Gauges > Performance (#935, #1117). Windows: one PowerShell call to Win32_Battery (a desktop has none) and the
// power mode overlay Settings > System > Power & battery > Power mode sets, kept per power source in the registry.
// macOS: pmset -g batt, whose first line says what it draws from ('AC Power', 'Battery Power' or 'UPS Power'), then
// pmset -g custom for Low Power Mode per power source. Elsewhere: none.
const POWER_SCHEMES = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes';
export function batteryCommand(platform = process.platform) {
  if (platform === 'win32') return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command',
    '$b = @(Get-CimInstance Win32_Battery | Select-Object BatteryStatus,EstimatedChargeRemaining); ' +
    `$p = Get-ItemProperty '${POWER_SCHEMES}' -ErrorAction SilentlyContinue; ` +
    '[pscustomobject]@{ b = $b; ac = $p.ActiveOverlayAcPowerScheme; dc = $p.ActiveOverlayDcPowerScheme } | ConvertTo-Json -Compress -Depth 3'] };
  if (platform === 'darwin') return { cmd: 'sh', args: ['-c', 'pmset -g batt; pmset -g custom'] };
  return null;
}
// Windows' power mode overlays: none or all zeros is Balanced; another GUID (a maker's own mode) is 'other'.
const OVERLAYS = { '961cc777-2547-4f9d-8174-7d86181b8a7a': 'efficiency', '00000000-0000-0000-0000-000000000000': 'balanced',
  'ded574b5-45a0-4f42-8737-46345c09c238': 'performance' };
export const powerOverlay = (guid) => guid == null || guid === '' ? 'balanced' : OVERLAYS[String(guid).toLowerCase()] || 'other';
// pmset -g custom's mode in one section: lowpowermode 1 (or powermode 1) is Low Power Mode, powermode 2 High Power Mode.
function macMode(section) {
  if (!section) return null;
  const low = /^\s*lowpowermode\s+(\d)/m.exec(section)?.[1], mode = /^\s*powermode\s+(\d)/m.exec(section)?.[1];
  if (low == null && mode == null) return null;
  return low === '1' || mode === '1' ? 'efficiency' : mode === '2' ? 'performance' : 'balanced';
}
// The output of batteryCommand as { battery, onBattery, percent, acMode, dcMode }: battery false (and onBattery and
// percent null) when the computer has none. Win32_Battery's BatteryStatus is 1 while discharging, 4 or 5 when low or
// critical (still discharging), and 2, 3 or 6–11 on mains power; with two batteries, either discharging means on
// battery. acMode and dcMode are 'efficiency', 'balanced', 'performance' or 'other', null when not known.
export function parseBattery(text, platform = process.platform) {
  const none = { battery: false, onBattery: null, percent: null, acMode: null, dcMode: null };
  if (platform === 'win32') {
    let l; try { l = JSON.parse(String(text).trim() || 'null'); } catch { return none; }
    let modes = {};
    if (l && !Array.isArray(l) && 'b' in l) { modes = { acMode: powerOverlay(l.ac), dcMode: powerOverlay(l.dc) }; l = l.b; }
    const list = (Array.isArray(l) ? l : [l]).filter(Boolean);
    if (!list.length) return { ...none, ...modes };
    const pcts = list.map((b) => Number(b.EstimatedChargeRemaining)).filter((n) => Number.isFinite(n));
    return { ...none, battery: true, onBattery: list.some((b) => [1, 4, 5].includes(Number(b.BatteryStatus))),
      percent: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null, ...modes };
  }
  if (platform === 'darwin') {
    const t = String(text);
    const from = /drawing from '([^']+)'/i.exec(t)?.[1] || '';
    const pct = /InternalBattery[^\n]*?(\d{1,3})%/.exec(t);
    const section = (name) => new RegExp(`^${name}:[ \\t]*\\n((?:[ \\t]+\\S.*(?:\\n|$))*)`, 'm').exec(t)?.[1];
    const modes = { acMode: macMode(section('AC Power')), dcMode: macMode(section('Battery Power')) };
    if (!pct) return { ...none, ...modes }; // a desktop Mac (a UPS line alone does not count as a battery here)
    return { battery: true, onBattery: /battery/i.test(from), percent: Number(pct[1]), ...modes };
  }
  return none;
}
// The power mode in effect now: the battery one while on battery, else the plugged-in one.
export const powerModeNow = (p) => (p?.onBattery ? p.dcMode : p?.acMode) ?? null;
// What each mode is called where it is set.
export function powerModeName(mode, platform = process.platform) {
  const names = platform === 'darwin' ? { efficiency: 'Low Power Mode', balanced: 'Automatic', performance: 'High Power Mode', other: 'another mode' }
    : { efficiency: 'Best power efficiency', balanced: 'Balanced', performance: 'Best performance', other: 'a mode of its own' };
  return names[mode] || null;
}
// Whether the screen is locked, so Read aloud keeps quiet (#1173). Asked every few seconds, so it stays cheap and
// starts no PowerShell. Windows: the lock screen is LogonUI.exe, which runs only while a session is locked (or at
// Ctrl+Alt+Del); tasklist lists it with its session number, and session is this app's own (from sessionCommand), so
// another user's lock screen does not count. macOS: ioreg's IOConsoleUsers, where this user's entry has
// CGSSessionScreenIsLocked while locked, and kCGSSessionOnConsoleKey false while another user has the screen.
// Elsewhere: none, and the screen counts as unlocked.
export function lockCommand(platform = process.platform) {
  if (platform === 'win32') return { cmd: 'tasklist.exe', args: ['/FI', 'IMAGENAME eq LogonUI.exe', '/FO', 'CSV', '/NH'] };
  if (platform === 'darwin') return { cmd: 'ioreg', args: ['-n', 'Root', '-d1', '-a'] };
  return null;
}
// This app's own Windows session number, from tasklist's row for its process. Elsewhere none is needed.
export function sessionCommand(pid = process.pid, platform = process.platform) {
  return platform === 'win32' ? { cmd: 'tasklist.exe', args: ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'] } : null;
}
// tasklist's CSV rows ("name","pid","session name","session#","memory") as { name, pid, session }. Its "no tasks"
// line is in the computer's language and has no quotes, so it gives no rows.
const csvRows = (text) => String(text || '').split(/\r?\n/).map((l) => l.match(/"([^"]*)"/g)?.map((c) => c.slice(1, -1))).filter((c) => c && c.length >= 4)
  .map((c) => ({ name: c[0], pid: Number(c[1]), session: Number(c[3]) }));
export const parseSession = (text) => csvRows(text)[0]?.session ?? null;
// The output of lockCommand as true (locked), false (not), or null (it says neither: count it as unlocked).
// session: this app's Windows session (null: any LogonUI.exe counts); uid: this user's id on a Mac (null: the first user).
export function parseLocked(text, platform = process.platform, { session = null, uid = null } = {}) {
  if (platform === 'win32') return csvRows(text).some((r) => /^logonui\.exe$/i.test(r.name) && (session == null || r.session === session));
  if (platform !== 'darwin') return null;
  const t = String(text || '');
  if (!/IOConsoleUsers/.test(t)) return null;
  // Each console user is a <dict> (ioreg -a) or a {...} (plain ioreg).
  const users = [...t.matchAll(/<dict>((?:(?!<\/?dict>)[\s\S])*?)<\/dict>/g), ...t.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).filter((u) => /kCGSSessionUserIDKey/.test(u));
  const val = (u, key) => {
    const m = new RegExp(`<key>${key}</key>\\s*<(true|false|integer>(\\d+))`).exec(u) || new RegExp(`"${key}"=(Yes|No|(\\d+))`).exec(u);
    return m ? (m[2] != null ? Number(m[2]) : /^(true|Yes)$/.test(m[1])) : null;
  };
  const user = users.find((u) => uid != null && val(u, 'kCGSSessionUserIDKey') === uid) || users[0];
  if (!user) return null;
  return val(user, 'CGSSessionScreenIsLocked') === true || val(user, 'kCGSSessionOnConsoleKey') === false;
}
// The one hint, while on battery in the slowest mode (#1117): what it does, and where to change it. Null otherwise.
export function powerHint(p, platform = process.platform) {
  if (!p?.onBattery || p.dcMode !== 'efficiency') return null;
  return platform === 'darwin' ? 'Low Power Mode is on while on battery, which slows Docket a lot. Change it in System Settings > Battery > Low Power Mode.'
    : 'Windows is set to Best power efficiency on battery, which slows Docket a lot. Change it in Settings > System > Power & battery > Power mode.';
}

// On battery Windows slows background programs down (power throttling, EcoQoS), and the app's event loop stalled for
// seconds at a time while the processor sat mostly idle (#1061). This opts programs out of that, the way a program
// asks for itself: SetProcessInformation(ProcessPowerThrottling) with EXECUTION_SPEED in the control mask and not in
// the state mask. One hidden PowerShell call: pids are done as given, and the direct children of each of parents (the
// runner's session programs) are found and done too, all but skip (done before) and the PowerShell itself. on false
// hands them back to Windows (an empty control mask: Windows decides again). Each line it prints is
// "<pid> <name> ok <control> <state>" (the masks read back afterwards) or "<pid> <name> fail <Windows error>".
// macOS has no such throttling for a program to opt out of, and elsewhere there is none: null.
const UNTHROTTLE_CS = `using System; using System.Runtime.InteropServices;
public static class DocketPower {
  [StructLayout(LayoutKind.Sequential)] public struct PT { public uint Version; public uint ControlMask; public uint StateMask; }
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetProcessInformation(IntPtr h, int cls, ref PT info, int size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessInformation(IntPtr h, int cls, ref PT info, int size);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static string Set(int pid, uint control) {
    IntPtr h = OpenProcess(0x1200, false, pid); // PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION
    if (h == IntPtr.Zero) return "fail " + Marshal.GetLastWin32Error();
    try {
      PT p = new PT(); p.Version = 1; p.ControlMask = control; p.StateMask = 0; // ProcessPowerThrottling = 4, EXECUTION_SPEED = 1
      if (!SetProcessInformation(h, 4, ref p, Marshal.SizeOf(p))) return "fail " + Marshal.GetLastWin32Error();
      PT q = new PT(); q.Version = 1;
      return GetProcessInformation(h, 4, ref q, Marshal.SizeOf(q)) ? "ok " + q.ControlMask + " " + q.StateMask : "ok";
    } finally { CloseHandle(h); }
  }
}`;
export function unthrottleCommand({ pids = [], parents = [], skip = [], on = true } = {}, platform = process.platform) {
  if (platform !== 'win32') return null;
  const nums = (l) => [...new Set(l.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const own = nums(pids), up = nums(parents), done = nums(skip);
  if (!own.length && !up.length) return null;
  const script = [
    `Add-Type -TypeDefinition @'\n${UNTHROTTLE_CS}\n'@`,
    `$pids = @(${own.join(',')}); $skip = @(${done.join(',')}, $PID)`,
    up.length ? `$pids += @(Get-CimInstance Win32_Process -Filter "${up.map((p) => `ParentProcessId=${p}`).join(' OR ')}" | ForEach-Object { [int]$_.ProcessId })` : '',
    `foreach ($p in ($pids | Select-Object -Unique)) { if ($skip -contains $p) { continue }`,
    `  $n = (Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName; if (-not $n) { continue }`,
    `  "$p $n " + [DocketPower]::Set($p, ${on ? 1 : 0}) }`,
  ].filter(Boolean).join('\n');
  return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePs(script)] };
}
// The output of unthrottleCommand as [{ pid, name, ok, error }]: ok when the opt-out took (and, where Windows read
// it back, the state mask no longer holds EXECUTION_SPEED); error is Windows' error number when it did not.
export function parseUnthrottle(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim().match(/^(\d+) (\S+) (ok|fail)(?: (\d+))?(?: (\d+))?$/)).filter(Boolean)
    .map((m) => m[3] === 'fail' ? { pid: Number(m[1]), name: m[2], ok: false, error: Number(m[4]) || 0 }
      : { pid: Number(m[1]), name: m[2], ok: m[5] === undefined || !(Number(m[5]) & 1) });
}

// ---------- a fresh environment for each app start (supervisor.mjs) ----------
// supervisor.mjs can run for days, and what it was started with would otherwise reach every app and runner it
// starts, however often Docket restarts. So on each app start it reads the person's variables as Windows keeps them
// (HKCU\Environment, HKLM's Session Manager\Environment for the computer's, and HKCU\Volatile Environment for the
// sign-in's own, such as USERNAME and USERPROFILE), unexpanded, as JSON in UTF-8.
// Other systems have nothing like it: on a Mac the launchd job's variables are what Docket gets (null here).
export function envReadCommand(platform = process.platform) {
  if (platform !== 'win32') return null;
  return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    "function Get-EnvValues($k) { $key = Get-Item -LiteralPath $k; @($key.GetValueNames() | Where-Object { $_ } | ForEach-Object { [pscustomobject]@{ name = $_; kind = $key.GetValueKind($_).ToString(); value = [string]$key.GetValue($_, '', 'DoNotExpandEnvironmentNames') } }) }",
    "ConvertTo-Json -Depth 3 -Compress @{ user = Get-EnvValues 'HKCU:\\Environment'; volatile = Get-EnvValues 'HKCU:\\Volatile Environment'; system = Get-EnvValues 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment' }"].join('; ')] };
}
// envReadCommand's output as { user, system, volatile }, each [{ name, kind, value }]; null when it cannot be read.
export function parseEnvRead(text) {
  let j; try { j = JSON.parse(String(text).trim()); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const list = (l) => (Array.isArray(l) ? l : l ? [l] : []).filter((v) => v && v.name).map((v) => ({ name: String(v.name), kind: String(v.kind || 'String'), value: String(v.value ?? '') }));
  return { user: list(j.user), system: list(j.system), volatile: list(j.volatile) };
}
// The environment to start the app with, built as Windows builds it at sign-in: current (the supervisor's own) with
// the computer's variables over it, then the sign-in's (its USERNAME over the computer's USERNAME=SYSTEM), then the
// person's, REG_EXPAND_SZ values expanded, and the person's Path added after the computer's. Windows hands out TEMP
// and TMP as short (8.3) paths: when samePath(current, new) says they are one folder, the current value stays. managed: the names
// (upper case) the registry gave before; one gone from the registry since was deleted, so it is dropped. Any
// other name that is not in the registry was set for this Docket alone (PORTAL_PORT for a test copy, say) and stays.
// extraPath goes at the end of Path (the runtime\ folders of a copy from Docket-Setup.exe, as start-hidden.ps1 does).
// Gives { env, names (managed for next time), changed, dropped }. Not Windows, or nothing read: current as it is.
export function freshEnv({ current, read, managed = [], extraPath = [], samePath = (a, b) => a === b, platform = process.platform }) {
  if (platform !== 'win32' || !read) return { env: { ...current }, names: [...managed], changed: [], dropped: [] };
  const up = (n) => n.toUpperCase();
  const volatile = read.volatile || [];
  const regNames = new Set([...read.system, ...volatile, ...read.user].map((v) => up(v.name)));
  const gone = new Set(managed.map(up).filter((n) => !regNames.has(n)));
  const env = {};
  for (const [k, v] of Object.entries(current)) if (!gone.has(up(k)) && !regNames.has(up(k))) env[k] = v;
  const keyOf = (n) => Object.keys(env).find((k) => up(k) === up(n));
  const set = (n, v) => { const k = keyOf(n); if (k !== undefined) delete env[k]; env[n] = v; };
  const expand = (s) => s.replace(/%([^%;\\/]+)%/g, (m, n) => { const k = keyOf(n); return k === undefined ? m : env[k]; });
  let systemPath = '';
  for (const [list, user] of [[read.system, false], [volatile, false], [read.user, true]]) {
    // Plain values first, so an expanding one can use any of them, as Windows does.
    for (const v of [...list.filter((x) => x.kind !== 'ExpandString'), ...list.filter((x) => x.kind === 'ExpandString')]) {
      let value = v.kind === 'ExpandString' ? expand(v.value) : v.value;
      if (up(v.name) === 'PATH') {
        if (!user) systemPath = value;
        else value = [systemPath.replace(/;+$/, ''), value].filter(Boolean).join(';');
      }
      set(v.name, value);
    }
  }
  if (extraPath.length) { const k = keyOf('PATH') || 'Path'; env[k] = [String(env[k] || '').replace(/;+$/, ''), ...extraPath].filter(Boolean).join(';'); }
  const was = (n) => { const k = Object.keys(current).find((x) => up(x) === up(n)); return k === undefined ? undefined : current[k]; };
  for (const n of ['TEMP', 'TMP']) { const k = keyOf(n), old = was(n); if (k !== undefined && old !== undefined && old !== env[k] && samePath(old, env[k])) env[k] = old; }
  return { env, names: [...new Set([...managed.map(up), ...regNames])], changed: Object.keys(env).filter((k) => was(k) !== env[k]), dropped: Object.keys(current).filter((k) => gone.has(up(k))) };
}
// The node to start the app with: the first one on env's PATH, so a Node.js upgrade that moved it is picked up;
// fallback (the supervisor's own) when none is found. exists(file) says whether a file is there.
export function findNode({ env, exists, fallback, platform = process.platform }) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const k = Object.keys(env).find((x) => (platform === 'win32' ? x.toUpperCase() : x) === 'PATH');
  for (const dir of String(k ? env[k] : '').split(platform === 'win32' ? ';' : ':')) {
    const d = dir.trim().replace(/^"(.*)"$/, '$1');
    if (!d || !p.isAbsolute(d)) continue;
    const file = p.join(d, platform === 'win32' ? 'node.exe' : 'node');
    if (exists(file)) return file;
  }
  return fallback;
}

// Where Claude Code keeps a home's sign-in (the Vanilla desk copies it, vanilla.mjs). Windows and Linux: the
// .credentials.json file in the home. macOS: the login keychain, under "Claude Code-credentials", with the first 8
// hex digits of the SHA-256 of the home's path added for a home other than the standard ~/.claude (CLAUDE_CONFIG_DIR
// set), stored for the user's account name. Not yet checked on a Mac (#1210).
export function claudeSignInStore({ home, standard = false, platform = process.platform, user = '' }) {
  if (platform !== 'darwin') return { kind: 'file', file: path.join(home, '.credentials.json') };
  const service = 'Claude Code-credentials' + (standard ? '' : '-' + createHash('sha256').update(home).digest('hex').slice(0, 8));
  return { kind: 'keychain', service, account: user };
}
// The commands that read and write one keychain entry (macOS's security program). Writing replaces it (-U).
export const keychainReadCommand = ({ service }) => ({ cmd: 'security', args: ['find-generic-password', '-s', service, '-w'] });
export const keychainWriteCommand = ({ service, account }, secret) => ({ cmd: 'security', args: ['add-generic-password', '-U', '-a', account, '-s', service, '-w', secret] });

// ---------- the Azure DevOps token (#1270) ----------
// Where Docket keeps AZURE_DEVOPS_EXT_PAT for the user, so the next start has it too. Windows: the user variable
// (HKCU\Environment), which the supervisor hands each app start (freshEnv). macOS: the LaunchAgent install-mac.sh
// writes, whose EnvironmentVariables launchd gives Docket. The token reaches the command in the variable named
// secretVar, never on Windows' command line; plutil takes it as an argument (as keychainWriteCommand does).
// null where Docket has no such place (it is then kept only until Docket restarts). needs: a file that must exist.
export const macLaunchAgent = (home) => path.posix.join(home, 'Library', 'LaunchAgents', 'local.docket.plist');
export function adoPatSaveCommand({ platform = process.platform, home } = {}) {
  if (platform === 'win32') return { cmd: 'powershell.exe', secretVar: 'DOCKET_ADO_PAT', args: ['-NoProfile', '-NonInteractive', '-Command',
    "[Environment]::SetEnvironmentVariable('AZURE_DEVOPS_EXT_PAT', $env:DOCKET_ADO_PAT, 'User')"] };
  if (platform === 'darwin') return { cmd: '/bin/sh', secretVar: 'DOCKET_ADO_PAT', needs: macLaunchAgent(home), args: ['-c',
    'plutil -replace EnvironmentVariables.AZURE_DEVOPS_EXT_PAT -string "$DOCKET_ADO_PAT" "$1"', 'sh', macLaunchAgent(home)] };
  return null;
}
// Reading it back, for a token saved after Docket started: the command, and its answer as the token ('' for none).
export function adoPatReadCommand({ platform = process.platform, home } = {}) {
  if (platform === 'win32') return { cmd: 'reg', args: ['query', 'HKCU\\Environment', '/v', 'AZURE_DEVOPS_EXT_PAT'] };
  if (platform === 'darwin') return { cmd: 'plutil', args: ['-extract', 'EnvironmentVariables.AZURE_DEVOPS_EXT_PAT', 'raw', '-o', '-', macLaunchAgent(home)] };
  return null;
}
export function parseAdoPatRead(text, platform = process.platform) {
  if (platform === 'win32') return String(text || '').match(/AZURE_DEVOPS_EXT_PAT\s+REG_(?:EXPAND_)?SZ\s+(\S+)/)?.[1] || '';
  return platform === 'darwin' ? String(text || '').trim() : '';
}
// The user's own Azure DevOps sign-in, borrowed only when a desk turns it on: git's (Git Credential Manager keeps an
// Entra token or a PAT for dev.azure.com, in Windows' Credential Manager or the macOS keychain) and the Azure CLI's.
// Neither may ask anything: git and its helper are told never to prompt. az is a .cmd file on Windows, which Node
// starts only through cmd.exe. 499b84ac-... is Azure DevOps' own resource id.
export const ADO_RESOURCE = '499b84ac-1321-427f-aa17-267ca6aa798d';
export function adoSignInCommands(org, platform = process.platform) {
  const az = ['account', 'get-access-token', '--resource', ADO_RESOURCE, '--output', 'json'];
  return [
    { kind: 'git', cmd: 'git', args: ['credential', 'fill'], input: `protocol=https\nhost=dev.azure.com\npath=${org}\n\n`,
      env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' } },
    platform === 'win32' ? { kind: 'az', cmd: 'cmd.exe', args: ['/d', '/s', '/c', 'az', ...az] } : { kind: 'az', cmd: 'az', args: az },
  ];
}
