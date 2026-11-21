// Oversized instruction files (#1021). When a session resumes, Claude Code reads the folder's instruction files again
// (the desk's CLAUDE.md, each CLAUDE.md from the folder up, and every @file they pull in) and sends them as an
// "instructions" attachment. A file that grew (a changelog, history, generated state) makes that re-send big enough
// to push a long conversation past the model's limit, and the turn ends in "Prompt is too long". This measures what
// will be sent, reads what was sent from a session's log, explains the error, and writes the brief for the fix.
// It only reads files; the paths that differ between Windows and macOS are in platform.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { importTarget, fileKey } from './platform.mjs';
import { PER_CHAR } from './setup-size.mjs';

// Over this many characters the session's row shows the indicator (adjustable: instructionsLimit in Docket settings).
export const INSTR_LIMIT = 100 * 1024;
// How deep @imports go, as in Claude Code.
export const IMPORT_DEPTH = 5;
const NAMES = ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'];

const readFile = (f) => { try { return fs.statSync(f).isFile() ? fs.readFileSync(f, 'utf8') : null; } catch { return null; } };
const isWorktreeRoot = (d) => { try { return fs.statSync(path.join(d, '.git')).isFile(); } catch { return false; } };

// The @path references in an instruction file's text: an @ at the start of a line or after a space, outside code.
export function importRefs(text) {
  const plain = String(text || '').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const out = [];
  for (const m of plain.matchAll(/(?:^|\s)@((?:~[\\/]|[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\\/])?[^\s@)\]"'<>]+)/g)) {
    const ref = m[1].replace(/[.,;:!?]+$/, '');
    if (ref && !out.includes(ref)) out.push(ref);
  }
  return out;
}

// The folders whose CLAUDE.md files Claude Code reads for a session in dir: dir and each folder above it, outermost
// first. A git worktree stops at its own root (the main copy's files above it are not sent, as the logs show).
export function foldersUp(dir, { platform = process.platform, worktreeRoot = isWorktreeRoot } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const out = [];
  for (let d = p.resolve(dir); ; d = p.dirname(d)) {
    out.push(d);
    if (worktreeRoot(d) || p.dirname(d) === d) break;
  }
  return out.reverse();
}

// Everything Claude Code loads as instructions for a session in dir: { files: [{ path, chars, by, scope }], total,
// biggest }. by: the file that pulled it in (null for one Claude Code finds by its name); scope: 'user' for the desk's
// own CLAUDE.md and what it imports, 'project' for the folder's. Each file counts once (Claude Code sends it once),
// an import cycle stops where it closes, and a missing file is left out. read/worktreeRoot: for tests.
export function measureInstructions({ dir, home, userHome = '', platform = process.platform, read = readFile, worktreeRoot = isWorktreeRoot, depth = IMPORT_DEPTH }) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const seen = new Set(), files = [];
  const add = (file, by, scope, level) => {
    const k = fileKey(file, platform);
    if (seen.has(k)) return;
    const text = read(file);
    if (text == null) return;
    seen.add(k);
    files.push({ path: file, chars: text.length, by, scope });
    if (level >= depth) return;
    for (const ref of importRefs(text)) add(importTarget(ref, file, { home: userHome, platform }), file, scope, level + 1);
  };
  if (home) add(p.join(home, 'CLAUDE.md'), null, 'user', 0);
  if (dir) for (const d of foldersUp(dir, { platform, worktreeRoot })) for (const n of NAMES) add(p.join(d, n), null, 'project', 0);
  const total = files.reduce((a, f) => a + f.chars, 0);
  const biggest = files.reduce((a, f) => (!a || f.chars > a.chars ? f : a), null);
  return { files, total, biggest };
}

// The last instructions attachment in a session's log lines (text or parsed entries): what Claude Code really sent.
// { at, chars, files: [{ path, chars }] }, or null when the log has none.
export function sentInstructions(lines) {
  let last = null;
  for (const l of lines) {
    if (typeof l === 'string' && !l.includes('"instructions"')) continue;
    let e; try { e = typeof l === 'string' ? JSON.parse(l) : l; } catch { continue; }
    const a = e?.attachment;
    if (a?.type !== 'instructions' || !Array.isArray(a.files)) continue;
    const files = a.files.map((f) => ({ path: String(f.path || ''), chars: String(f.content || '').length }));
    last = { at: Date.parse(e.timestamp) || 0, chars: files.reduce((x, f) => x + f.chars, 0), files };
  }
  return last;
}

// The error Claude Code ends a turn with when the request is over the model's limit.
export const tooLong = (text) => /\bprompt is too long\b/i.test(String(text || ''));

// "923 KB", "1.2 MB".
export function sizeText(chars) {
  if (chars >= 1024 * 1024) return `${(chars / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(chars / 1024))} KB`;
}
const base = (f) => String(f || '').split(/[\\/]/).pop();
// About how many tokens the instructions take (the same fit as the setup check).
export const instrTokens = (chars) => Math.round(chars * PER_CHAR);

// The short form the page shows: the total, the biggest file and what pulled it in, and every file's name and size.
export function summary(m, limit = INSTR_LIMIT) {
  if (!m) return null;
  const b = m.biggest;
  return { total: m.total, tokens: instrTokens(m.total), over: m.total >= limit,
    biggest: b ? { name: base(b.path), path: b.path, chars: b.chars, by: b.by ? base(b.by) : '' } : null,
    files: m.files.map((f) => ({ name: base(f.path), path: f.path, chars: f.chars, by: f.by ? base(f.by) : '', scope: f.scope })) };
}

// Whether resuming now would likely go over the limit: the last measured conversation size plus the instructions
// Claude Code sends again on resume. limit: where the model stops (Docket knows its auto-compact point, a little under).
export const resumeRisk = ({ tokens = 0, limit = 0, chars = 0 }) => !!limit && !!tokens && tokens + instrTokens(chars) >= limit;

// The line shown in place of the bare "Prompt is too long": what is sent again on every resume. With instruction files
// under the limit, the conversation itself is the cause.
export function explain(sum, limit = INSTR_LIMIT) {
  if (!sum?.biggest || sum.total < limit) return `The conversation is over the model's limit${sum?.total ? ` (its instruction files, ${sizeText(sum.total)}, are not the cause)` : ''}.`;
  const b = sum.biggest;
  const head = `\`${b.name}\` (${sizeText(b.chars)})${b.by ? `, pulled in by \`${b.by}\`,` : ''} is sent again on every resume`;
  const all = sum.files.length > 1 ? `; all instruction files come to ${sizeText(sum.total)}` : '';
  return `${head}${all}. With a conversation this long, that re-send goes over the model's limit.`;
}

// The brief for the session that fixes it, in the repo that holds the files.
export function fixBrief({ repo, sum, limit = INSTR_LIMIT }) {
  const list = sum.files.filter((f) => f.scope === 'project').sort((a, b) => b.chars - a.chars)
    .map((f) => `- ${f.path}: ${sizeText(f.chars)}${f.by ? ` (pulled in by ${f.by})` : ''}`).join('\n');
  return [
    `This repo's instruction files are too big. Claude Code sends CLAUDE.md, and every file it pulls in with an @path line, again each time a session here resumes. Together they come to ${sizeText(sum.total)} (about ${Math.round(instrTokens(sum.total) / 1000)}k tokens), so a long session that resumes goes over the model's limit and stops with "Prompt is too long".`,
    `The instruction files, biggest first:\n${list}`,
    `Make them small (under ${sizeText(limit)} in all) without losing what sessions need every time:`,
    '1. Keep in CLAUDE.md only the rules every session needs: how to build, test and ship, and the conventions to follow.',
    '2. Move history, changelogs, decision logs and generated state out of CLAUDE.md and out of every file it pulls in. They stay in the repo as plain files (for example under docs/), and CLAUDE.md names them in one line each, without the @, so a session reads them only when it needs them.',
    '3. Remove the @path lines that pull in big files; a tool that writes such a file keeps writing it, just not into what CLAUDE.md imports.',
    "4. Follow this repo's own rules for changes (its branch and pull request steps). Open a pull request saying what moved where and the new total size, and do not merge it: the user reviews it.",
  ].join('\n\n');
}

// Whether a worktree's folder may go to the Recycle Bin, and if not, why. Only when nothing there can be lost:
// - clean: `git status --porcelain` printed nothing (no edits outside a git commit, no untracked files; ignored files
//   don't count). null (git could not tell) counts as not clean.
// - gone: its branch's remote branch was deleted, the mark a merged pull request leaves. "Merged" by ancestry is not
//   enough: a branch made minutes ago with no git commits of its own is "merged" too. The branch itself is kept, so
//   any git commit on it stays reachable after the folder goes.
// - not in use: no Docket session is open there, and no session's log there changed lately.
export function worktreeVerdict({ branch, clean, gone, inUse }) {
  const why = [];
  if (!clean) why.push(clean === null ? 'git could not say whether it has unsaved edits' : 'it has edits or files not in a git commit');
  if (!branch) why.push('it is on no branch');
  else if (!gone) why.push('its branch is not gone from GitHub, so not merged through a pull request');
  if (inUse) why.push('a session is using it or used it lately');
  return { removable: !why.length, why: why.join('; ') };
}
// Worktrees to list: oversized while the repo's main copy is not, each with worktreeVerdict.
// worktrees: [{ path, branch, total, clean, gone, inUse }]; main: the main copy's total.
export function staleWorktrees({ main, worktrees, limit = INSTR_LIMIT }) {
  if (main >= limit) return [];
  return worktrees.filter((w) => w.total >= limit).map((w) => ({ ...w, ...worktreeVerdict(w) }));
}
// What git says about a repo's worktrees: [{ path, branch, main, gone, clean }]. git(dir, args) resolves to its output,
// or null when git failed.
export async function worktreeFacts(repo, git) {
  const list = parseWorktrees(await git(repo, ['worktree', 'list', '--porcelain']) || '');
  const gone = goneBranches(await git(repo, ['for-each-ref', '--format=%(refname:short)|%(upstream:track)', 'refs/heads']) || '');
  const out = [];
  for (const w of list) {
    const status = w.main ? '' : await git(w.path, ['status', '--porcelain']);
    out.push({ ...w, gone: !!w.branch && gone.has(w.branch), clean: status === null ? null : !status.trim() });
  }
  return out;
}

// `git worktree list --porcelain` as [{ path, branch, main }]: the first one is the main copy.
export function parseWorktrees(text) {
  const out = [];
  for (const block of String(text || '').split(/\r?\n\r?\n/)) {
    const wt = /^worktree (.+)$/m.exec(block);
    if (!wt) continue;
    const br = /^branch refs\/heads\/(.+)$/m.exec(block);
    out.push({ path: wt[1].trim(), branch: br ? br[1].trim() : '', main: !out.length, prunable: /^prunable/m.test(block) });
  }
  return out;
}
// `git for-each-ref --format=%(refname:short)|%(upstream:track) refs/heads`: the branches whose remote branch is gone.
export const goneBranches = (text) => new Set(String(text || '').split(/\r?\n/).filter((l) => /\|\[gone\]\s*$/.test(l)).map((l) => l.split('|')[0].trim()));
