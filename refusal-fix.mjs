// What Docket offers on a step Claude Code's Auto mode turned down (#1285): the permission rule that would let it run
// next time (allowRule), shown on the refused line and applied through a settings card (suggest_settings, #1239), and
// whether the refusal more likely comes from how Docket set the session up than from what the session tried
// (docketCause), in which case allowing it only hides the problem. Kept apart from the server so it can be tested.
import path from 'node:path';
import { ruleError } from './terminal-commands.mjs';

// The rule for permissions.allow that lets this one step run, or '' when there is no narrow one to offer. An MCP tool
// is allowed by name. A command only as it is, word for word: Auto mode drops broad Bash and PowerShell rules anyway, and
// a blanket one would let any command through. A web fetch for its site. Anything else (file edits, writes) gets none:
// a rule broad enough to be worth a click would let every edit through.
export function allowRule(name, input = {}) {
  const n = String(name || '');
  let rule = '';
  if (/^mcp__\w[\w-]*__\w[\w-]*$/.test(n)) rule = n;
  else if ((n === 'Bash' || n === 'PowerShell') && typeof input?.command === 'string') {
    const c = input.command.trim();
    if (c && c.length <= 300 && !/[\r\n()]/.test(c)) rule = `${n}(${c})`;
  } else if (n === 'WebFetch' && typeof input?.url === 'string') {
    try { const host = new URL(input.url).hostname; if (host) rule = `WebFetch(domain:${host})`; } catch {}
  }
  return rule && !ruleError(rule) ? rule : '';
}

// The merge patch for the settings file as it is now (currentText, '' for none) that adds rule to permissions.allow, or
// '' when the file has it already. The whole list goes in the patch: a merge patch replaces a list, it does not add to it.
export function allowPatch(currentText, rule) {
  let cur = {};
  try { cur = String(currentText || '').trim() ? JSON.parse(String(currentText).replace(/^﻿/, '')) : {}; } catch { cur = {}; }
  const allow = Array.isArray(cur?.permissions?.allow) ? cur.permissions.allow : [];
  if (allow.includes(rule)) return '';
  return JSON.stringify({ permissions: { allow: [...allow, rule] } });
}

// Every string in a tool's input, however deep.
function strings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}
const inside = (p, folder, P) => {
  const a = P.resolve(p).toLowerCase(), b = P.resolve(folder).toLowerCase();
  return a === b || a.startsWith(b.endsWith(P.sep) ? b : b + P.sep);
};

// Why a refused step looks like Docket's doing rather than the session's, or ''. folders: Docket's own (its folder, its
// data, its uploads). A step of Docket's own tools, or of the private browser Docket gives each session, or one that
// names a path in Docket's folders: Auto mode reads a session touching those as one tampering with its overseer. A path
// counts on its own (file_path) or as a word of a command. A folder the session works in (cwd) does not count: a session
// on Docket itself is meant to touch it.
export function docketCause({ name, input, folders = [], cwd = '', platform = process.platform }) {
  const P = platform === 'win32' ? path.win32 : path.posix;
  const n = String(name || '');
  if (n.startsWith('mcp__portal__')) return "it is one of Docket's own tools, which Docket's sessions are meant to use";
  if (n.startsWith('mcp__playwright__')) return 'it is the private browser Docket gives each session, so how Docket sets that browser up is the likely cause';
  const theirs = folders.filter((f) => f && !(cwd && inside(cwd, f, P)));
  const words = strings(input).flatMap((s) => s.split(/[\s"'`;|&()<>,=]+/));
  const hit = words.find((s) => s && P.isAbsolute(s) && theirs.some((f) => inside(s, f, P)));
  return hit ? `it names ${hit.slice(0, 200)}, inside Docket's own folders, which a session should not have to touch` : '';
}
