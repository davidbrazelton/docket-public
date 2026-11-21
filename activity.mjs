// Session activity over the day (#805): how many live sessions are working, waiting on their children or a background
// job, waiting on the person, or idle, counted once a minute per desk and kept as 5-minute slots in
// <data>/activity.jsonl, one line per desk and slot with each state's peak and average:
//   {"t":"2026-11-09T10:35","d":"docket","w":[7,5.2],"c":[2,1.4],"n":[1,0.6],"i":[9,8.8],"b":4}
// t is the slot's local start, b the minutes in it with at least one working. "r":1 marks a slot rebuilt from the
// transcripts (working only), "h":1 an hour rolled up from twelve slots once it is 90 days old. No node imports, so
// the Usage page reads its sums from this same file (served as /activity.mjs).

export const SLOT_MIN = 5;
const SLOT_MS = SLOT_MIN * 60000;
export const STATES = ['w', 'c', 'n', 'i']; // working, waiting on children or background, waiting on you, idle
export const KEEP_DAYS = 90; // slots older than this are rolled up to hours

const pad = (n) => String(n).padStart(2, '0');
export const dayOf = (at) => { const d = new Date(at); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// The local start of the slot a moment falls in, as "YYYY-MM-DDTHH:MM".
export function slotKey(at) {
  const d = new Date(at);
  return `${dayOf(at)}T${pad(d.getHours())}:${pad(d.getMinutes() - (d.getMinutes() % SLOT_MIN))}`;
}
export const slotStart = (key) => new Date(key).getTime(); // no zone: local time
const r1 = (x) => (x > 0 ? Math.max(0.1, Math.round(x * 10) / 10) : 0); // one decimal, and a little working never shows as none
const minutes = (t) => +t.slice(11, 13) * 60 + +t.slice(14, 16);
const weight = (l) => (l.h ? 60 / SLOT_MIN : 1); // an hourly line stands for twelve slots

// ---------- live ----------
// The state a live session's row dot shows, as one of STATES (index.html's dotClass): blue working (running, starting,
// compacting), the blue ring of a background job or child sessions, the orange of one waiting on the person (asking,
// an unread reply, an error), the green of idle. null for one that has ended.
export function stateOf({ status, compacting, lastError, unread, jobs = 0, held, kidsWorking = 0, kidsWaiting = 0, kidNews }) {
  if (compacting || status === 'running' || status === 'starting') return 'w';
  if (lastError || status === 'requires_action') return 'n';
  const background = status === 'idle' && (jobs > 0 || !!held);
  if (unread && ((status === 'idle' && !background) || status === 'ended')) return 'n';
  if (background || (status === 'idle' && (kidsWorking || kidsWaiting || kidNews))) return 'c';
  return status === 'idle' ? 'i' : null;
}
export function countStates(states) {
  const out = { w: 0, c: 0, n: 0, i: 0 };
  for (const s of states) if (s in out) out[s]++;
  return out;
}

// The minute counts of the slot under way, per desk. sample() takes this minute's counts ({ desk: { w, c, n, i } },
// desks with nothing live left out) and gives back the lines of any slot it finished. open() is the slot under way
// as lines so far, for the footer's "now".
export function createTally() {
  let cur = null; // { t, samples, desks: Map desk -> { sum, peak, busy } }
  const lineOf = (t, samples, d, a) => {
    const line = { t, d };
    for (const k of STATES) line[k] = [a.peak[k], r1(a.sum[k] / samples)];
    line.b = r1((a.busy / samples) * SLOT_MIN);
    return line;
  };
  const linesOf = (slot) => slot ? [...slot.desks].filter(([, a]) => STATES.some((k) => a.peak[k])).map(([d, a]) => lineOf(slot.t, slot.samples, d, a)) : [];
  return {
    sample(at, byDesk) {
      const t = slotKey(at);
      let done = [];
      if (cur && cur.t !== t) { done = linesOf(cur); cur = null; }
      cur ||= { t, samples: 0, desks: new Map() };
      cur.samples++;
      for (const [d, n] of Object.entries(byDesk)) {
        if (!cur.desks.has(d)) cur.desks.set(d, { sum: { w: 0, c: 0, n: 0, i: 0 }, peak: { w: 0, c: 0, n: 0, i: 0 }, busy: 0 });
        const a = cur.desks.get(d);
        for (const k of STATES) { a.sum[k] += n[k] || 0; a.peak[k] = Math.max(a.peak[k], n[k] || 0); }
        if (n.w > 0) a.busy++;
      }
      return done;
    },
    open: () => linesOf(cur),
  };
}

// ---------- rebuilding the past from the transcripts ----------
// The turns of one Claude transcript as merged [start, end] spans in ms: each runs from a prompt line (a user line
// that is not a tool result or a compaction summary) to the last assistant line before the next prompt. Helper agents'
// (sidechain) lines are left out; their work is inside the turn that started them.
export function turnSpans(text) {
  const spans = [];
  let turn = null;
  for (const line of String(text || '').split('\n')) {
    if (line.includes('"isSidechain":true')) continue;
    if (line.includes('"type":"assistant"')) { // the big lines: read the time only
      const at = Date.parse(line.match(/"timestamp":"([^"]+)"/)?.[1] || '') || 0;
      if (turn && at > turn[1]) turn[1] = at;
      continue;
    }
    if (!line.includes('"type":"user"') || line.includes('"tool_use_id"')) continue; // a tool result: not a new turn
    let e; try { e = JSON.parse(line); } catch { continue; }
    const at = Date.parse(e.timestamp) || 0;
    if (e.type !== 'user' || !at || e.isCompactSummary) continue;
    turn = [at, at]; spans.push(turn);
  }
  return mergeSpans(spans);
}
export function mergeSpans(spans) {
  const out = [];
  for (const [a, b] of spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}
// Working counts per slot from many sessions' turns. add() takes one session's spans (cut at `before`, where live
// tracking took over); lines() gives a line per desk and slot with any working, marked rebuilt: the peak is the most
// sessions working at once, the average their working time over the slot, b the minutes with at least one.
export function createRebuild() {
  const slots = new Map(); // desk \n slot -> [[a, b], ...]
  return {
    add(desk, spans, before = Infinity) {
      for (const [from, to] of mergeSpans(spans)) {
        let a = from; const b = Math.min(to, before);
        while (a < b) {
          // the slot's end from the moment itself, not its local name: in the hour clocks go back, two slots share one
          const t = slotKey(a), end = Math.min(b, a - (a % SLOT_MS) + SLOT_MS), k = desk + '\n' + t;
          if (!slots.has(k)) slots.set(k, []);
          slots.get(k).push([a, end]);
          a = end;
        }
      }
    },
    lines() {
      const out = [];
      for (const [k, spans] of slots) {
        const [d, t] = k.split('\n');
        let peak = 0, now = 0, sum = 0;
        for (const [, x] of spans.flatMap(([a, b]) => [[a, 1], [b, -1]]).sort((x, y) => x[0] - y[0] || x[1] - y[1])) peak = Math.max(peak, (now += x));
        for (const [a, b] of spans) sum += b - a;
        const busy = mergeSpans(spans.map((s) => [...s])).reduce((n, [a, b]) => n + b - a, 0);
        out.push({ t, d, w: [peak, r1(sum / SLOT_MS)], b: r1(busy / 60000), r: 1 });
      }
      return sortLines(out);
    },
  };
}
export const sortLines = (lines) => lines.sort((x, y) => (x.t < y.t ? -1 : x.t > y.t ? 1 : x.d < y.d ? -1 : x.d > y.d ? 1 : 0));
const keyOf = (l) => l.d + '\n' + l.t;
const hourOf = (t) => t.slice(0, 13) + ':00';
// The rebuilt lines added to the ones already kept, never over a slot (or hour) live tracking recorded.
export function mergeRebuilt(kept, rebuilt) {
  const have = new Set(kept.map(keyOf)), hours = new Set(kept.filter((l) => l.h).map((l) => l.d + '\n' + l.t));
  return sortLines([...kept, ...rebuilt.filter((l) => !have.has(keyOf(l)) && !hours.has(l.d + '\n' + hourOf(l.t)))]);
}

// Runs the rebuild once per computer: meta is what <data>/activity-meta.json holds (read() gives it, or null);
// once a run finished it says when, and it is never run again. A run cut short (Docket stopped) runs again next time.
export async function runOnce({ read, write, run, now = Date.now }) {
  const meta = read() || {};
  if (meta.rebuilt) return { skipped: true, meta };
  const result = await run();
  const out = { ...meta, rebuilt: new Date(now()).toISOString(), ...result };
  write(out);
  return { skipped: false, meta: out };
}

// ---------- keeping it small ----------
// Slots grouped by desk and hour: the peak is the hour's highest, the average over all twelve slots (a slot with
// nothing live counts as none), b the minutes added up. Rebuilt only when every slot in it was.
export function toHours(lines) {
  const by = new Map();
  for (const l of lines) {
    if (l.h) { by.set(keyOf(l), { ...l }); continue; }
    const t = hourOf(l.t), k = l.d + '\n' + t;
    if (!by.has(k)) by.set(k, { t, d: l.d, ...Object.fromEntries(STATES.map((s) => [s, [0, 0]])), b: 0, h: 1, r: 1 });
    const h = by.get(k);
    for (const s of STATES) if (l[s]) { h[s][0] = Math.max(h[s][0], l[s][0]); h[s][1] += l[s][1] / 12; }
    h.b += l.b || 0;
    if (!l.r) h.r = 0;
  }
  return sortLines([...by.values()].map((h) => {
    for (const s of STATES) h[s] = [h[s][0], r1(h[s][1])];
    h.b = r1(h.b);
    for (const s of ['c', 'n', 'i']) if (!h[s][0]) delete h[s]; // a rebuilt hour has working only
    if (!h.r) delete h.r;
    return h;
  }));
}
// Slots before the cutoff day ("YYYY-MM-DD") rolled up to hours; later ones kept as they are.
export function rollUp(lines, cutoffDay) {
  const old = lines.filter((l) => l.t < cutoffDay), keep = lines.filter((l) => l.t >= cutoffDay);
  return old.some((l) => !l.h) ? sortLines([...toHours(old), ...keep]) : lines;
}

// ---------- reading it back ----------
// Every desk's lines for one slot added together, for "All desks". Peaks add up (the most there could have been at
// once); b takes the busiest desk's, the least time anyone was working.
export function sumDesks(lines) {
  const by = new Map();
  for (const l of lines) {
    if (!by.has(l.t)) { by.set(l.t, { t: l.t, d: '', ...Object.fromEntries(STATES.map((s) => [s, [0, 0]])), b: 0, r: 1, ...(l.h ? { h: 1 } : {}) }); }
    const o = by.get(l.t);
    for (const s of STATES) if (l[s]) { o[s][0] += l[s][0]; o[s][1] = Math.round((o[s][1] + l[s][1]) * 10) / 10; }
    o.b = Math.max(o.b, l.b || 0);
    if (!l.r) o.r = 0;
  }
  return sortLines([...by.values()]);
}
// The figures the tiles show for some (desk-summed) lines: the peak working and when, the average working from 08:00
// to 18:00 over the days that have any, the time with at least one working, and the average (over the slots with
// anything live) and peak waiting on you.
export function tiles(lines) {
  const out = { peak: 0, peakAt: null, dayAvg: 0, busyMin: 0, waitAvg: 0, waitPeak: 0, waitPeakAt: null, rebuilt: false };
  const days = new Set(); let day = 0, wait = 0, liveSlots = 0;
  for (const l of lines) {
    const w = l.w || [0, 0], n = l.n || [0, 0];
    days.add(l.t.slice(0, 10));
    if (w[0] > out.peak) { out.peak = w[0]; out.peakAt = l.t; }
    const m = minutes(l.t);
    if (m >= 8 * 60 && m < 18 * 60) day += w[1] * weight(l);
    out.busyMin += l.b || 0;
    if (l.r) { out.rebuilt = true; continue; } // rebuilt slots say nothing about waiting
    liveSlots += weight(l); wait += n[1] * weight(l);
    if (n[0] > out.waitPeak) { out.waitPeak = n[0]; out.waitPeakAt = l.t; }
  }
  out.dayAvg = days.size ? Math.round((day / (days.size * 120)) * 10) / 10 : 0;
  out.waitAvg = liveSlots ? Math.round((wait / liveSlots) * 10) / 10 : 0;
  out.busyMin = Math.round(out.busyMin);
  return out;
}
// The average working by weekday (Monday first) and hour over the 28 days to endDay, from desk-summed lines.
export function heat(lines, endDay, weeks = 4) {
  const end = new Date(endDay + 'T12:00:00'), first = new Date(end); first.setDate(first.getDate() - weeks * 7 + 1);
  const from = dayOf(first), cells = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const l of lines) {
    const d = l.t.slice(0, 10);
    if (d < from || d > endDay) continue;
    const wd = (new Date(d + 'T12:00:00').getDay() + 6) % 7, h = +l.t.slice(11, 13);
    cells[wd][h] += ((l.w?.[1] || 0) * weight(l)) / (12 * weeks);
  }
  return cells.map((row) => row.map((v) => Math.round(v * 100) / 100));
}
// Today's working line for the footer: the average working per slot from midnight, and the peak, when it was, and
// the minutes with at least one working.
export function today(lines, day) {
  const mine = lines.filter((l) => l.t.startsWith(day));
  const t = tiles(mine);
  return { slots: mine.map((l) => ({ t: l.t, w: l.w?.[1] || 0, p: l.w?.[0] || 0, r: l.r ? 1 : 0 })), peak: t.peak, peakAt: t.peakAt, busyMin: t.busyMin };
}
