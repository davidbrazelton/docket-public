// Read aloud's timing log (#1177): one record for each line or reply that an event made (the open session's turn
// ended, a session under it settled, a report came in), from that event to when it was spoken or dropped, with what
// the user did to its session meanwhile. Pure, for the page and the app alike: the page keeps the records and sends
// each finished one to the app, which keeps the last LOG_KEEP in <data>/talk-log.jsonl. Text is cut to TEXT_MAX
// characters, and no audio is ever kept.
export const TEXT_MAX = 80, LOG_KEEP = 500;
export const EVENTS = ['turnEnded', 'settled', 'childReport'];
// Why a record was dropped: looked at again before it was spoken and no longer true, the user acted on its session,
// the screen locked, Read aloud is Off, the merge wait's quiet minute, Stop, a newer line about the same session or
// the session opened (the queue's own rules), folded into "N more updates", no voice could read it, or the open
// session's turn ended needing nothing from the user (not waiting, #1181).
export const DROPS = ['rechecked', 'you acted', 'locked', 'off', 'quiet', 'stopped', 'replaced', 'folded', 'no voice', 'not waiting'];
const cut = (t) => { t = String(t ?? '').replace(/\s+/g, ' ').trim(); return t.length > TEXT_MAX ? `${t.slice(0, TEXT_MAX - 1)}…` : t; };

// state: the session as the event found it, to tell what made a line: { status, unread, unreadWhy, asksYou, label (the
// page's needLabel), pr (its open pull request), viewed (the session being viewed), said (the label its turn declared
// with mark_turn, when it did, #1181) }.
export function newRecord({ event, at = Date.now(), session = null, title = '', why = '', state = null }) {
  return { event, at, session, title: cut(title), why, state: cleanState(state), text: '', announced: null, queued: null, started: null, ended: null, dropped: null, acts: [], would: [] };
}
// What the line fixes (talk:lineFixes, off for now) would have done to it, in words: "drop: no longer needs you",
// "skip: session being viewed". Logged with the fixes off, to measure whether they would help.
export function wouldDo(rec, what) { if (what && !rec.would.includes(what)) rec.would.push(cut(what)); return rec; }
function cleanState(s) {
  if (!s || typeof s !== 'object') return null;
  const str = (x) => (typeof x === 'string' ? cut(x) : null);
  return { status: str(s.status), unread: !!s.unread, unreadWhy: str(s.unreadWhy), asksYou: !!s.asksYou, label: str(s.label), pr: Number.isInteger(s.pr) ? s.pr : null, viewed: !!s.viewed, ...(str(s.said) && { said: str(s.said) }) };
}
// The first time of each step counts: announced (the line was made), queued, started (its first sound), ended.
export function stamp(rec, key, at = Date.now()) { if (rec[key] == null) rec[key] = at; return rec; }
// The user's action on its session: merged, answered, allowed, denied, sent a message, stopped, archived.
export function actOn(rec, act, at = Date.now()) { rec.acts.push({ act, at }); return rec; }
export function dropRec(rec, why, at = Date.now()) { rec.dropped ||= { at, why: DROPS.includes(why) ? why : 'replaced' }; return rec; }
export const finished = (rec) => !!(rec.dropped || rec.ended);

// The record as it is logged: the event's time, then each step in ms after it.
export function logRow(rec) {
  const ms = (t) => (t == null ? null : Math.max(0, t - rec.at));
  return {
    at: new Date(rec.at).toISOString(), event: rec.event, session: rec.session, title: cut(rec.title), why: rec.why || '', state: rec.state, text: cut(rec.text),
    announced: ms(rec.announced), queued: ms(rec.queued), started: ms(rec.started), ended: ms(rec.ended),
    ...(rec.dropped && { dropped: { after: ms(rec.dropped.at), why: rec.dropped.why } }),
    acts: rec.acts.map((a) => ({ act: a.act, after: ms(a.at) })),
    ...(rec.would.length && { would: rec.would }),
  };
}
// What the app keeps of a row the page sent: only these fields, of these kinds, text cut again. null for anything else.
export function cleanRow(r) {
  if (!r || typeof r !== 'object' || !EVENTS.includes(r.event) || Number.isNaN(Date.parse(r.at))) return null;
  const n = (x) => (Number.isFinite(x) && x >= 0 ? Math.round(x) : null);
  const out = { at: new Date(r.at).toISOString(), event: r.event, session: typeof r.session === 'string' ? cut(r.session) : null, title: cut(r.title), why: cut(r.why), state: cleanState(r.state), text: cut(r.text),
    announced: n(r.announced), queued: n(r.queued), started: n(r.started), ended: n(r.ended),
    acts: (Array.isArray(r.acts) ? r.acts : []).slice(0, 10).map((a) => ({ act: cut(a?.act), after: n(a?.after) })) };
  if (r.dropped) out.dropped = { after: n(r.dropped.after), why: DROPS.includes(r.dropped.why) ? r.dropped.why : 'replaced' };
  if (Array.isArray(r.would) && r.would.length) out.would = r.would.slice(0, 5).map(cut);
  return out;
}
// One line for ☰ > Docket settings > Talk mode: "Relay fix · settled → spoken in 4.3 s · you merged 1.2 s before it
// spoke", or "… → dropped after 2.0 s (you acted) · you merged at 1.1 s".
const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
const would = (r) => (r.would?.length ? [`the fixes would: ${r.would.join(', ')}`] : []);
export function rowWords(r) {
  const head = `${r.title || 'A session'} · ${r.event}`;
  if (r.started != null) {
    const acts = r.acts.filter((a) => a.after != null && a.after <= r.started).map((a) => `you ${a.act} ${sec(r.started - a.after)} before it spoke`);
    return [`${head} → spoken in ${sec(r.started)}`, ...acts, ...would(r)].join(' · ');
  }
  const acts = r.acts.filter((a) => a.after != null).map((a) => `you ${a.act} at ${sec(a.after)}`);
  return [`${head} → dropped${r.dropped?.after != null ? ` after ${sec(r.dropped.after)}` : ''} (${r.dropped?.why || 'not spoken'})`, ...acts, ...would(r)].join(' · ');
}
