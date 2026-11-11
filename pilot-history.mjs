// The autopilot's head start (#920): the person's own answers from their past sessions, read once from the
// transcripts on this computer (no model, nothing sent anywhere) and kept in the learning log as source: history.
// Runs see them in their brief, below the live answers, and they can lower how many live matches "I got this" needs
// (pilot.mjs), but never stand in for them.
import fs from 'node:fs';
import path from 'node:path';

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const textOf = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (typeof b === 'string' ? b : b?.text || '')).join(' ') : '';

// What a tool call was about, in a few words: the command, the file, the address.
export function summarize(tool, input = {}) {
  const i = input && typeof input === 'object' ? input : {};
  const main = i.command ?? i.file_path ?? i.notebook_path ?? i.url ?? i.path ?? i.pattern ?? i.query ?? i.title ?? i.prompt ?? i.description;
  return clip(`${tool}: ${main !== undefined ? main : JSON.stringify(i)}`, 160);
}

// A tool result that says the person turned it down (in Claude Code, or in Docket), and the form's "answer in the chat".
const REJECTED = /^(The user doesn't want to proceed with this tool use|The user declined this\.|The user chose to answer in the chat instead of the form)/;
// A permission prompt the person allowed leaves no mark in a transcript (a call a rule let through looks the same), so
// only the ones turned down are read: on this computer counting every call that ran gave thousands of "allows".

// A question form's picks from its result: Claude Code keeps them as toolUseResult.answers, and says them in the text
// as "question"="answer", "question"="answer".
function formAnswers(res, text) {
  if (res?.answers && typeof res.answers === 'object' && Object.keys(res.answers).length) return Object.fromEntries(Object.entries(res.answers).map(([q, a]) => [q, String(a)]));
  const out = {};
  for (const m of text.matchAll(/"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"/g)) out[m[1]] = m[2];
  return Object.keys(out).length ? out : null;
}

// The person's decisions in one transcript (its lines, parsed; a Claude Code transcript, or Docket's own chat record
// whose lines carry the message as msg). Returns [{ id, at, kind, desk, session, tool, what, user }].
export function transcriptDecisions(lines, { session, desk }) {
  const uses = new Map(), out = [];
  for (const raw of lines) {
    const j = raw?.msg && typeof raw.msg === 'object' ? { ...raw.msg, at: raw.at } : raw;
    if (!j || typeof j !== 'object') continue;
    const content = j.message?.content;
    if (!Array.isArray(content)) continue;
    const at = Date.parse(j.timestamp) || j.at || 0;
    for (const b of content) {
      if (b?.type === 'tool_use') { uses.set(b.id, b); continue; }
      if (b?.type !== 'tool_result' || !uses.has(b.tool_use_id)) continue;
      const u = uses.get(b.tool_use_id), text = textOf(b.content).trim(), no = REJECTED.test(text);
      const d = { id: `history:${session}:${b.tool_use_id}`, at, desk, session, tool: u.name };
      if (u.name === 'AskUserQuestion') {
        const qs = Array.isArray(u.input?.questions) ? u.input.questions : [];
        const what = clip(qs.map((q) => `${q.question} [${(q.options || []).map((o) => o.label).join(' | ')}]`).join(' / '), 240);
        if (no) out.push({ ...d, kind: 'question', what, user: { answer: 'skip' } });
        else if (j.toolUseResult?.answers || /^Your questions have been answered|^User has answered/.test(text)) {
          const answers = formAnswers(j.toolUseResult, text);
          if (answers) out.push({ ...d, kind: 'question', what, user: { answer: 'answer', answers } });
        }
      } else if (u.name === 'ExitPlanMode') {
        const what = clip(String(u.input?.plan || '').split('\n').find((l) => l.trim()) || 'a plan', 120).replace(/^#+\s*/, '');
        if (no) out.push({ ...d, kind: 'plan', what, user: { answer: 'deny' } });
        else if (/^User has approved your plan/.test(text)) out.push({ ...d, kind: 'plan', what, user: { answer: 'allow' } });
      } else if (u.name === 'mcp__portal__start_session' && u.input?.initiation === 'offer') {
        const what = clip(u.input.title || 'a new session', 120);
        if (/^The user chose a new session/.test(text)) out.push({ ...d, kind: 'offer', what, user: { answer: 'new' } });
        else if (/^The user chose to do it here/.test(text)) out.push({ ...d, kind: 'offer', what, user: { answer: 'here' } });
      } else if (no) out.push({ ...d, kind: 'permission', what: summarize(u.name, u.input), user: { answer: 'deny' } });
    }
  }
  return out;
}

// The suggested-session and handoff cards Docket kept in its saved session records, answered by the person.
// sessions: state.sessions (id -> { client, cards: [{ ev }] }).
export function cardDecisions(sessions) {
  const out = [];
  for (const [session, rec] of Object.entries(sessions || {})) for (const { ev } of rec?.cards || []) {
    if (!ev?.id || ev.by === 'pilot') continue;
    const user = ev.k === 'proposal' ? { started: 'start', dismissed: 'dismiss' }[ev.state] : ev.k === 'handoff' ? { started: 'continue', here: 'here' }[ev.state] : null;
    if (!user) continue;
    out.push({ id: `history:card:${ev.id}`, at: ev.at || 0, kind: ev.k === 'proposal' ? 'card' : 'handoff', desk: rec.client, session, tool: '', what: clip(ev.title || 'Untitled', 120), user: { answer: user } });
  }
  return out;
}

// Drops what the autopilot answered itself: an answer in its log for the same session and kind within two minutes.
// log: the pilot's log lines.
export function notByPilot(decisions, log = []) {
  const mine = (log || []).filter((l) => l.ok && !l.suggest && l.kind !== 'run' && l.session);
  return decisions.filter((d) => !mine.some((l) => l.session === d.session && l.kind === d.kind && Math.abs(l.at - d.at) < 120000));
}

// One learning-log line for a decision from history: no suggestion to compare, so match is null and it never counts
// as a live match.
export const historyLine = (d) => ({ at: d.at, id: d.id, kind: d.kind, desk: d.desk, session: d.session || null, ...(d.tool ? { tool: d.tool } : {}),
  what: d.what, suggested: null, user: d.user, match: null, how: 'user', source: 'history' });

// The lines to add to the learning log: decisions not in it yet (by id, so a rerun adds nothing twice), from before
// the first live line (after that Docket heard the answers itself), the newest cap of them, oldest first.
export function newHistory(existing, decisions, cap = 5000) {
  const have = new Set((existing || []).map((l) => l.id));
  const live = (existing || []).filter((l) => l.source !== 'history').map((l) => l.at).filter(Boolean);
  const since = live.length ? Math.min(...live) : Infinity;
  const seen = new Set(), out = [];
  for (const d of decisions) {
    if (!d.at || d.at >= since || have.has(d.id) || seen.has(d.id) || !d.desk) continue;
    seen.add(d.id); out.push(historyLine(d));
  }
  return out.sort((a, b) => a.at - b.at).slice(-cap);
}

// The transcript files there are to read: each desk's Claude home (projects/*/*.jsonl), and Docket's own chat records
// for the brands it keeps them for. desks: [{ id, home }]; deskOf: a session id -> its desk id (Docket's records).
export function historyFiles(desks, chatsDir, deskOf = () => null) {
  const files = [];
  const ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
  for (const { id, home } of desks) {
    if (!home) continue;
    const projects = path.join(home, 'projects');
    for (const p of ls(projects)) for (const f of ls(path.join(projects, p))) if (f.endsWith('.jsonl')) {
      const session = f.slice(0, -6);
      files.push({ file: path.join(projects, p, f), session, desk: deskOf(session) || id });
    }
  }
  if (chatsDir) for (const f of ls(chatsDir)) if (f.endsWith('.jsonl')) {
    const session = f.slice(0, -6), desk = deskOf(session);
    if (desk) files.push({ file: path.join(chatsDir, f), session, desk });
  }
  return files;
}
// Whether there is any history to read, without reading it.
export const hasHistory = (desks, chatsDir, deskOf) => historyFiles(desks, chatsDir, deskOf).length > 0;

// Reads every file, a file at a time with a pause between, so Docket stays responsive. Only lines that can hold a tool
// call or its result are parsed. Returns the decisions, oldest first.
export async function readHistory(files, { skipDesks = [] } = {}) {
  const out = [];
  for (const { file, session, desk } of files) {
    if (skipDesks.includes(desk)) continue;
    let text; try { text = await fs.promises.readFile(file, 'utf8'); } catch { continue; }
    const lines = [];
    for (const l of text.split('\n')) if (l.includes('"tool_')) { try { lines.push(JSON.parse(l)); } catch {} }
    out.push(...transcriptDecisions(lines, { session, desk }));
    await new Promise((r) => setImmediate(r));
  }
  return out.sort((a, b) => a.at - b.at);
}
