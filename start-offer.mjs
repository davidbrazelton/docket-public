// The start-cost check (#802): what a desk spends starting sessions, and the card that offers turning splitting off
// when most of the child sessions it started finished in a turn or two. It reads only the usage rows Docket keeps
// (costs.mjs puts Starts, StartCost, Child and ShortChild on each session's first row), and makes no model calls.
import { SHORT_TURNS } from './costs.mjs';
import { gearIndex } from './shift-savings.mjs';

// When to offer it. One place to change them.
// days: the stretch measured (the card says "last week"); weekly: what starting the short children must have cost in
// it; children / shortShare: at least that many children, and that share of them short ("most finished in two turns");
// laterDays: how long Not now (or turning splitting off and back on) holds the card off.
export const START_OFFER = { days: 7, weekly: 5, children: 5, shortShare: 0.5, laterDays: 30 };

// What a desk's rows say about its starts. rows: its usage rows; from / to: the dates (YYYY-MM-DD) to count;
// gearIds: its Claude gears, cheapest first, to count the short children that ran only on the top gear.
export function startTally(rows, { from = '', to = '9999', gearIds = [] } = {}) {
  const t = { sessions: 0, startCost: 0, children: 0, childCost: 0, short: 0, shortCost: 0, shortTop: 0 };
  const shortIds = new Set(), gearsOf = new Map(); // short child -> whether every main row was on the top gear
  for (const r of rows) {
    if (r.Date < from || r.Date > to) continue;
    if (r.Starts) {
      t.sessions++; t.startCost += r.StartCost || 0;
      if (r.Child) { t.children++; t.childCost += r.StartCost || 0; }
      if (r.ShortChild) { t.short++; t.shortCost += r.StartCost || 0; shortIds.add(r.SessionId); }
    }
  }
  if (gearIds.length) {
    for (const r of rows) {
      if (!shortIds.has(r.SessionId) || r.Source !== 'main' || !r.Model) continue;
      gearsOf.set(r.SessionId, (gearsOf.get(r.SessionId) ?? true) && gearIndex(r.Model, gearIds) === gearIds.length - 1);
    }
    t.shortTop = [...gearsOf.values()].filter(Boolean).length;
  }
  for (const k of ['startCost', 'childCost', 'shortCost']) t[k] = Math.round(t[k] * 100) / 100;
  return t;
}

// Whether the card shows for a desk: null, 'first' (never answered) or 'again' (laterDays after the last answer).
// split: the desk's splitting is on (nothing to offer when it is off); answer: { answer: 'later'|'applied', at }.
export function startOfferKind({ tally, split = true, answer, now = Date.now(), o = START_OFFER }) {
  if (!split || !tally) return null;
  if (tally.shortCost < o.weekly || tally.children < o.children || tally.short < tally.children * o.shortShare) return null;
  if (!answer) return 'first';
  return now - (answer.at || 0) >= o.laterDays * 864e5 ? 'again' : null;
}

// The card's words.
const dollars = (n) => (n >= 10 ? `$${Math.round(n)}` : `$${(n || 0).toFixed(2)}`);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export function startOfferWords(name, t) {
  const lines = [`${t.short} of its ${plural(t.children, 'child session')} finished in ${SHORT_TURNS} turns or fewer; starting those cost ${dollars(t.shortCost)}.`];
  if (t.shortTop) lines.push(`${t.shortTop === 1 ? '1 of them' : `${t.shortTop} of them`} ran only on the top gear.`);
  return {
    title: `${name} spent ${dollars(t.startCost)} last week starting ${plural(t.sessions, 'session')}`,
    lines,
    ask: 'Turn splitting off? Its sessions then do the work in place, and start a session only when you ask for one.',
  };
}
