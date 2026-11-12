// What differs between Windows and macOS: showing a file, opening a terminal, finding file paths in a
// session's text, where installed programs live, and the example folders in error messages. Each takes the
// platform, so the tests can try every one on any computer. Linux gets the macOS answers, with xdg-open.
import path from 'node:path';
import { CLEARED } from './company-env.mjs';

// The program that opens a file in its default program (how 'open') or shows it in its folder (how 'folder').
// Windows: explorer.exe, whose /select, takes the path in quotes as one argument. macOS: open, or open -R to
// show it in Finder. Linux has no "show in folder", so it opens the folder.
export function openCommand(file, how, platform = process.platform) {
  if (platform === 'win32') return { cmd: 'explorer.exe', args: [how === 'folder' ? `/select,"${file}"` : `"${file}"`], opts: { windowsVerbatimArguments: true } };
  if (platform === 'darwin') return { cmd: 'open', args: how === 'folder' ? ['-R', file] : [file], opts: {} };
  return { cmd: 'xdg-open', args: [how === 'folder' ? path.posix.dirname(file) : file], opts: {} };
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
// and desktop open it, starting it first if needed. Windows: Docket.lnk in the Startup folder and the Start menu
// (Programs), and Start Docket.lnk on the desktop, where a browser may have put its own Docket.lnk for a pinned page
// (the old desktop icon, Docket.lnk running start-docket.cmd, counts too). install-windows.ps1 makes them; they are
// read through PowerShell, which asks Windows where each folder is (the desktop may be in OneDrive). The Startup one
// runs signin-launcher.ps1 from %LOCALAPPDATA%\Docket, which waits for a Docket folder on a drive that connects late,
// so the same script also gives that copy (Launcher) and what kind of drive root is on (Drive, and Subst for a subst
// drive). macOS: the LaunchAgent install-mac.sh writes, and the Docket.command it puts in ~/Applications and on the
// desktop, read as files (startupFiles).
export function startupReadCommand(platform = process.platform, root = '') {
  if (platform !== 'win32') return null;
  const script = [
    `$s = New-Object -ComObject WScript.Shell; $r = @{}; $q = [IO.Path]::GetPathRoot(${psq(root)})`,
    "$f = Join-Path $env:LOCALAPPDATA 'Docket\\signin-launcher.ps1'; $r.Launcher = if (Test-Path -LiteralPath $f) { [IO.File]::ReadAllText($f) } else { $null }",
    "$r.Drive = if ($q -like '\\\\*') { 'Network' } else { try { [string][IO.DriveInfo]::new($q).DriveType } catch { $null } }",
    "$r.Subst = [bool](subst | Where-Object { $q -and $_ -like ($q.Substring(0, 2) + '\\: =>*') })",
    "foreach ($k in 'Startup', 'Programs', 'Desktop') {",
    "  $l = @(if ($k -eq 'Desktop') { 'Start Docket.lnk', 'Docket.lnk' } else { 'Docket.lnk' }) | ForEach-Object { Join-Path ([Environment]::GetFolderPath($k)) $_ } |",
    "    Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { $x = $s.CreateShortcut($_); $x.TargetPath + ' ' + $x.Arguments }",
    "  $r[$k] = if ($l) { $l -join \"`n\" } else { $null } }",
    // As UTF-8 in base64, so a folder name outside the console's code page arrives whole.
    '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($r | ConvertTo-Json -Compress)))',
  ].join('\n');
  return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePs(script)] };
}
// What that prints, as { signIn, startMenu, desktop }: each the program and arguments a shortcut runs, or null; and
// launcher, drive and subst, as above.
export function parseStartupRead(text) {
  let r; try { r = JSON.parse(Buffer.from(String(text).trim(), 'base64').toString('utf8')); } catch { r = null; }
  return { signIn: r?.Startup || null, startMenu: r?.Programs || null, desktop: r?.Desktop || null,
    launcher: typeof r?.Launcher === 'string' ? r.Launcher : null, drive: r?.Drive || null, subst: !!r?.Subst };
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
// found:{ signIn, startMenu, desktop, and on Windows launcher, drive, subst }, what startupReadCommand or
// startupFiles found (null for none). launcher: what signin-launcher.ps1 in root holds now, so an older copy counts as
// out of date. Gives which of them point at root and work, and mode: 'signin' (starts at sign-in), 'shortcut' (only
// a shortcut) or 'neither'. repair: a Startup shortcut points at root but will not work, so the install is run again:
// its launcher copy is missing or out of date, or it runs start-hidden.ps1 straight from a folder on a drive that
// connects late (network, mapped or subst), where the shortcut fails before the drive is there.
export function startupState({ platform = process.platform, root, found, launcher = null }) {
  let here, signIn, repair = false;
  if (platform === 'win32') {
    const low = (s) => String(s || '').replace(/\//g, '\\').toLowerCase();
    const dir = low(path.win32.normalize(root)).replace(/(?<!:)\\$/, '');
    const files = ['start-hidden.ps1', 'start-docket.cmd'].map((f) => path.win32.join(dir, f));
    here = (s) => files.some((f) => low(s).includes(f));
    const t = low(found?.signIn), late = dir.startsWith('\\\\') || found?.drive === 'Network' || !!found?.subst;
    const viaLauncher = t.includes('signin-launcher.ps1') && t.includes(`-folder "${dir}"`);
    const same = (a, b) => String(a).replace(/\r/g, '').trim() === String(b).replace(/\r/g, '').trim();
    const launcherOk = typeof found?.launcher === 'string' && (launcher == null || same(found.launcher, launcher));
    signIn = viaLauncher ? launcherOk : here(found?.signIn) && !late;
    repair = (viaLauncher || here(found?.signIn)) && !signIn;
  } else {
    const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const plist = `<string>${xml(path.posix.join(root, 'supervisor.mjs'))}</string>`, cmd = shq(path.posix.join(root, 'start-docket.sh'));
    here = (s, k) => typeof s === 'string' && s.includes(k === 'signIn' ? plist : cmd);
    signIn = here(found?.signIn, 'signIn');
  }
  const startMenu = here(found?.startMenu), desktop = here(found?.desktop);
  return { signIn, startMenu, desktop, repair, mode: signIn ? 'signin' : startMenu || desktop ? 'shortcut' : 'neither' };
}
// What to do about it. choice is the person's answer, kept in portal-state.json: 'signin', 'shortcut' (shortcuts
// only: no banner, and missing ones are made again) or 'none' (don't ask again). ask: show the banner. remake: the
// install to run again by itself, 'signin' for a repair (whatever the choice: that install was made on purpose) or
// 'shortcut' for missing shortcuts; null for none.
export function startupNeeds(now, choice) {
  if (!now?.mode) return { ask: false, remake: null };
  if (now.repair) return { ask: false, remake: 'signin' };
  return { ask: now.mode === 'neither' && choice !== 'none' && choice !== 'shortcut',
    remake: choice === 'shortcut' && now.mode !== 'signin' && !(now.startMenu && now.desktop) ? 'shortcut' : null };
}
// The script, in root, that makes it so: to 'signin' (start at sign-in, plus the Start menu or Applications entry),
// 'shortcut' (no start at sign-in; the Start menu or Applications entry and one on the desktop) or 'off' (the remove
// script: neither). port: a test copy's own, so its shortcuts start that copy. Null where there is none.
export function startupScriptCommand({ platform = process.platform, root, to, port = 4400 }) {
  const portArgs = (flag) => to !== 'off' && port !== 4400 ? [flag, String(port)] : [];
  if (platform === 'win32') return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.win32.join(root, to === 'off' ? 'remove-windows.ps1' : 'install-windows.ps1'), ...(to === 'shortcut' ? ['-ShortcutOnly'] : []), ...portArgs('-Port')] };
  if (platform === 'darwin') return { cmd: '/bin/bash', args: [path.posix.join(root, to === 'off' ? 'remove-mac.sh' : 'install-mac.sh'),
    ...(to === 'shortcut' ? ['--shortcut-only'] : []), ...portArgs('--port')] };
  return null;
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

// ---------- screen and mouse control (#822) ----------
// A session sees and acts on the desktop through one small script per platform, run once per action: it takes a
// request (what to do, in the screen's own coordinates) and prints one line of JSON. Windows: PowerShell with
// user32 SendInput and System.Drawing, nothing to build. macOS: JavaScript for Automation (osascript) with
// CoreGraphics events, screencapture and sips; Docket's program needs Screen Recording and Accessibility in
// System Settings > Privacy & Security. Screen coordinates are physical pixels on Windows (the script is DPI aware,
// so 125% or 150% scaling and mixed monitors line up) and points on a Mac (CoreGraphics' own unit).

// Keys by name: [Windows virtual-key code, macOS key code (ANSI layout)]. Letters, digits and F keys are added below.
const KEYS = {
  enter: [0x0d, 36], return: [0x0d, 36], tab: [0x09, 48], escape: [0x1b, 53], esc: [0x1b, 53], space: [0x20, 49],
  backspace: [0x08, 51], delete: [0x2e, 117], del: [0x2e, 117], insert: [0x2d, 114], home: [0x24, 115], end: [0x23, 119],
  pageup: [0x21, 116], pagedown: [0x22, 121], left: [0x25, 123], right: [0x27, 124], up: [0x26, 126], down: [0x28, 125],
  ctrl: [0x11, 59], control: [0x11, 59], shift: [0x10, 56], alt: [0x12, 58], option: [0x12, 58],
  win: [0x5b, 55], cmd: [0x5b, 55], command: [0x5b, 55], meta: [0x5b, 55], super: [0x5b, 55],
  capslock: [0x14, 57], printscreen: [0x2c, 105], menu: [0x5d, 110],
  minus: [0xbd, 27], '-': [0xbd, 27], plus: [0xbb, 24], equal: [0xbb, 24], '=': [0xbb, 24], comma: [0xbc, 43], ',': [0xbc, 43],
  period: [0xbe, 47], '.': [0xbe, 47], slash: [0xbf, 44], '/': [0xbf, 44], semicolon: [0xba, 41], ';': [0xba, 41],
  quote: [0xde, 39], "'": [0xde, 39], backquote: [0xc0, 50], '`': [0xc0, 50], '[': [0xdb, 33], ']': [0xdd, 30], backslash: [0xdc, 42], '\\': [0xdc, 42],
};
const MAC_ORDER = 'asdfhgzxcv_bqweryt123465=97-80]ou[ip_lj\'k;\\,/nm.'; // a macOS key code is its place here (ANSI layout)
for (let i = 0; i < 26; i++) { const ch = String.fromCharCode(97 + i); KEYS[ch] = [0x41 + i, MAC_ORDER.indexOf(ch)]; }
for (let d = 0; d <= 9; d++) KEYS[String(d)] = [0x30 + d, MAC_ORDER.indexOf(String(d))];
[122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111].forEach((mac, i) => { KEYS['f' + (i + 1)] = [0x70 + i, mac]; });
const MODIFIERS = new Set(['ctrl', 'control', 'shift', 'alt', 'option', 'win', 'cmd', 'command', 'meta', 'super']);

// A key or combination as people write it ("ctrl+s", "Ctrl+Shift+Esc", "enter", "cmd+v") as the key codes pressed in
// order (and let go in reverse), and whether it types a character (no modifier but Shift), which counts as typing for
// the password-field check. Throws on a key it does not know.
export function keyCodes(combo, platform = process.platform) {
  const text = String(combo || '').toLowerCase().trim();
  const names = (text === '+' ? 'plus' : text.replace(/\+\s*\+$/, '+plus')).split('+').map((k) => k.trim()).filter(Boolean);
  if (!names.length) throw new Error('No key given. Write keys like enter, ctrl+s or ctrl+shift+esc.');
  const col = platform === 'darwin' ? 1 : 0;
  const codes = names.map((k) => {
    const c = KEYS[k];
    if (!c) throw new Error(`Unknown key "${k}". Use names like enter, tab, esc, backspace, delete, up, f5, ctrl, shift, alt, ${platform === 'darwin' ? 'cmd' : 'win'}, or one letter or digit; use key_type for text.`);
    return c[col];
  });
  const typesText = names.every((k) => k === 'shift' || !MODIFIERS.has(k)) && names.some((k) => k.length === 1 || k === 'space' || k === 'plus');
  return { codes, names, typesText };
}

// The size a screenshot is scaled to for the model: at most 1568 pixels on its long side and about 1.15 megapixels
// (what the model reads without scaling it again), never larger than it is.
export function fitShot(w, h, { maxSide = 1568, maxPixels = 1150000 } = {}) {
  const k = Math.min(1, maxSide / Math.max(w, h), Math.sqrt(maxPixels / (w * h)));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), scale: k };
}
// The screen area of a screenshot: every monitor (the box round them all), one monitor (1 is the first listed),
// or a region given in an earlier screenshot's image pixels (zooming in on it). screens: [{ x, y, w, h }].
export function shotArea(screens, { monitor, region, from } = {}) {
  if (!screens?.length) throw new Error('No monitor found');
  if (region) {
    if (!from) throw new Error('A region is given in an earlier screenshot\'s pixels: take a screen_shot without one first.');
    const [ix, iy, iw, ih] = region.map(Number);
    if (![ix, iy, iw, ih].every(Number.isFinite) || iw < 1 || ih < 1) throw new Error('A region is [x, y, width, height] in the last screenshot\'s pixels.');
    const a = toScreen(from, ix, iy), b = toScreen(from, ix + iw, iy + ih);
    return { x: a.x, y: a.y, w: Math.max(1, b.x - a.x), h: Math.max(1, b.y - a.y) };
  }
  if (monitor !== undefined) {
    const m = screens[Number(monitor) - 1];
    if (!m) throw new Error(`There is no monitor ${monitor}: this computer has ${screens.length}.`);
    return { x: m.x, y: m.y, w: m.w, h: m.h };
  }
  const x = Math.min(...screens.map((s) => s.x)), y = Math.min(...screens.map((s) => s.y));
  return { x, y, w: Math.max(...screens.map((s) => s.x + s.w)) - x, h: Math.max(...screens.map((s) => s.y + s.h)) - y };
}
// A point in a screenshot's image on the screen. shot: { x, y, w, h } (the screen area) and { iw, ih } (the image size).
export function toScreen(shot, ix, iy) {
  return { x: Math.round(shot.x + Number(ix) * shot.w / shot.iw), y: Math.round(shot.y + Number(iy) * shot.h / shot.ih) };
}

// The script each platform runs, written to Docket's data folder on first use; null where screen control does not work.
export function screenScript(platform = process.platform) {
  if (platform === 'win32') return { file: 'screen-control.ps1', text: WIN_SCREEN };
  if (platform === 'darwin') return { file: 'screen-control.js', text: MAC_SCREEN };
  return null;
}
// How one request runs. Windows gets it as base64 JSON, so no quoting can break it.
export function screenCommand(script, req, platform = process.platform) {
  const json = JSON.stringify(req);
  if (platform === 'win32') return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, Buffer.from(json, 'utf8').toString('base64')] };
  if (platform === 'darwin') return { cmd: 'osascript', args: ['-l', 'JavaScript', script, json] };
  throw new Error('Screen control works on Windows and macOS only');
}

// The requests both scripts take, in screen coordinates: screens; shot { x, y, w, h, tw, th, file } (the area, the
// size to scale it to, and a .png or .jpg to save); move { x, y }; click { x, y, button, count, before };
// drag { x, y, x2, y2, button, before }; scroll { x, y, dx, dy } (notches; dy > 0 is down, dx > 0 right);
// type { text }; keys { codes, guard }. before: a shot saved first, for the log. guard (and always for type): refuse
// with { error: 'password' } when the focused field is a password field. Each answers { ok: true } (and screens:
// [{ x, y, w, h, primary, scale }] for screens) or { error }.
const WIN_SCREEN = String.raw`param([string]$Req)
$ErrorActionPreference = 'Stop'
try {
$r = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Req)) | ConvertFrom-Json
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Threading;
public static class DocketScreen {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct MONITORINFOEX { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice; }
  delegate bool MonitorProc(IntPtr h, IntPtr hdc, ref RECT r, IntPtr data);
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorProc cb, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr h, ref MONITORINFOEX mi);
  [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr h, int type, out uint x, out uint y);
  [StructLayout(LayoutKind.Sequential)] struct GUITHREADINFO { public int cbSize, flags; public IntPtr active, focus, capture, menuOwner, moveSize, caret; public RECT rcCaret; }
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO g);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint ms, out IntPtr result);
  // A classic Edit control with the keyboard that hides what is typed (ES_PASSWORD, or a password character set).
  public static bool PasswordEdit() {
    var g = new GUITHREADINFO(); g.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
    if (!GetGUIThreadInfo(0, ref g) || g.focus == IntPtr.Zero) return false;
    var cls = new System.Text.StringBuilder(256); GetClassName(g.focus, cls, 256);
    if (cls.ToString().IndexOf("edit", StringComparison.OrdinalIgnoreCase) < 0) return false;
    if ((GetWindowLong(g.focus, -16) & 0x20) != 0) return true;
    IntPtr ch; SendMessageTimeout(g.focus, 0xD2, IntPtr.Zero, IntPtr.Zero, 2, 300, out ch); // EM_GETPASSWORDCHAR
    return ch != IntPtr.Zero;
  }
  public static void Aware() { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
  public static string Monitors() {
    var list = new List<string>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr h, IntPtr hdc, ref RECT rc, IntPtr d) {
      var mi = new MONITORINFOEX(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX)); GetMonitorInfo(h, ref mi);
      uint dx = 96, dy = 96; try { GetDpiForMonitor(h, 0, out dx, out dy); } catch { }
      var m = mi.rcMonitor;
      list.Add(String.Format(System.Globalization.CultureInfo.InvariantCulture, "{{\"x\":{0},\"y\":{1},\"w\":{2},\"h\":{3},\"primary\":{4},\"scale\":{5}}}",
        m.Left, m.Top, m.Right - m.Left, m.Bottom - m.Top, (mi.dwFlags & 1) == 1 ? "true" : "false", dx / 96.0));
      return true; }, IntPtr.Zero);
    return "[" + String.Join(",", list) + "]";
  }
  static void Send(params INPUT[] a) { SendInput((uint)a.Length, a, Marshal.SizeOf(typeof(INPUT))); }
  static INPUT Mouse(uint flags, int data) { var i = new INPUT(); i.type = 0; i.u.mi.dwFlags = flags; i.u.mi.mouseData = (uint)data; return i; }
  static INPUT Key(ushort vk, ushort scan, uint flags) { var i = new INPUT(); i.type = 1; i.u.ki.vk = vk; i.u.ki.scan = scan; i.u.ki.flags = flags; return i; }
  static uint Down(string b) { return b == "right" ? 0x8u : b == "middle" ? 0x20u : 0x2u; }
  public static void Move(int x, int y) { SetCursorPos(x, y); Send(Mouse(1, 0)); }
  public static void Click(int x, int y, string b, int count) {
    Move(x, y); Thread.Sleep(30);
    for (int n = 0; n < count; n++) { Send(Mouse(Down(b), 0)); Thread.Sleep(20); Send(Mouse(Down(b) * 2, 0)); Thread.Sleep(40); }
  }
  public static void Drag(int x, int y, int x2, int y2, string b) {
    Move(x, y); Thread.Sleep(50); Send(Mouse(Down(b), 0)); Thread.Sleep(80);
    for (int s = 1; s <= 20; s++) { Move(x + (x2 - x) * s / 20, y + (y2 - y) * s / 20); Thread.Sleep(15); }
    Thread.Sleep(80); Send(Mouse(Down(b) * 2, 0));
  }
  public static void Scroll(int x, int y, int dx, int dy) {
    Move(x, y); Thread.Sleep(30);
    if (dy != 0) Send(Mouse(0x800, -dy * 120));
    if (dx != 0) Send(Mouse(0x1000, dx * 120));
  }
  static uint Ext(int vk) { return (vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E || vk == 0x5B || vk == 0x5C || vk == 0x5D ? 1u : 0u; }
  public static void Keys(int[] vks) {
    foreach (var vk in vks) { Send(Key((ushort)vk, 0, Ext(vk))); Thread.Sleep(15); }
    for (int i = vks.Length - 1; i >= 0; i--) { Send(Key((ushort)vks[i], 0, Ext(vks[i]) | 2u)); Thread.Sleep(15); }
  }
  public static void Type(string text) {
    foreach (char c in text.Replace("\r\n", "\n")) {
      if (c == '\n') { Keys(new[] { 0x0D }); continue; }
      if (c == '\t') { Keys(new[] { 0x09 }); continue; }
      Send(Key(0, c, 4), Key(0, c, 6)); Thread.Sleep(8);
    }
  }
}
'@
[DocketScreen]::Aware()
function Save-Shot($s) {
  $src = New-Object Drawing.Bitmap ([int]$s.w), ([int]$s.h)
  $g = [Drawing.Graphics]::FromImage($src); $g.CopyFromScreen([int]$s.x, [int]$s.y, 0, 0, $src.Size); $g.Dispose()
  if ($s.tw -ne $s.w -or $s.th -ne $s.h) {
    $dst = New-Object Drawing.Bitmap ([int]$s.tw), ([int]$s.th)
    $g = [Drawing.Graphics]::FromImage($dst); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($src, 0, 0, [int]$s.tw, [int]$s.th); $g.Dispose(); $src.Dispose(); $src = $dst
  }
  $fmt = if ($s.file -like '*.jpg') { [Drawing.Imaging.ImageFormat]::Jpeg } else { [Drawing.Imaging.ImageFormat]::Png }
  $src.Save($s.file, $fmt); $src.Dispose()
}
function Test-Password {
  # A classic Windows password box, then UI Automation (browsers and newer programs say IsPassword themselves)
  if ([DocketScreen]::PasswordEdit()) { return $true }
  try { Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes; return [bool][Windows.Automation.AutomationElement]::FocusedElement.Current.IsPassword } catch { return $false }
}
if ($r.before) { Save-Shot $r.before }
switch ($r.op) {
  'screens' { '{"ok":true,"screens":' + [DocketScreen]::Monitors() + '}'; break }
  'shot' { Save-Shot $r; '{"ok":true}'; break }
  'move' { [DocketScreen]::Move($r.x, $r.y); '{"ok":true}'; break }
  'click' { [DocketScreen]::Click($r.x, $r.y, [string]$r.button, [int]$r.count); '{"ok":true}'; break }
  'drag' { [DocketScreen]::Drag($r.x, $r.y, $r.x2, $r.y2, [string]$r.button); '{"ok":true}'; break }
  'scroll' { [DocketScreen]::Scroll($r.x, $r.y, $r.dx, $r.dy); '{"ok":true}'; break }
  'type' { if (Test-Password) { '{"error":"password"}' } else { [DocketScreen]::Type([string]$r.text); '{"ok":true}' }; break }
  'keys' { if ($r.guard -and (Test-Password)) { '{"error":"password"}' } else { [DocketScreen]::Keys([int[]]$r.codes); '{"ok":true}' }; break }
  default { '{"error":"unknown request"}' }
}
} catch { @{ error = $_.Exception.Message } | ConvertTo-Json -Compress }
`;

const MAC_SCREEN = String.raw`ObjC.import('AppKit'); ObjC.import('CoreGraphics'); ObjC.import('Carbon');
function run(argv) {
  const r = JSON.parse(argv[0]);
  const app = Application.currentApplication(); app.includeStandardAdditions = true;
  const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  const post = (e) => { $.CGEventPost(0, e); delay(0.02); };
  const mouse = (type, x, y, button, clicks) => {
    const e = $.CGEventCreateMouseEvent(null, type, $.CGPointMake(x, y), button);
    if (clicks) $.CGEventSetIntegerValueField(e, 1, clicks); // kCGMouseEventClickState: 2 makes a double click
    post(e);
  };
  const BTN = { left: [1, 2, 0, 6], right: [3, 4, 1, 7], middle: [25, 26, 2, 27] }; // down, up, button number, dragged
  const shot = (s) => {
    app.doShellScript('screencapture -x -t ' + (s.file.endsWith('.jpg') ? 'jpg' : 'png') + ' -R' + [s.x, s.y, s.w, s.h].join(',') + ' ' + q(s.file));
    app.doShellScript('sips -z ' + s.th + ' ' + s.tw + ' ' + q(s.file) + ' >/dev/null');
  };
  const secure = () => !!$.IsSecureEventInputEnabled(); // a password field has the keyboard
  try {
    if (r.before) shot(r.before);
    if (r.op === 'screens') {
      const list = $.NSScreen.screens, main = list.objectAtIndex(0).frame, out = [];
      for (let i = 0; i < list.count; i++) {
        const s = list.objectAtIndex(i), f = s.frame;
        out.push({ x: f.origin.x, y: main.size.height - f.origin.y - f.size.height, w: f.size.width, h: f.size.height, primary: i === 0, scale: s.backingScaleFactor });
      }
      return JSON.stringify({ ok: true, screens: out });
    }
    if (r.op === 'shot') { shot(r); return '{"ok":true}'; }
    if (r.op === 'move') { mouse(5, r.x, r.y, 0); return '{"ok":true}'; }
    if (r.op === 'click') {
      const b = BTN[r.button] || BTN.left; mouse(5, r.x, r.y, 0);
      for (let n = 1; n <= r.count; n++) { mouse(b[0], r.x, r.y, b[2], n); mouse(b[1], r.x, r.y, b[2], n); }
      return '{"ok":true}';
    }
    if (r.op === 'drag') {
      const b = BTN[r.button] || BTN.left; mouse(5, r.x, r.y, 0); mouse(b[0], r.x, r.y, b[2], 1);
      for (let s = 1; s <= 20; s++) mouse(b[3], r.x + (r.x2 - r.x) * s / 20, r.y + (r.y2 - r.y) * s / 20, b[2]);
      mouse(b[1], r.x2, r.y2, b[2], 1); return '{"ok":true}';
    }
    if (r.op === 'scroll') { mouse(5, r.x, r.y, 0); post($.CGEventCreateScrollWheelEvent2(null, 1, 2, -r.dy, -r.dx, 0)); return '{"ok":true}'; }
    if (r.op === 'type') { if (secure()) return '{"error":"password"}'; Application('System Events').keystroke(r.text); return '{"ok":true}'; }
    if (r.op === 'keys') {
      if (r.guard && secure()) return '{"error":"password"}';
      const FLAG = { 55: 0x100000, 56: 0x20000, 59: 0x40000, 58: 0x80000 }; // cmd, shift, ctrl, option
      const key = (k, down, flags) => { const e = $.CGEventCreateKeyboardEvent(null, k, down); $.CGEventSetFlags(e, flags); post(e); };
      let flags = 0;
      for (const k of r.codes) { flags |= FLAG[k] || 0; key(k, true, flags); }
      for (const k of r.codes.slice().reverse()) { flags &= ~(FLAG[k] || 0); key(k, false, flags); }
      return '{"ok":true}';
    }
    return '{"error":"unknown request"}';
  } catch (e) { return JSON.stringify({ error: String(e.message || e) }); }
}
`;

// The badge shown on the screen itself while a session controls it, on top of every window, with a Stop button that
// prints "stop" (the person may be watching the other program, not Docket). It never takes the keyboard from the
// program being worked on, and closes when Docket's process (owner) is gone. Windows only for now: on a Mac the
// indicator is Docket's own page.
export function screenBadgeCommand(script, text, platform = process.platform, owner = process.pid) {
  if (platform !== 'win32') return null;
  return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, Buffer.from(String(text), 'utf8').toString('base64'), String(owner)] };
}
export const SCREEN_BADGE = { file: 'screen-badge.ps1', text: String.raw`param([string]$Text, [int]$Owner)
$t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Text))
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -WarningAction SilentlyContinue -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System; using System.Drawing; using System.Windows.Forms;
public class DocketBadge : Form {
  public DocketBadge(string text) {
    FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true; StartPosition = FormStartPosition.Manual;
    BackColor = Color.FromArgb(196, 64, 24);
    var row = new FlowLayoutPanel(); row.AutoSize = true; row.WrapContents = false; row.BackColor = BackColor;
    var label = new Label(); label.Text = text; label.ForeColor = Color.White; label.AutoSize = true; label.Font = new Font("Segoe UI", 10f, FontStyle.Bold); label.Margin = new Padding(0, 7, 10, 0);
    var stop = new Button(); stop.Text = "Stop"; stop.AutoSize = true; stop.FlatStyle = FlatStyle.Flat; stop.BackColor = Color.White; stop.ForeColor = Color.Black; stop.Font = new Font("Segoe UI", 10f);
    stop.Click += delegate { Console.Out.WriteLine("stop"); Console.Out.Flush(); };
    row.Controls.Add(label); row.Controls.Add(stop); Controls.Add(row);
    row.Location = new Point(10, 4); ClientSize = new Size(row.PreferredSize.Width + 14, row.PreferredSize.Height + 8);
  }
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams { get { var p = base.CreateParams; p.ExStyle |= 0x08000000 | 0x80 | 0x8; return p; } } // no activate, tool window, topmost
  protected override void OnShown(EventArgs e) { base.OnShown(e); var a = Screen.PrimaryScreen.WorkingArea; Location = new Point(a.Left + (a.Width - Width) / 2, a.Top + 6); }
}
'@
$f = New-Object DocketBadge $t
# Gone with the Docket that showed it, even one that crashed.
$timer = New-Object Windows.Forms.Timer; $timer.Interval = 2000
$timer.add_Tick({ if (-not (Get-Process -Id $Owner -ErrorAction SilentlyContinue)) { $f.Close() } }); $timer.Start()
[Windows.Forms.Application]::Run($f)
` };

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

// Whether this computer runs on its battery, and how full that is, for ☰ > Gauges > Performance (#935). Windows: one
// PowerShell call to Win32_Battery (a desktop has none and prints nothing). macOS: pmset -g batt, whose first line
// says what it draws from ('AC Power', 'Battery Power' or 'UPS Power'). Elsewhere: none.
export function batteryCommand(platform = process.platform) {
  if (platform === 'win32') return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Battery | Select-Object BatteryStatus,EstimatedChargeRemaining | ConvertTo-Json -Compress'] };
  if (platform === 'darwin') return { cmd: 'pmset', args: ['-g', 'batt'] };
  return null;
}
// The output of batteryCommand as { battery, onBattery, percent }: battery false (and the others null) when the
// computer has none. Win32_Battery's BatteryStatus is 1 while discharging, 4 or 5 when low or critical (still
// discharging), and 2, 3 or 6–11 on mains power; with two batteries, either discharging means on battery.
export function parseBattery(text, platform = process.platform) {
  const none = { battery: false, onBattery: null, percent: null };
  if (platform === 'win32') {
    let l; try { l = JSON.parse(String(text).trim() || 'null'); } catch { return none; }
    const list = (Array.isArray(l) ? l : [l]).filter(Boolean);
    if (!list.length) return none;
    const pcts = list.map((b) => Number(b.EstimatedChargeRemaining)).filter((n) => Number.isFinite(n));
    return { battery: true, onBattery: list.some((b) => [1, 4, 5].includes(Number(b.BatteryStatus))),
      percent: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null };
  }
  if (platform === 'darwin') {
    const t = String(text);
    const from = /drawing from '([^']+)'/i.exec(t)?.[1] || '';
    const pct = /InternalBattery[^\n]*?(\d{1,3})%/.exec(t);
    if (!pct) return none; // a desktop Mac (a UPS line alone does not count as a battery here)
    return { battery: true, onBattery: /battery/i.test(from), percent: Number(pct[1]) };
  }
  return none;
}
