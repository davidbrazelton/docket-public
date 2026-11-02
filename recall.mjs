// Surviving compaction: a session reads back its own transcript from before its compacts (the recall tool),
// and Docket asks it to save its state once per compact cycle, shortly before auto-compact.
// Pure helpers; server.mjs finds the file, holds the session state and sends the messages.
import fs from 'node:fs';
import readline from 'node:readline';

// Default share of the auto-compact point at which Docket sends the save-before-compact turn.
export const SAVE_SHARE = 85;
// After a save turn, the next one waits for a compact, or for the context to fall well below the line again (a /clear).
const REARM = 0.8;

// A company's saveBeforeCompact as typed on the Companies screen: '' or missing is the default, 0 (or "off") turns it
// off, otherwise a whole percent from 50 to 99. Returns undefined (use the default), 0, or the percent; { error } if not.
export function cleanSaveShare(v) {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const t = String(v).trim().toLowerCase().replace(/%$/, '');
  if (t === 'off' || t === '0') return 0;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 50 || n > 99) return { error: 'Save before compact is a percent from 50 to 99, or 0 to turn it off' };
  return n;
}
export const saveShare = (client) => client?.saveBeforeCompact === undefined ? SAVE_SHARE : Number(client.saveBeforeCompact) || 0;

// What to do with a session's save-before-compact turn now: 'send' (crossed the line, none sent this cycle), 'rearm'
// (well below the line with one sent: the context was cleared), or null. The caller sends only between turns.
export function saveDue({ tokens, compactAt, share, prompted }) {
  if (!share || !tokens || !compactAt) return null;
  const line = compactAt * share / 100;
  if (prompted) return tokens < line * REARM ? 'rearm' : null;
  return tokens >= line ? 'send' : null;
}

export const SAVE_PROMPT = (pct) => `(From Docket: this conversation is at about ${pct}% of the point where it compacts automatically. A compact keeps the gist and drops exact facts. Now, before it happens, bring your plan or notes file up to date with what a summary would lose: open items and the next step, IDs (commits, branches, pull requests, tickets, session ids), conditions the user set ("merge when the review is clean"), background tasks or servers still running, and decisions made. If you keep no such file, write the same as a short "State before compact" list in your reply. Do only that, and start no new work. If your last reply asked the user something, end by asking it again in one line. After a compact, mcp__portal__recall reads back this conversation word for word.)`;
export const RECALL_NOTE = '(From Docket: this conversation was just compacted. Its summary keeps the gist, not the exact words. When you need something from before the compact word for word (a commit SHA, a pull request or ticket number, which tasks were running, or exactly what the user said), call mcp__portal__recall: search it with words, or ask for the last user messages, before acting on a memory of it.)';

function blockText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => b.type === 'text' ? b.text : b.type === 'image' ? '[image]' : '').filter(Boolean).join('\n');
}
const NOISE = /^<(command-|local-command|system-reminder)/;

// A transcript (.jsonl) as numbered entries: { n, at, seg, kind, name?, text }. seg counts the compacts before the
// entry, so seg === compacts means since the last compact. kind: person (what the person typed), session (sent by
// another session), docket (Docket's own notices), reply, tool (a call), result (what the call returned).
// docketBlock / sessionBlock: server.mjs's patterns for Docket's own text blocks in a user message.
export async function readEntries(file, { docketBlock, sessionBlock }) {
  const entries = [];
  const names = new Map(); // tool_use id -> tool name
  let seg = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"') && !line.includes('compact_boundary')) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'system' && e.subtype === 'compact_boundary') { seg++; continue; }
    if (e.isSidechain || e.isCompactSummary || e.isMeta) continue;
    const at = Date.parse(e.timestamp) || 0;
    const add = (kind, text, name) => { if (text && text.trim()) entries.push({ n: entries.length + 1, at, seg, kind, ...(name ? { name } : {}), text }); };
    const content = e.message?.content;
    if (e.type === 'assistant') {
      for (const b of Array.isArray(content) ? content : []) {
        if (b.type === 'text') add('reply', b.text);
        else if (b.type === 'tool_use') { names.set(b.id, b.name); add('tool', JSON.stringify(b.input ?? {}), b.name); }
      }
    } else if (e.type === 'user') {
      const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
      const texts = [];
      for (const b of blocks) {
        if (b.type === 'tool_result') add('result', (b.is_error ? '[error] ' : '') + blockText(b.content), names.get(b.tool_use_id));
        else if (b.type === 'text' && b.text && !NOISE.test(b.text)) texts.push(b.text);
      }
      if (!texts.length) continue;
      if (texts.some((t) => sessionBlock.test(t))) add('session', texts.join('\n'));
      else if (texts.every((t) => docketBlock.test(t))) add('docket', texts.join('\n'));
      else add('person', texts.filter((t) => !docketBlock.test(t)).join('\n'));
    }
  }
  return { entries, compacts: seg };
}

const KIND = { person: 'the user wrote', session: 'another session wrote', docket: 'Docket wrote', reply: 'you replied', tool: 'you called', result: 'tool result' };
const when = (at) => at ? new Date(at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '';
function head(e, compacts) {
  const part = !compacts ? '' : e.seg < compacts ? `before compact ${e.seg + 1}` : 'since the last compact';
  return `#${e.n} · ${[when(e.at), part, KIND[e.kind] + (e.name ? ` ${e.name}` : '')].filter(Boolean).join(' · ')}`;
}
function snippet(text, words, width = 500) {
  const low = text.toLowerCase();
  const i = Math.max(0, Math.min(...words.map((w) => low.indexOf(w)).filter((x) => x >= 0)));
  const from = Math.max(0, i - Math.floor(width / 3));
  return (from ? '…' : '') + text.slice(from, from + width).replace(/\s+/g, ' ').trim() + (from + width < text.length ? '…' : '');
}

// The newest entries holding every word (case-insensitive), as text for the tool's answer.
export function searchEntries({ entries, compacts }, query, { limit = 15, kinds } = {}) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 'Give some words to look for, or ask for the last user messages.';
  const hits = entries.filter((e) => (!kinds?.length || kinds.includes(e.kind)) && words.every((w) => e.text.toLowerCase().includes(w)));
  if (!hits.length) return `Nothing in this conversation (${entries.length} entries${compacts ? `, ${compacts} compact${compacts === 1 ? '' : 's'}` : ''}) holds all of: ${words.join(' ')}`;
  const shown = hits.slice(-limit).reverse();
  return `${hits.length} entr${hits.length === 1 ? 'y' : 'ies'} match${hits.length > shown.length ? `, newest ${shown.length} shown` : ''} (newest first). Read one whole with entry: <number>.\n\n`
    + shown.map((e) => `${head(e, compacts)}\n${snippet(e.text, words)}`).join('\n\n');
}

// The last n messages the person (or another session) sent, word for word, oldest first.
export function lastUserMessages({ entries, compacts }, n = 5) {
  const mine = entries.filter((e) => e.kind === 'person' || e.kind === 'session').slice(-n);
  if (!mine.length) return 'No user messages in this conversation.';
  return mine.map((e) => `${head(e, compacts)}\n${e.text.length > 6000 ? e.text.slice(0, 6000) + `… [${e.text.length - 6000} more characters]` : e.text}`).join('\n\n');
}

// One entry whole, with a line on each of its neighbours for context.
export function readEntry({ entries, compacts }, n, around = 2) {
  const e = entries[n - 1];
  if (!e) return `No entry #${n}: this conversation has ${entries.length}.`;
  const line = (x) => `${head(x, compacts)}: ${x.text.replace(/\s+/g, ' ').slice(0, 200)}`;
  const before = entries.slice(Math.max(0, n - 1 - around), n - 1).map(line);
  const after = entries.slice(n, n + around).map(line);
  const body = e.text.length > 20000 ? e.text.slice(0, 20000) + `… [${e.text.length - 20000} more characters]` : e.text;
  return [...before, '', `${head(e, compacts)}\n${body}`, '', ...after].join('\n').trim();
}
