// What Shift mode saved, from the usage rows Docket already keeps: nothing here reads a log.
// A Shift session's rows on a lower gear are priced again at its brand's top gear: the same tokens, the top gear's
// rates. Saved is what they cost less that. The re-read a shift causes (the first reply after it writes the cache again)
// is in the rows' own cost already, so it comes off the saving by itself.
// No imports: the Usage page loads this file too (GET /shift-savings.mjs), so its sums are the ones tested here.

// One row's tokens at a model's list rates (pricing.json's per-million-token prices), as costs.mjs's fillRow prices
// rows from their totals: long-prompt rates, fast mode and web searches are not in a row's totals, so they are left out.
export function priceTokens(row, p) {
  if (!p) return null;
  const w1h = row.CacheCreate1h || 0, w5m = Math.max(0, (row.CacheCreate || 0) - w1h);
  return ((row.InputTokens || 0) * p.input + (row.OutputTokens || 0) * p.output + (row.CacheRead || 0) * p.cacheRead
    + w5m * p.cacheWrite5m + w1h * (p.cacheWrite1h ?? p.cacheWrite5m)) / 1e6;
}

// The gear a row's model is, as its index in the brand's gears (cheapest first), or -1. A Bedrock id
// (us.anthropic.claude-opus-5-5-v1:0) or a dated one (claude-haiku-5-5-20261001) is the same gear.
export function gearIndex(model, gearIds) {
  const m = String(model || '').replace(/^(?:[a-z]{2,6}\.)?anthropic\./, '').replace(/-v\d+(?::\d+)?$/, '');
  return gearIds.findIndex((id) => m === id || m.startsWith(id + '-'));
}

// What one row of a Shift session would have cost on the top gear. gearIds: the brand's gears, cheapest first;
// topRates: the top gear's rates on the row's date (null when pricing.json has none). A row on a lower gear is priced
// at the top gear, times the row's own Cost / PersonalCost (Bedrock's regional rate); any other row (already on the
// top gear, or on a model that is not one of the gears, such as a helper agent's own model) keeps its cost, as does
// every row when the top gear has no price. Returns { cost, priced }: priced is false when the top gear had no price.
export function topGearCost(row, gearIds, topRates) {
  const i = gearIndex(row.Model, gearIds), cost = row.Cost || 0;
  if (i < 0 || i === gearIds.length - 1) return { cost, priced: true };
  const list = priceTokens(row, topRates);
  if (list === null) return { cost, priced: false };
  const regional = row.PersonalCost > 0 && cost > row.PersonalCost ? cost / row.PersonalCost : 1;
  return { cost: Math.round(list * regional * 10000) / 10000, priced: true };
}

// The facts about one Shift session that do not depend on the dates picked: whether it ever shifted (its saved history,
// else, for one from before history was saved, rows on more than one gear) and whether it ever ran on the top gear.
// rows: all its rows; shifts: its saved history; gear: its gear now.
export function sessionShiftFacts(rows, gearIds, shifts = [], gear = '') {
  const used = new Set(rows.map((r) => gearIndex(r.Model, gearIds)).filter((i) => i >= 0));
  const top = gearIds.length - 1;
  return {
    shifted: shifts.length > 0 || used.size > 1,
    shifts: shifts.length,
    reachedTop: used.has(top) || gearIndex(gear, gearIds) === top || shifts.some((s) => gearIndex(s.to, gearIds) === top),
  };
}

// The Shift line on the Usage page, for the rows picked (dates, desk, brand...): rows of Shift sessions carry
// TopGearCost (and TopGearUnpriced when their top gear has no price); shift: session id -> sessionShiftFacts.
// spent: what they cost; top: on the top gear; saved: top less spent.
export function shiftTotals(rows, shift = {}) {
  const t = { spent: 0, top: 0, saved: 0, sessions: 0, shifted: 0, stayedLow: 0, unpriced: 0 };
  const seen = new Set();
  for (const r of rows) {
    if (r.TopGearCost === undefined) continue;
    t.spent += r.Cost || 0; t.top += r.TopGearCost;
    if (r.TopGearUnpriced) t.unpriced++;
    if (seen.has(r.SessionId)) continue;
    seen.add(r.SessionId);
    const f = shift[r.SessionId] || {};
    t.sessions++;
    if (f.shifted) t.shifted++;
    if (!f.reachedTop) t.stayedLow++;
  }
  t.saved = t.top - t.spent;
  return t;
}

// One entry of a session's shift history, as saved in portal-state.json. by: who made the shift: 'session' (its own
// shift_gear), 'parent' (the session that started it, raising it), or 'docket' (Docket itself).
export const SHIFT_BY = ['session', 'parent', 'docket'];
export function shiftEntry({ from, to, reason = '', by = 'session', at = Date.now() }) {
  return { at, from, to, reason: String(reason).slice(0, 300), by: SHIFT_BY.includes(by) ? by : 'session' };
}
// How many shifts a session keeps: enough for any real session, and a runaway one cannot grow the state file.
export const MAX_SHIFTS = 200;
export const withShift = (list, entry) => [...(Array.isArray(list) ? list : []), entry].slice(-MAX_SHIFTS);
