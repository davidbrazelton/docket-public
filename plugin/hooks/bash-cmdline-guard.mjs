// PreToolUse hook for the Bash tool on Windows (Claude Code 2.1.260, measured 2026-09-09).
// A Docket hook: a company turns it off with "bash-cmdline-guard" in docketHooks.off.
//
// Claude Code runs every Bash tool command as one Windows command line:
//   bash.exe -c "source <snapshot> ... && eval '<command>' && pwd -P >| '<cwd file>'"
// Two things go wrong with that on Windows:
//
// 1. Length. Windows cuts the command line at 8191 characters. The tail of a
//    longer command is silently dropped and bash reports
//    "unexpected EOF while looking for matching `''", which looks like a
//    quoting mistake but is a length limit. Measured overhead: 405 chars of
//    wrapper before the command, about 75 after it. Escaping costs, read back
//    from Win32_Process: each ' becomes '"'"' with the quotes escaped (+6),
//    each " becomes \" (+1, and a backslash right before it is doubled, +1).
//    $ and backtick cost nothing.
//
// 2. Backslashes. The harness does not double backslashes, but the MSYS
//    command-line parser collapses every pair of backslashes to one (unless
//    the pair sits before a double quote). Inside a heredoc body that means
//    the file written, or the script fed to python/node, is silently
//    corrupted, so that case is denied. In inline shell text the pair is
//    often collapsed by bash itself anyway, so that case is allowed with a
//    warning handed back to the model as context.
//
// Other systems have neither problem, so there the hook does nothing.
//
// Grok sessions (Grok 1.0.41, measured 2026-10-27) run every shell command as
//   "powershell.exe" -NoProfile -NonInteractive -Command "<command>"
// started directly, without cmd.exe, so the limit is the 32767 characters Windows
// allows any program's command line, past which the command does not start at all.
// Escaping: each " becomes \" (+1, and the backslashes right before it are doubled).
// PowerShell has no backslash problem, so only the length is checked there.
// Grok's tool is run_terminal_command, which a "Bash" matcher also selects; its hook
// input carries Claude's tool_name and tool_input as well as Grok's own names.
//
// DOCKET_CMDLINE_LIMIT, when set, replaces the Windows limit (for testing the hook
// end to end with a command short enough to type).
//
// NOTE: this file itself must never contain two consecutive backslashes,
// for the reason in point 2. Use "\x5c" to spell a backslash.

import { pathToFileURL } from 'node:url';
import { isOff } from './off.mjs';

export const NAME = 'bash-cmdline-guard';
const WINDOWS_LIMIT = 8191;
const WRAPPER_PREFIX = 405;
const WRAPPER_SUFFIX = 80;
const MARGIN = 100;
const BS = "\x5c";
const DQ = "\x22";
const pairNotBeforeQuote = new RegExp(BS + BS + BS + BS + "(?!" + DQ + ")");
const heredocRe = /<<-?[ \t]*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g;

const GROK_LIMIT = 32767;
const GROK_PREFIX = 54; // "powershell.exe" -NoProfile -NonInteractive -Command "
const GROK_SUFFIX = 1;

// The same check for a Grok session's PowerShell command: null to let it run, else the hookSpecificOutput Grok reads.
export function checkGrok(cmd, limit = GROK_LIMIT) {
  cmd = String(cmd || '');
  let escaped = cmd.length, run = 0;
  for (const ch of cmd) {
    if (ch === DQ) escaped += 1 + run;
    run = ch === BS ? run + 1 : 0;
  }
  escaped += run; // backslashes at the very end sit before the closing quote, so they are doubled too
  const total = GROK_PREFIX + escaped + GROK_SUFFIX;
  if (total + MARGIN <= limit) return null;
  return {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason:
      `Shell command too long for Windows: ${cmd.length} chars, ${total} on the PowerShell command line, ` +
      `over the ${limit}-char limit Windows puts on starting a program, so the command would not start at all. ` +
      `Write the content or script to a file with your file tool first and run that file, ` +
      `or split the work into commands under 20000 characters each.`,
  };
}

// What the hook answers for one command: null to let it run untouched, else Claude's hookSpecificOutput.
export function check(cmd, limit = WINDOWS_LIMIT) {
  cmd = String(cmd || '');
  let escaped = cmd.length;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === "'") escaped += 6;
    else if (ch === DQ) escaped += 1 + (i > 0 && cmd[i - 1] === BS ? 1 : 0);
  }
  const total = WRAPPER_PREFIX + escaped + WRAPPER_SUFFIX;

  const out = { hookEventName: "PreToolUse" };
  if (total + MARGIN > limit) {
    out.permissionDecision = "deny";
    out.permissionDecisionReason =
      `Bash command too long for Windows: ${cmd.length} chars, ${escaped} after shell escaping, ` +
      `${total} with the harness wrapper, over the ${limit}-char command-line limit. ` +
      `Windows would truncate it and bash would fail with "unexpected EOF while looking for matching quote". ` +
      `This is a length limit, not a quoting problem, so do not rework the quoting. ` +
      `Create or overwrite the file with the Write tool (no size limit) instead of a heredoc, ` +
      `or split the work into Bash commands under 5000 characters each. ` +
      `For a long gh issue/PR body, Write the body to a file and pass --body-file.`;
  } else if (pairNotBeforeQuote.test(cmd)) {
    let inBody = false;
    let m;
    heredocRe.lastIndex = 0;
    while ((m = heredocRe.exec(cmd)) !== null) {
      if (pairNotBeforeQuote.test(m[3])) { inBody = true; break; }
    }
    if (inBody) {
      out.permissionDecision = "deny";
      out.permissionDecisionReason =
        `This heredoc body contains two consecutive backslashes. On Windows the Bash tool collapses ` +
        `every backslash pair to a single backslash before bash runs (a Claude Code command-line ` +
        `escaping bug), so the file or script would be silently corrupted. ` +
        `Write that content with the Write tool instead (any size, bytes preserved). ` +
        `In an unavoidable shell string, spell a literal backslash as \x5cx5c in a JS/Python string ` +
        `or printf format.`;
    } else {
      out.additionalContext =
        `Warning from the Windows Bash guard: this command contains a backslash pair outside a heredoc. ` +
        `The Bash tool collapses every backslash pair to one backslash before bash runs, so the command ` +
        `may not have done what was written. If the result looks wrong, that is why; put such content ` +
        `in with the Write tool, or spell a literal backslash as \x5cx5c.`;
    }
  }
  return Object.keys(out).length === 1 ? null : out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.platform !== 'win32' || isOff(NAME)) process.exit(0);
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    let cmd = "", grok = process.env.DOCKET_ENGINE === "grok";
    try {
      const input = JSON.parse(raw);
      cmd = String((input.tool_input && input.tool_input.command) || "");
      if (input.tool_name === "run_terminal_command") grok = true;
    } catch {
      process.exit(0);
    }
    const limit = Number(process.env.DOCKET_CMDLINE_LIMIT) || undefined;
    const out = grok ? checkGrok(cmd, limit) : check(cmd, limit);
    if (out) process.stdout.write(JSON.stringify({ hookSpecificOutput: out }));
  });
}
