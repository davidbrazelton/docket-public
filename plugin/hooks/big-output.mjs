// PostToolUse hook: a big Bash, Read or MCP result is kept on disk, and the session gets its head, its tail and
// where the rest is (#748). A Docket hook: a desk turns it off with "big-output" in docketHooks.off.
//
// Tool results are the largest part of what a session's context costs, and a big one is carried, and paid for
// again, in every later call until compaction. Claude Code lets this hook replace the result (updatedToolOutput)
// with a value of the tool's own shape (Claude Code 2.1.317, checked 2026-11-06):
//   Bash  { stdout, stderr, interrupted, isImage, ... }: stdout over the limit is saved to a file and cut.
//   Read  { type: 'text', file: { filePath, content, numLines, startLine, totalLines } }: the file is already on
//         disk, so nothing is saved. Claude Code numbers the content's lines from startLine, so the content keeps
//         only the head (numbered right) and the tail comes as additionalContext with its own line numbers.
//   MCP   [{ type: 'text', text }, ...]: the text blocks are saved to a file and given back as one cut block.
// Left alone: failures (Claude Code sends those to PostToolUseFailure, not here), a Bash command that asks for a
// range itself (ends in head, tail or sed -n), a Read with offset, limit or allow_large, anything with an image,
// and a read of a saved output itself.
//
// Each cut, and each later read of what was cut, is a line in <dir>/log.jsonl, which the Usage page adds up.
// The limits are in output-limits.mjs. DOCKET_TOOL_OUTPUT_DIR (set by the app) is the session's folder.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isOff } from './off.mjs';
import { CUT_OVER_CHARS, HEAD_CHARS, TAIL_CHARS } from '../../output-limits.mjs';
import { OUTPUT_LOG as LOG, readLog as readLines } from '../../big-output-use.mjs';

export const NAME = 'big-output';

const tokens = (n) => `about ${Math.round(n * 0.45 / 1000)}k tokens`;
const num = (n) => n.toLocaleString('en-US');
// A range a Bash command asks for itself: its last step is head, tail or sed -n.
const asksRange = (cmd) => /(?:^|[|;&]\s*)(?:head|tail|sed\s+-n)\b[^|;&]*$/.test(String(cmd || '').trim());
// A path compared loosely: one slash kind, no case on Windows, and Git Bash's /c/ for C:.
const loose = (p) => String(p || '').replace(/\\/g, '/').replace(/^\/([a-z])\//i, '$1:/').toLowerCase();

// The first and last whole lines of text within the budgets.
function ends(text, head = HEAD_CHARS, tail = TAIL_CHARS) {
  let h = text.slice(0, head);
  const hn = h.lastIndexOf('\n');
  if (hn > head * 0.8) h = h.slice(0, hn);
  let t = text.slice(text.length - tail);
  const tn = t.indexOf('\n');
  if (tn >= 0 && tn < tail * 0.2) t = t.slice(tn + 1);
  return { head: h, tail: t };
}
// A long text as its head, a note saying where the whole of it is, and its tail.
export function cutText(text, file) {
  const { head, tail } = ends(text);
  return `${head}\n\n[Docket: this output is ${num(text.length)} characters (${tokens(text.length)}), so only its start and end are shown. ` +
    `The full output is saved to ${file}; read ranges from it as needed (Read with offset and limit, or grep).]\n\n${tail}`;
}

// What the hook does with one result: null to leave it, else { out, save, log }: the hook's answer, the text to save
// at save.file (none for Read), and the log line. dir: the session's folder for saved outputs.
export function decide(input, dir) {
  const tool = String(input?.tool_name || ''), args = input?.tool_input || {}, res = input?.tool_response;
  if (!res || !dir) return null;
  const file = path.join(dir, `${String(input.tool_use_id || Date.now()).replace(/[^\w.-]/g, '_')}.txt`);
  const answer = (updatedToolOutput, extra = {}) => ({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput, ...extra } });

  if (tool === 'Bash') {
    const out = typeof res.stdout === 'string' ? res.stdout : '';
    if (res.interrupted || res.isImage || out.length <= CUT_OVER_CHARS || asksRange(args.command)) return null;
    const saved = res.stderr ? `${out}\n\n--- stderr ---\n${res.stderr}` : out;
    return { out: answer({ ...res, stdout: cutText(out, file) }), save: { file, text: saved }, log: { tool, chars: saved.length, kept: HEAD_CHARS + TAIL_CHARS, file } };
  }

  if (tool === 'Read') {
    const f = res.file;
    if (res.type !== 'text' || typeof f?.content !== 'string' || f.content.length <= CUT_OVER_CHARS) return null;
    if (args.offset != null || args.limit != null || args.allow_large || args.pages) return null;
    if (loose(f.filePath || args.file_path).startsWith(loose(dir))) return null; // a saved output, read on purpose
    const lines = f.content.split('\n'), start = Number(f.startLine) || 1, total = Number(f.totalLines) || lines.length;
    const { head, tail } = ends(f.content);
    const headLines = head.split('\n').length, tailLines = tail.split('\n'), from = start + lines.length - tailLines.length;
    const where = f.filePath || args.file_path;
    const content = `${head}\n[Docket: lines ${start}-${start + headLines - 1} of ${num(total)} shown; the file is ${num(f.content.length)} characters (${tokens(f.content.length)}). ` +
      `Read the rest with offset and limit (a whole-file Read gives this same cut). Its last lines are in the note below.]`;
    const additionalContext = `The end of ${where} (lines ${from}-${start + lines.length - 1}), which the cut Read above left out:\n` +
      tailLines.map((l, i) => `${from + i}\t${l}`).join('\n');
    return { out: answer({ ...res, file: { ...f, content } }, { additionalContext }), log: { tool, chars: f.content.length, kept: content.length + additionalContext.length, file: where } };
  }

  if (tool.startsWith('mcp__')) {
    const blocks = Array.isArray(res) ? res : Array.isArray(res.content) ? res.content : null;
    const text = typeof res === 'string' ? res : blocks?.every((b) => b?.type === 'text') ? blocks.map((b) => b.text || '').join('\n') : null;
    if (text == null || text.length <= CUT_OVER_CHARS) return null;
    const cut = cutText(text, file);
    const value = typeof res === 'string' ? cut : Array.isArray(res) ? [{ type: 'text', text: cut }] : { ...res, content: [{ type: 'text', text: cut }] };
    return { out: answer(value), save: { file, text }, log: { tool, chars: text.length, kept: HEAD_CHARS + TAIL_CHARS, file } };
  }
  return null;
}

// Whether this call reads back something cut earlier in the session: a saved output (by its file name), or a ranged
// Read of a file whose whole-file Read was cut. cuts: the session's earlier log lines.
export function rereadOf(input, dir, cuts) {
  const tool = String(input?.tool_name || ''), args = input?.tool_input || {};
  const files = cuts.filter((c) => c.kind === 'cut' && c.file).map((c) => c.file);
  if (!files.length) return null;
  if (tool === 'Read') {
    const p = loose(args.file_path);
    const hit = files.find((f) => loose(f) === p);
    return hit ? { tool, file: hit } : null;
  }
  const hay = loose(tool === 'Bash' ? args.command : tool === 'Grep' ? args.path : '');
  if (!hay) return null;
  const hit = files.find((f) => hay.includes(loose(f)) || (loose(f).startsWith(loose(dir)) && hay.includes(loose(path.basename(f)))));
  return hit ? { tool, file: hit } : null;
}

const readLog = (dir) => readLines(path.join(dir, LOG));
const addLog = (dir, line) => fs.appendFileSync(path.join(dir, LOG), JSON.stringify({ at: new Date().toISOString(), ...line }) + '\n');

async function main() {
  const dir = process.env.DOCKET_TOOL_OUTPUT_DIR;
  if (isOff(NAME) || process.env.DOCKET_ENGINE !== 'claude' || !dir) return;
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  try {
    const back = rereadOf(input, dir, readLog(dir));
    if (back) addLog(dir, { kind: 'reread', ...back });
    const d = decide(input, dir);
    if (!d) return;
    fs.mkdirSync(dir, { recursive: true });
    if (d.save) fs.writeFileSync(d.save.file, d.save.text);
    addLog(dir, { kind: 'cut', ...d.log });
    process.stdout.write(JSON.stringify(d.out));
  } catch {} // any failure leaves the result as it was
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
