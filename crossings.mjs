// Crossing from one company into another. Each company has its own Claude home, sign-in, memory and
// billing, and a session never reaches another company's sessions or files. Two crossings are allowed, each
// approved by the person: asking another company a question (a short read-only session there answers it), and
// handing work to another company (a card in its list, which runs only when the person presses Start there).
import path from 'node:path';

// Which companies may talk to which. Every pair today; a limit goes here, and only here.
export function canPair(from, to) {
  return !!from && !!to && from !== to;
}

// The person approves the first crossing from a session into a company. After that the same session crosses into
// that company without asking. The approvals live on the running session's own record in memory, so they are
// never saved to disk and end with the session: a session picked up again, or another session, asks again.
export const isApproved = (s, to) => !!s?.crossOk?.has(to);
export function approve(s, to) { (s.crossOk ||= new Set()).add(to); }

// The line portal-events.log keeps for every crossing: from company, to company, the text sent (the time is the
// line's own start).
export function crossingLog({ kind, from, to, session, title, text }) {
  const what = { ask: 'question', answer: 'answer', handoff: 'handoff', start: 'handoff started' }[kind] || kind;
  return { what: `crossing: ${what} ${from} -> ${to}`, detail: `from session: ${title ? `"${title}" ` : ''}(${session || '-'})\ntext:\n${String(text ?? '')}` };
}

// A file the answering session may read: inside its own company's home or folder, nowhere else on the computer.
export function insideCompany(p, company) {
  if (!p) return true; // no path: its own folder
  const abs = path.resolve(company.folder || company.home, String(p));
  const roots = [company.home, company.folder].filter(Boolean).map((r) => path.resolve(r).toLowerCase());
  const key = abs.toLowerCase();
  return roots.some((r) => key === r || key.startsWith(r + path.sep));
}

// What the answering session is told: who asks, what it may do, and that only its answer goes back.
// fileTool: the session reads files through mcp__past__read_desk_file (a Codex session, which has no file tools
// of its own there) rather than its own read tools.
export function answerInstructions(fromName, toName, { fileTool = false } = {}) {
  return `You are answering a question that the desk "${fromName}" sent to the desk "${toName}" through Docket, the user's session portal. You run as ${toName}, with ${toName}'s own sign-in and memory. The same person runs both desks and approved sending this question.
Look for the answer in ${toName}'s past sessions: use mcp__past__search_past_sessions with a few short search words (try several), then mcp__past__read_past_session to read the ones that match. You may also read files in ${toName}'s own folder${fileTool ? ' with mcp__past__read_desk_file' : ''}. You cannot change anything.
Then answer in plain words, briefly, saying which past sessions (title and date) the answer comes from. If you found nothing, say so plainly; do not guess. Leave out passwords, keys and other secrets. Only your final reply goes back to ${fromName}.`;
}

// Cards waiting in a company's list: work another company handed over (state.inbox[companyId]).
// open -> started | dismissed. Answered items are kept for a while as a record, then dropped.
const KEEP_INBOX = 30;
export function addToInbox(inbox, item) {
  inbox.push({ ...item, state: 'open' });
  while (inbox.length > KEEP_INBOX) { const i = inbox.findIndex((x) => x.state !== 'open'); if (i < 0) break; inbox.splice(i, 1); }
  return inbox[inbox.length - 1];
}
export function settleInbox(inbox, id, how, startedId) {
  const it = inbox.find((x) => x.id === id);
  if (!it || it.state !== 'open') return null;
  it.state = how;
  if (startedId) it.startedId = startedId;
  return it;
}
export const openInbox = (inbox) => (inbox || []).filter((x) => x.state === 'open');

// Report back (#904). The person who presses Start chooses whether the sending session hears how it goes (report,
// on by default). The sending session's card in its chat (k 'desk-handoff', the same id as the inbox item) follows:
// open (waiting in the other desk) -> started -> done, or withdrawn (Take it back) / dismissed there. Only status and
// the closing reply cross, never the chat. What one moment changes: the card's fields, a note for the sending chat,
// and news (the closing reply, shown with the halo like a child's report). Null when nothing goes back.
export function crossReport(it, moment, { at = Date.now(), reply = '', childId = '', toName = '' } = {}) {
  const desk = toName || 'the other desk';
  switch (moment) {
    case 'start':
      return it.report
        ? { card: { state: 'started', report: true, startedAt: at, childId }, note: `${desk} started "${it.title}". It reports back here when it finishes a turn.` }
        : { card: { state: 'started', report: false, startedAt: at, childId }, note: `${desk} started "${it.title}" and chose not to report back. Its progress stays in ${desk}.` };
    case 'turn':
      if (it.state !== 'started' || !it.report) return null;
      return { card: { state: 'done', doneAt: at, text: String(reply).slice(0, 400) }, news: { childId, title: it.title, text: String(reply).slice(0, 400), desk, at } };
    case 'quiet': // Stop reporting, in the started session
      if (it.state !== 'started' || !it.report) return null;
      return { card: { report: false }, note: `${desk} stopped reporting back on "${it.title}". Its progress stays in ${desk}.` };
    case 'withdrawn': case 'dismissed':
      return { card: { state: moment, endedAt: at }, note: moment === 'dismissed' ? `${desk} dismissed "${it.title}"; nothing ran there.` : '' };
    default: return null;
  }
}
// What the started session is told about where its work came from, after its brief.
export function inboxContext(it, toName, by = '') {
  const who = by === 'pilot' ? "Docket's autopilot" : 'the user';
  const back = it.report
    ? `Your closing reply at the end of each turn goes back to the session "${it.fromTitle || 'Untitled'}" in ${it.fromName} as a short report (status and that reply only, never this chat), so end each turn with a reply that stands on its own. Leave out passwords, keys and anything ${toName}'s alone.`
    : `${who === 'the user' ? 'The user' : who} chose not to report back: nothing you write here goes back to ${it.fromName}.`;
  return `(From Docket: this work was handed over from the desk "${it.fromName}" and ${who} pressed Start in ${toName}'s list. It runs on ${toName}'s own sign-in and is billed to ${toName}. ${back})`;
}
