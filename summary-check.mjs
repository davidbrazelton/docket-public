// Summary checks stale facts first (#919). Summary is often pressed days after a session's last turn, and a summary
// built only from the conversation then restates what was true then: a pull request "open" that was merged from
// another computer, a child "working" that finished, a test server long gone. So every summary carries the facts
// Docket already knows, read just now (free), and when the last reply is older than the desk's threshold (default 4 hours),
// the prompt adds a short, read-only "Check first" step. Below the setting a sample of summaries (1 in 4) checks
// too, for good, so the log keeps data on short ages. Each summary is logged per desk (age, checked, sampled, found
// changes); ☰ > Gauges > Summary checks shows the desk's checks and how many found something changed, by age range,
// and sets its threshold. Docket offers to move the threshold when the numbers say so (tuneOffer below), never on its own.

export const SUMMARY_CHECK = { defaultHours: 4, maxHours: 24 * 30, sample: 0.25, maxCalls: 8, keep: 2000 };
export const CHANGED = 'Changed since last reply:';

// The hours setting: a number from 0 (check every time) up to 30 days; anything else is the default.
export function checkHours(v) {
  const n = Number(v);
  return v === undefined || v === null || v === '' || !Number.isFinite(n) || n < 0 ? SUMMARY_CHECK.defaultHours : Math.min(Math.round(n * 10) / 10, SUMMARY_CHECK.maxHours);
}

// Whether this summary checks first. lastReplyAt unknown counts as old. random is injectable for the tests.
// Returns { ageMs, check, sampled }: sampled is a check run only because it was picked, below the threshold.
export function summaryPlan({ lastReplyAt, now = Date.now(), hours = SUMMARY_CHECK.defaultHours, random = Math.random, sample = SUMMARY_CHECK.sample } = {}) {
  const ageMs = lastReplyAt ? Math.max(0, now - lastReplyAt) : null;
  if (ageMs === null || ageMs >= hours * 3600000) return { ageMs, check: true, sampled: false };
  const sampled = random() < sample;
  return { ageMs, check: sampled, sampled };
}

// "3 min", "5 hours", "4 days".
export function agoWords(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'less than a minute';
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return `${d} days`;
}
const when = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const PR_WORDS = { open: 'open', conflict: 'open with conflicts', merged: 'merged', closed: 'closed without merging', unknown: 'state unknown' };

// The facts block every summary gets, as read just now: when the last reply was, the branch, the pull request from it
// and its checks, and the sessions under it still working or waiting on the user.
export function factsBlock({ lastReplyAt = null, now = Date.now(), branch = '', pr = null, kids = [] } = {}) {
  const lines = [`Docket checked just now (${when(now)}):`];
  lines.push(`- Last reply: ${lastReplyAt ? `${when(lastReplyAt)} (${agoWords(now - lastReplyAt)} ago)` : 'unknown'}`);
  lines.push(`- Branch: ${branch || 'none found'}`);
  lines.push(`- Pull request from it: ${pr ? `#${pr.number} ${pr.draft && pr.status === 'open' ? 'draft' : PR_WORDS[pr.status] || pr.status}${pr.checks ? `, checks ${pr.checks}` : ''}` : 'none found'}`);
  const working = kids.filter((k) => k.state === 'working'), waiting = kids.filter((k) => k.state === 'waiting');
  const names = (l) => l.map((k) => `"${k.title || 'Session'}" (id ${k.id})`).join(', ');
  lines.push(`- Sessions under it: ${!working.length && !waiting.length ? 'none working or waiting on the user' : [working.length ? `working: ${names(working)}` : '', waiting.length ? `waiting on the user: ${names(waiting)}` : ''].filter(Boolean).join('; ')}`);
  lines.push('These replace anything older in the conversation that says otherwise.');
  return lines.join('\n');
}

// The "Check first" step, for a summary whose last reply is old (or sampled). Read only, capped.
export function checkStep({ lastReplyAt = null, now = Date.now(), deep = false, max = SUMMARY_CHECK.maxCalls } = {}) {
  const since = lastReplyAt ? `${agoWords(now - lastReplyAt)} ago (${when(lastReplyAt)})` : 'at an unknown time';
  return `**Check first.** The last reply here was ${since}, so facts in this conversation may be stale. Before writing,
re-verify the changeable facts the summary will rest on, read only, at most about ${max} calls in all: the state of
pull requests and issues it names, whether its branch is merged into origin/master, whether its worktree still exists
and has uncommitted changes, servers or ports it said were running, and${deep ? ' the sessions under it (mcp__portal__get_session_report): their claims as well as their state.' : ' sessions under it (mcp__portal__get_session_report).'}
Use the Docket facts above instead of asking again for what they already say. Checks only read: "do no new work" still holds.
In the summary, each such fact is either checked just now or marked "as of <date>, unchecked".
Anything that changed since the last reply goes first under Where it stands, as one bullet
\`- **${CHANGED.slice(0, -1)}:**\` with the changes as nested bullets; leave that bullet out when nothing changed.
Base Next steps on the state now, not the state then.`;
}

// Whether a summary's reply says something changed: a "Changed since last reply" bullet that is not "none".
export function foundChanges(text = '') {
  const lines = String(text).split(/\r?\n/);
  const i = lines.findIndex((l) => /changed since (the )?last reply/i.test(l));
  if (i < 0) return false;
  const rest = lines[i].replace(/^.*changed since (the )?last reply\**\s*:?\**\s*/i, '').trim();
  if (/^(none|nothing|no change|n\/a|-)\b/i.test(rest)) return false;
  if (rest) return true;
  const next = lines.slice(i + 1).find((l) => l.trim());
  return !!next && /^\s+[-*]\s+/.test(next) && !/^\s+[-*]\s+(none|nothing|no change)/i.test(next);
}

// Age ranges for the stats.
export const BUCKETS = [['<1h', 3600000], ['1-4h', 4 * 3600000], ['4-24h', 24 * 3600000], ['>1d', Infinity]];
export const bucketOf = (ageMs) => ageMs === null || ageMs === undefined ? '>1d' : BUCKETS.find(([, top]) => ageMs < top)[0];

// The log, as { range, summaries, checks, sampled, changed, pct } per age range; pct is the share of checks that
// found something changed, null with no checks.
export function checkStats(entries = []) {
  const rows = BUCKETS.map(([range]) => ({ range, summaries: 0, checks: 0, sampled: 0, changed: 0, pct: null }));
  for (const e of entries) {
    const r = rows.find((x) => x.range === bucketOf(e.ageMs));
    r.summaries++;
    if (!e.check) continue;
    r.checks++;
    if (e.sampled) r.sampled++;
    if (e.changed) r.changed++;
  }
  for (const r of rows) if (r.checks) r.pct = Math.round((r.changed / r.checks) * 100);
  return rows;
}

// ---------- tuning the threshold per desk ----------
// How often a check finds changes depends on how a desk works, so each desk has its own threshold, and Docket offers
// to move it when that desk's own log says so. Never an automatic change: the offer is a card the person accepts or
// puts off. The sampling below the threshold never stops, so there is always fresh data on the range just below.
//   Down: the checks in the range just below the threshold (from the next lower step up to it, sampled ones) found
//     changes at least downShare of the time, over at least minChecks checks: offer the next lower step.
//   Up: the checks in the range just above it (up to the next higher step) found changes under upShare of the time,
//     over at least minChecks checks: offer the next higher step.
// Not now is kept with the number of checks then, and the same move is offered again only after `again` more
// checks in that range.
export const STEPS = [1, 2, 4, 8, 24, 48];
export const TUNE = { minChecks: 10, downShare: 0.3, upShare: 0.1, again: 10 };

// "4 hours", "1 day", "2 days".
export const hoursWords = (h) => h >= 24 && h % 24 === 0 ? `${h / 24} day${h === 24 ? '' : 's'}` : `${h} hour${h === 1 ? '' : 's'}`;

// The checks with an age from lo up to (not including) hi hours: { checks, changed }.
function inRange(entries, lo, hi) {
  const r = { checks: 0, changed: 0 };
  for (const e of entries) {
    if (!e.check || e.ageMs === null || e.ageMs === undefined || e.ageMs < lo * 3600000 || e.ageMs >= hi * 3600000) continue;
    r.checks++; if (e.changed) r.changed++;
  }
  return r;
}

// The move to offer for one desk, or null: { dir: 'down'|'up', from, to, lo, hi, checks, changed }.
// entries: that desk's log; dismissed: [{ from, to, checks }] from its Not now answers.
export function tuneOffer({ entries = [], hours = SUMMARY_CHECK.defaultHours, dismissed = [], tune = TUNE } = {}) {
  const put = (o) => { const d = dismissed.find((x) => x.from === o.from && x.to === o.to); return !d || o.checks >= d.checks + tune.again ? o : null; };
  const lower = STEPS.filter((s) => s < hours).pop();
  if (lower !== undefined) {
    const r = inRange(entries, lower, hours);
    if (r.checks >= tune.minChecks && r.changed / r.checks >= tune.downShare) { const o = put({ dir: 'down', from: hours, to: lower, lo: lower, hi: hours, ...r }); if (o) return o; }
  }
  const higher = STEPS.find((s) => s > hours);
  if (higher !== undefined) {
    const r = inRange(entries, hours, higher);
    if (r.checks >= tune.minChecks && r.changed / r.checks < tune.upShare) return put({ dir: 'up', from: hours, to: higher, lo: hours, hi: higher, ...r });
  }
  return null;
}

// The card's words for an offer on a desk: { title, line, ask }.
export function tuneWords(name, o) {
  const range = o.dir === 'down' ? `under ${hoursWords(o.from)}` : `between ${hoursWords(o.lo)} and ${hoursWords(o.hi)}`;
  return {
    title: o.dir === 'down' ? `${name}'s summaries could check sooner` : `${name}'s summaries could check less often`,
    line: `Summaries on ${name}: checks ${range} after the last reply found changes ${o.changed} of ${o.checks} times.`,
    ask: `Check after ${hoursWords(o.to)} instead?`,
  };
}
