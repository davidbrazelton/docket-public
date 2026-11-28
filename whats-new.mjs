// What's new and suggestions (#1156, #1168): one list in the lower-right corner, opened from ☰ > Help or the one nudge.
// ENTRIES lists each new thing an update brought, with the version it arrived in; index.html draws each one and the
// other entries (the preference offers and the usage checks). The rules for which show, how they are counted and when
// the nudge comes are here, kept apart from the page so they can be tested.
// An entry from ENTRIES is open until it is answered, on a computer that ran an older version before. A fresh install
// keeps every entry so far as seen (the setup wizard asks about them), and one that answered an entry never sees it
// open again. Talk mode ships as one entry (#1164), under a new id, so every computer sees it once, those that saw the
// first talk card ('talk', 1.247.0) too.
export const ENTRIES = [
  { id: 'talk-and-read-aloud', version: '1.249.0' },
];
export const DONE_LIMIT = 10;

// -1, 0 or 1, by the numbers of x.y.z; a missing or odd part counts as 0.
export function cmpVersion(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0), pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

// running: the version this computer runs now. last: the version it ran when this was last worked out ('' never).
// seen: the ids answered (or kept as seen on a fresh install). fresh: this browser has never opened Docket before.
// Returns the ids open now, in the order of ENTRIES, and what to keep: last becomes running, and on a fresh install
// seen takes in every entry up to running (so none of them turns up later).
export function whatsNew({ entries = ENTRIES, running, last = '', seen = [], fresh = false }) {
  const have = new Set(seen), upTo = entries.filter((e) => cmpVersion(e.version, running) <= 0);
  if (!running) return { open: [], last, seen: [...have] };
  if (fresh && !last) return { open: [], last: running, seen: [...new Set([...have, ...upTo.map((e) => e.id)])] };
  return { open: upTo.filter((e) => !have.has(e.id)).map((e) => e.id), last: running, seen: [...have] };
}

// The list's sections from its entries ({ key, sec: 'new' | 'suggest' }) and the answered ones kept (records, newest
// first: { key, title, note, ok }). seenIds: ENTRIES answered before records were kept, shown under Done as Seen
// (titles: their titles by id). An entry answered and open again (a check that found something new on that desk)
// shows as open, not under Done. count: what the ☰ badge shows, every open entry.
export function sections({ items = [], records = [], seenIds = [], titles = {}, limit = DONE_LIMIT }) {
  const open = new Set(items.map((i) => i.key));
  const kept = new Set(records.map((r) => r.key));
  const done = [...records, ...seenIds.filter((id) => !kept.has(id) && titles[id]).map((id) => ({ key: id, title: titles[id], note: 'Seen', ok: true }))]
    .filter((r) => !open.has(r.key)).slice(0, limit);
  const fresh = items.filter((i) => i.sec === 'new'), suggest = items.filter((i) => i.sec === 'suggest');
  return { fresh, suggest, done, count: fresh.length + suggest.length };
}

// An answer kept: newest first, one per entry, at most limit.
export function addDone(records = [], rec, limit = DONE_LIMIT) {
  return [rec, ...records.filter((r) => r.key !== rec.key)].slice(0, limit);
}

// The one nudge: due when an open entry has not been nudged about yet, so it comes once per update or new suggestion,
// never once per entry. Later or Review keeps every open entry as nudged (nudgedAfter), the newest last, at most 200;
// an entry answered leaves the list (the page drops it), so one that comes back later nudges again. An entry that is
// only out of view (one for another desk) stays nudged.
export function nudgeDue(open = [], nudged = []) {
  const had = new Set(nudged);
  return open.some((k) => !had.has(k));
}
export function nudgedAfter(open = [], nudged = [], limit = 200) {
  return [...new Set([...nudged.filter((k) => !open.includes(k)), ...open])].slice(-limit);
}

// The nudge's line: "1 new option and 2 suggestions from how you use Docket."
export function nudgeText(fresh, suggest) {
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const a = fresh ? n(fresh, 'new option', 'new options') : '', b = suggest ? n(suggest, 'suggestion', 'suggestions') + ' from how you use Docket' : '';
  return (a && b ? `${a} and ${b}` : a || b) + '.';
}
