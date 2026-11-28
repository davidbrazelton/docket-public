// The load monitor: the rules, kept apart from the server so they can be tested (#1067).
// Every perf sample (perf.mjs, one each 30 s) it asks whether the computer has been under strain for about 2 minutes:
// the app's event-loop p99 over 500 ms, machine CPU over 85% or free memory under 3,000 MB, the signals that showed
// the trouble in the 2026-11-14 performance report. While it is, and queue mode is off, it suggests queue mode (Turn on /
// Not now; Not now quiets it for 2 hours). While queue mode is on, it lowers the limit by one instead. Either ends once
// the load has been normal for 5 minutes. server.mjs passes what it decides to queueLoad.

export const LOAD_LIMITS = { loopP99: 500, cpu: 85, freeMb: 3000 };
export const LOAD_HOLD = 4; // samples in a row: about 2 minutes
export const NORMAL_MS = 5 * 60_000; // normal this long ends a suggestion or a lowered limit
export const QUIET_MS = 2 * 3600_000; // Not now
const GAP_MS = 75_000; // samples further apart than this are not "in a row" (the sampler stopped, the computer slept)

// Which signals one sample is over: a set of 'app', 'cpu', 'mem'. A sample that overlaps sleep or standby (slept,
// perf.mjs) is over on nothing: its lag is the computer waking, not load.
export function strain(x = {}) {
  const out = new Set();
  if (x.slept) return out;
  if (x.loopP99 > LOAD_LIMITS.loopP99) out.add('app');
  if (x.cpu > LOAD_LIMITS.cpu) out.add('cpu');
  if (x.freeMb != null && x.freeMb < LOAD_LIMITS.freeMb) out.add('mem');
  return out;
}

// Whether the newest samples show high load: the last LOAD_HOLD each over on at least one signal, back to back, the
// newest one fresh. Returns the signals over in every one of them (or, when they took turns, those of the newest), or null.
export function loadHigh(samples, now = Date.now()) {
  const recent = samples.slice(-LOAD_HOLD);
  if (recent.length < LOAD_HOLD || now - recent.at(-1).at > GAP_MS) return null;
  for (let i = 1; i < recent.length; i++) if (recent[i].at - recent[i - 1].at > GAP_MS) return null;
  const each = recent.map(strain);
  if (each.some((s) => !s.size)) return null;
  const all = [...each[0]].filter((k) => each.every((s) => s.has(k)));
  return all.length ? all : [...each.at(-1)];
}

// The reason in words, from the samples that showed it: "on battery, app lag 750 ms for 2 min, 5 working".
export function loadReason(samples, keys) {
  const recent = samples.slice(-LOAD_HOLD), last = recent.at(-1) || {};
  const avg = (k) => { const v = recent.map((x) => x[k]).filter((n) => n != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const mins = Math.max(1, Math.round((last.at - recent[0].at + 30_000) / 60_000));
  const parts = [];
  if (last.onBattery) parts.push('on battery');
  if (keys.includes('app')) parts.push(`app lag ${Math.round(avg('loopP99') / 10) * 10} ms`);
  if (keys.includes('cpu')) parts.push(`CPU ${Math.round(avg('cpu'))}%`);
  if (keys.includes('mem')) parts.push(`${(Math.min(...recent.map((x) => x.freeMb ?? Infinity)) / 1024).toFixed(1)} GB free`);
  parts[parts.length - 1] += ` for ${mins} min`;
  if (last.working != null) parts.push(`${last.working} working`);
  return parts.join(', ');
}

// One step of the monitor. st: what it kept from the last step, { reason, cap, normalSince } (reason: the suggestion
// or lowered limit in force, else null). quietUntil: Not now's end. queueOn: queue mode is on now; limit: its limit
// before any cap. Returns the next st; its reason and cap are what queueLoad should show (reason null: nothing).
export function loadStep(st = {}, { samples, now = Date.now(), queueOn = false, limit = Infinity, quietUntil = 0 }) {
  const keys = loadHigh(samples, now);
  const normalSince = keys ? null : st.normalSince ?? now;
  const cap = queueOn && limit !== Infinity && limit > 1 ? limit - 1 : null;
  if (keys) {
    if (queueOn) return { reason: cap ? (st.cap === cap && st.reason) || loadReason(samples, keys) : null, cap, normalSince };
    if (now < quietUntil) return { reason: null, cap: null, normalSince };
    return { reason: st.reason && !st.cap ? st.reason : loadReason(samples, keys), cap: null, normalSince };
  }
  // Normal now: what is in force stays until 5 minutes of it, unless it no longer fits (queue mode turned on or off,
  // or Not now pressed).
  if (!st.reason || now - normalSince >= NORMAL_MS) return { reason: null, cap: null, normalSince };
  if (!st.cap && (queueOn || now < quietUntil)) return { reason: null, cap: null, normalSince };
  if (st.cap && !cap) return { reason: null, cap: null, normalSince };
  return { reason: st.reason, cap: st.cap ? cap : null, normalSince };
}

// "Turn on queue mode automatically on battery": the event-log line when plugging in or out switches queue mode, or ''.
// on: the person's own setting. Unknown power (null) counts as plugged in, as queueLimit does.
export function batterySwitch({ on, autoBattery }, wasBattery, nowBattery) {
  if (on || !autoBattery || !!wasBattery === !!nowBattery) return '';
  return nowBattery ? 'queue mode: on (on battery, automatically)' : 'queue mode: back off (plugged in)';
}
