// Searching what was said in sessions, in Claude's conversation files and in the chats Docket keeps for
// sessions another AI runs: only the words the person and the AI typed, never
// tool output, thinking or the instructions Claude Code loads, which mention every app by name.
// Measured 2026-10-27: 1.32 GB of conversation files hold about 23 MB of typed text.
import fs from 'node:fs';

// Text Claude Code or Docket adds to a message the person never typed.
const INJECTED = [
  /<system-reminder>[\s\S]*?(<\/system-reminder>|$)/g,
  /<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat)>[\s\S]*?<\/\1>/g,
  /\(From Docket:[^\n]*/g,
];
const clean = (t) => INJECTED.reduce((s, re) => s.replace(re, ''), String(t)).trim();

// The typed text of one line of a conversation file ('' when it holds none).
export function typedText(line) {
  if (!line || !(line.includes('"type":"user"') || line.includes('"type":"assistant"'))) return '';
  // Tool output is most of a file's size and never typed, so its lines are skipped without decoding them.
  // (The same words typed in a message are escaped, \"type\", so they never match here.)
  if (line.includes('"type":"tool_result"')) return '';
  let o;
  try { o = JSON.parse(line); } catch { return ''; }
  if (!o.type && o.msg) o = o.msg; // a line of a chat Docket keeps for a session not run by Claude: { seq, msg }
  if (o.type !== 'user' && o.type !== 'assistant') return '';
  if (o.isMeta || o.isCompactSummary || o.isSidechain) return ''; // added by Claude Code, a summary, or a helper's chat
  const c = o.message?.content;
  if (typeof c === 'string') return clean(c);
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => clean(b.text)).filter(Boolean).join('\n');
}

// The typed text of a run of lines, and how far it got: a last line still being written is left for next time.
export function typedTextOf(chunk) {
  const end = chunk.lastIndexOf('\n');
  if (end < 0) return { text: '', used: 0 };
  const parts = [];
  for (const line of chunk.slice(0, end).split('\n')) { const t = typedText(line); if (t) parts.push(t); }
  return { text: parts.join('\n'), used: Buffer.byteLength(chunk.slice(0, end + 1)) };
}

// One index per company. Each entry is a conversation file's typed text, plus the size and time it
// was read at, so an entry is read again only when its file changes, and a file that grew (the
// usual case: a new message) is read only from where it was last read.
export function createIndex() {
  const entries = new Map(); // session id -> { file, mtime, size, text }
  let building = null, built = false;
  const yieldNow = () => new Promise((r) => setImmediate(r));

  async function readFrom(file, from, to) {
    const fh = await fs.promises.open(file, 'r');
    try {
      const out = Buffer.alloc(to - from);
      let at = 0;
      while (at < out.length) { const { bytesRead } = await fh.read(out, at, out.length - at, from + at); if (!bytesRead) break; at += bytesRead; }
      return out.subarray(0, at).toString('utf8');
    } finally { await fh.close(); }
  }

  async function refreshOne(id, file) {
    let st;
    try { st = await fs.promises.stat(file); } catch { entries.delete(id); return; }
    const e = entries.get(id);
    if (e && e.file === file && e.mtime === st.mtimeMs && e.size === st.size) return;
    const grew = e && e.file === file && st.size > e.size;
    const from = grew ? e.size : 0;
    // Big files are read a piece at a time, so the page never waits on one long parse.
    const STEP = 8 * 1024 * 1024;
    let text = grew ? e.text : '', at = from;
    while (at < st.size) {
      const chunk = await readFrom(file, at, Math.min(st.size, at + STEP));
      const { text: t, used } = typedTextOf(chunk);
      if (t) text += (text ? '\n' : '') + t;
      if (!used) { if (at + STEP < st.size) { // one line longer than a piece: read it whole
        const whole = await readFrom(file, at, st.size); const r = typedTextOf(whole);
        if (r.text) text += (text ? '\n' : '') + r.text; at += r.used;
      } break; }
      at += used;
      await yieldNow();
    }
    entries.set(id, { file, mtime: st.mtimeMs, size: at, text });
  }

  // files: Map of session id -> conversation file. Brings every entry up to date; one run at a time.
  function refresh(files) {
    if (building) return building;
    building = (async () => {
      for (const id of entries.keys()) if (!files.has(id)) entries.delete(id);
      for (const [id, file] of files) { await refreshOne(id, file).catch(() => {}); }
      built = true;
    })().finally(() => { building = null; });
    return building;
  }

  // Case-insensitive plain text search. Returns { id: snippet } for every session that holds q.
  function search(q, { around = 50 } = {}) {
    const out = {};
    if (!q) return out;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    for (const [id, e] of entries) {
      const m = re.exec(e.text);
      if (!m) continue;
      const a = Math.max(0, m.index - around), b = Math.min(e.text.length, m.index + m[0].length + around);
      out[id] = (a ? '…' : '') + e.text.slice(a, b).replace(/\s+/g, ' ').trim() + (b < e.text.length ? '…' : '');
    }
    return out;
  }

  const stats = () => { let chars = 0; for (const e of entries.values()) chars += e.text.length; return { sessions: entries.size, chars }; };
  return { refresh, search, stats, get building() { return !!building; }, get built() { return built; } };
}
