// Talk mode's speech queue (#1161): everything Read aloud says goes through here, whichever voice reads it, so a new
// line never cuts off the one being read. Pure: no audio, no timers, no page. talk.mjs adds items, asks next() for the
// piece to say each time one ends, and cuts the sound itself only on Stop or the push-to-talk key (clear()).
// An item: { kind, parts, session, source, ... } where parts are the pieces to say (talk-grammar's sentences()), and
// kind is one of:
//   asked: what the user asked for ("read it", "more", yes/cancel prompts, the read-back). Plays after the piece being
//          said, and replaces whatever was being read on its own: the rest of that is dropped ("read it" reads it again).
//   need:  "<title> has a question", "is waiting on you", "wants to merge". Plays after the piece being said; the item it
//          cut into goes on afterwards from its next piece.
//   news:  done lines and reports from sessions under the open one. Waits until the item being read ends.
// Between two items a soft tone and a lead-in: "Also," before news, "Next," before a need that cut in. Nothing before
// the first item after quiet.
const RANK = { asked: 0, need: 1, news: 2 };
const rankOf = (it) => RANK[it.kind] ?? RANK.news;
// More than this many news items waiting are folded into one line, and "more" reads them.
export const FOLD_OVER = 2;
const COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
export const foldLine = (n) => `${COUNT[n] || n} more updates. Say more to hear them.`;

export const newQueue = () => ({ cur: null, waiting: [], seq: 0, talking: false, locked: false });

// Stale: about a session the user has opened since it was queued (what they asked for always stays).
const stale = (it, openId) => it.kind !== 'asked' && !!it.session && it.session === openId && it.openAt !== openId;
const keep = (q, openId) => { q.waiting = q.waiting.filter((w) => !stale(w, openId)); };
// In by rank, after those of the same rank; an item that was cut into goes back right after the needs that cut in.
function place(q, it) {
  const r = it.resumed ? RANK.need : rankOf(it);
  const i = q.waiting.findIndex((w) => (w.resumed ? RANK.need + 0.5 : rankOf(w)) > r);
  if (i < 0) q.waiting.push(it); else q.waiting.splice(i, 0, it);
}

// openId: the session open now. A newer line from a session replaces its older one not yet begun.
export function add(q, item, { openId = null } = {}) {
  if (q.locked) return null; // the screen is locked (#1173): dropped, not held
  const it = { ...item, kind: RANK[item.kind] === undefined ? 'news' : item.kind, parts: (item.parts || []).filter(Boolean), n: ++q.seq, i: 0, openAt: openId };
  if (!it.parts.length) return null;
  if (it.kind !== 'asked' && it.session) q.waiting = q.waiting.filter((w) => w.kind === 'asked' || w.resumed || w.session !== it.session);
  place(q, it);
  return it;
}

// The next piece to say: { text, item, tone, lead }, or null once there is nothing (quiet again). tone: play the soft
// tone first; lead: words to say before the piece ("Also,"), not part of it. Called when the piece before has ended.
export function next(q, { openId = null } = {}) {
  keep(q, openId);
  const c = q.cur, top = q.waiting[0];
  let cutIn = false;
  if (c && c.i < c.parts.length) {
    if (!top || rankOf(top) >= rankOf(c)) return { text: c.parts[c.i++], item: c, tone: false, lead: '' };
    // cut in at this piece's end
    cutIn = true;
    if (top.kind !== 'asked') place(q, { ...c, resumed: true }); // asked replaces it; anything else lets it go on later
  }
  q.cur = null;
  if (!q.waiting.length) { q.talking = false; return null; }
  let it = q.waiting[0];
  const news = q.waiting.filter((w) => w.kind === 'news' && !w.resumed);
  if (it.kind === 'news' && !it.resumed && news.length > FOLD_OVER) {
    q.waiting = q.waiting.filter((w) => !news.includes(w));
    it = { kind: 'news', parts: [foldLine(news.length)], folded: news, n: ++q.seq, i: 0, session: null, source: null };
  } else q.waiting.shift();
  const after = q.talking;
  q.cur = it; q.talking = true;
  const lead = !after ? '' : it.kind === 'news' && !it.resumed && !it.folded ? 'Also,' : it.kind === 'need' && cutIn ? 'Next,' : '';
  return { text: it.parts[it.i++], item: it, tone: after, lead };
}

// The user acted on a session (#1177: merged, answered, sent a message, archived or stopped it): its items not yet begun
// go, an item about several sessions forgets it and is looked at again before it is spoken (stale), and one being said
// ends after the piece being said. What the user asked for stays.
export function drop(q, id) {
  const hit = (it) => it.kind !== 'asked' && (it.session === id || !!it.from?.some((x) => x.id === id));
  q.waiting = q.waiting.filter((w) => {
    if (!hit(w)) return true;
    if (w.session === id || w.resumed || !w.from) return false;
    w.from = w.from.filter((x) => x.id !== id); w.stale = true;
    return w.from.length > 0;
  });
  if (q.cur && hit(q.cur)) q.cur.i = q.cur.parts.length;
}
// Stop, or the push-to-talk key: everything goes.
export function clear(q) { q.cur = null; q.waiting = []; q.talking = false; }
// The screen locked (#1173): everything goes, as with Stop, and what comes in while it stays locked is dropped, so
// nothing is said after unlock. Unlocked: the next new item speaks as usual.
export function lock(q, on) { q.locked = !!on; if (q.locked) clear(q); }
// The pill's "+N waiting", pressed: the item being read gives way to the next one at once.
export function skip(q) { q.cur = null; }
// How many items wait (a fold counts each item it would hold).
export function waiting(q, { openId = null } = {}) { keep(q, openId); return q.waiting.length; }
// The piece after the one being said, if it is the same item's (the natural voice makes it ahead).
export const upcoming = (q) => (q.cur && q.cur.i < q.cur.parts.length ? q.cur.parts[q.cur.i] : null);
