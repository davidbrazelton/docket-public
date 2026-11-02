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
// Testing Helper (Renderer)").
export function processListCommand(platform = process.platform) {
  if (platform === 'win32') return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,KernelModeTime,UserModeTime | ConvertTo-Json -Compress'] };
  return { cmd: 'ps', args: ['-axo', 'pid=,ppid=,rss=,time=,comm='] };
}
// ps's time column in seconds.
const psSeconds = (t) => {
  const [d, rest] = t.includes('-') ? t.split('-') : [0, t];
  return rest.split(':').reduce((a, x) => a * 60 + Number(x), 0) + Number(d) * 86400 || 0;
};
// The output of processListCommand as [{ pid, ppid, name, mem, cpu }]: name is the program's own name in lower
// case, without its folder or .exe; mem is in bytes; cpu is the processor time used so far, in seconds.
export function parseProcessList(text, platform = process.platform) {
  const name = (s) => String(s || '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
  if (platform === 'win32') {
    let l; try { l = JSON.parse(text); } catch { return []; }
    return (Array.isArray(l) ? l : [l]).filter(Boolean)
      .map((p) => ({ pid: Number(p.ProcessId), ppid: Number(p.ParentProcessId), name: name(p.Name), mem: Number(p.WorkingSetSize) || 0,
        cpu: ((Number(p.KernelModeTime) || 0) + (Number(p.UserModeTime) || 0)) / 1e7 }));
  }
  return String(text).split('\n').map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d:.-]+)\s+(.+?)\s*$/)).filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), name: name(m[5]), mem: Number(m[3]) * 1024, cpu: psSeconds(m[4]) }));
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
