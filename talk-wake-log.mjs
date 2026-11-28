// Hands-free Talk's comparison log (#1228): one row for each wake (either method heard the wake name) and one for each
// stretch of listening, so methods A and B can be compared after a day in a real room. Words heard are cut to
// TEXT_MAX characters; no audio is ever kept. Pure, for the page (which makes the rows) and the app (which keeps the
// last WAKE_KEEP in <data>/talk-wake.jsonl and works out the numbers for Talk's settings).
export const TEXT_MAX = 80, WAKE_KEEP = 2000;
// What came of a wake: sent (the read-back ran out and it went), confirmed (yes or send), cancelled, stopped (it was
// "<wake name>, stop"), empty (nothing said after the wake name), none (comparison mode, and nobody answered).
export const OUTCOMES = ['sent', 'confirmed', 'cancelled', 'stopped', 'empty', 'none'];
const GOOD = new Set(['sent', 'confirmed', 'stopped']), BAD = new Set(['cancelled', 'empty', 'none']);
const cut = (t) => { t = String(t ?? '').replace(/\s+/g, ' ').trim(); return t.length > TEXT_MAX ? `${t.slice(0, TEXT_MAX - 1)}…` : t; };
const num = (x) => (Number.isFinite(x) && x >= 0 ? Math.round(x) : 0);
const score = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, +x.toFixed(3))) : 0);
const ran = (r) => (Array.isArray(r) ? ['a', 'b'].filter((m) => r.includes(m)) : []);

// A wake: mode (live or compare), which methods were running, which woke it first, what each made of it (a: did the
// wake name match, how well, the words, how long the check took and where it ran; b: the best score), and what came of it.
export function wakeRow({ at = Date.now(), mode, ran: r, first, a = null, b = null, outcome, target = '' }) {
  return cleanWakeRow({ kind: 'wake', at: new Date(at).toISOString(), mode, ran: r, first, a, b, outcome, target });
}
// A stretch of listening: its minutes, which methods ran, and the work each did (ms of the voice activity detector and
// openWakeWord on the processor, and of Whisper's wake checks on the graphics card or processor).
export function listenRow({ at = Date.now(), minutes, ran: r, vadMs, bMs, aMs, aRuns, aDevice }) {
  return cleanWakeRow({ kind: 'listen', at: new Date(at).toISOString(), minutes, ran: r, vadMs, bMs, aMs, aRuns, aDevice });
}
// What the app keeps of a row the page sent: only these fields, of these kinds. null for anything else.
export function cleanWakeRow(r) {
  if (!r || typeof r !== 'object' || Number.isNaN(Date.parse(r.at))) return null;
  const at = new Date(r.at).toISOString(), device = (d) => (d === 'webgpu' ? 'webgpu' : 'wasm');
  if (r.kind === 'listen') {
    const minutes = Number.isFinite(r.minutes) && r.minutes > 0 ? Math.min(24 * 60, +r.minutes.toFixed(2)) : 0;
    return { kind: 'listen', at, minutes, ran: ran(r.ran), vadMs: num(r.vadMs), bMs: num(r.bMs), aMs: num(r.aMs), aRuns: num(r.aRuns), aDevice: device(r.aDevice) };
  }
  if (r.kind !== 'wake' || !OUTCOMES.includes(r.outcome)) return null;
  return {
    kind: 'wake', at, mode: r.mode === 'live' ? 'live' : 'compare', ran: ran(r.ran), first: r.first === 'b' ? 'b' : 'a',
    a: r.a ? { hit: !!r.a.hit, score: score(r.a.score), words: cut(r.a.words), ms: num(r.a.ms), device: device(r.a.device) } : null,
    b: r.b ? { hit: !!r.b.hit, score: score(r.b.score) } : null,
    outcome: r.outcome, target: cut(r.target),
  };
}

// The numbers for each method, from the rows: wakes, how many were right (sent, confirmed, or a stop) and wrong
// (cancelled, nothing said, or unanswered in comparison mode), wrong wakes an hour, misses (the other method woke it,
// it was right, and this one was running but did not), and the work an hour on the processor and graphics card.
export function wakeStats(rows) {
  const out = {};
  for (const m of ['a', 'b']) {
    const listen = rows.filter((r) => r.kind === 'listen' && r.ran.includes(m)), hours = listen.reduce((s, r) => s + r.minutes, 0) / 60;
    const wakes = rows.filter((r) => r.kind === 'wake' && r[m]?.hit);
    const good = wakes.filter((r) => GOOD.has(r.outcome)).length, bad = wakes.filter((r) => BAD.has(r.outcome)).length;
    const missed = rows.filter((r) => r.kind === 'wake' && r.ran.includes(m) && !r[m]?.hit && GOOD.has(r.outcome)).length;
    let cpu = 0, gpu = 0;
    for (const r of listen) {
      if (m === 'a') { cpu += r.vadMs; if (r.aDevice === 'webgpu') gpu += r.aMs; else cpu += r.aMs; } else cpu += r.bMs;
    }
    const perHour = (x) => (hours > 0 ? +(x / hours).toFixed(1) : null);
    out[m] = { hours: +hours.toFixed(2), wakes: wakes.length, good, bad, missed, badPerHour: perHour(bad), cpuMsPerHour: perHour(cpu) === null ? null : Math.round(cpu / hours), gpuMsPerHour: perHour(gpu) === null ? null : Math.round(gpu / hours) };
  }
  return out;
}
// One line for a method in Talk's settings: "A · 3.5 h · 12 wakes: 10 right, 2 wrong (0.6 an hour) · 1 missed · 4.1 s of processor an hour".
export function statWords(m, s) {
  if (!s || (!s.hours && !s.wakes)) return `${m.toUpperCase()}: nothing logged yet.`;
  const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
  return [`${m.toUpperCase()} · ${s.hours} h listening`, `${s.wakes} wake${s.wakes === 1 ? '' : 's'}: ${s.good} right, ${s.bad} wrong${s.badPerHour != null ? ` (${s.badPerHour} an hour)` : ''}`,
    `${s.missed} missed`, ...(s.cpuMsPerHour != null ? [`${secs(s.cpuMsPerHour)} of processor an hour`] : []), ...(s.gpuMsPerHour ? [`${secs(s.gpuMsPerHour)} of graphics card an hour`] : [])].join(' · ');
}
// One line for a wake row in the log list: "10:42 · A (0.92) and B (0.71) · "Docket, tell it yes" · sent to Relay fix".
export function wakeWords(r) {
  const t = new Date(r.at).toTimeString().slice(0, 5);
  const who = [r.a?.hit && `A (${r.a.score})`, r.b?.hit && `B (${r.b.score})`].filter(Boolean).join(' and ') || 'neither';
  const what = { sent: `sent${r.target ? ` to ${r.target}` : ''}`, confirmed: 'you said yes', cancelled: 'you cancelled', stopped: 'stopped the reading', empty: 'nothing said after it', none: 'no answer' }[r.outcome];
  return [t, `${r.mode === 'compare' ? 'compare · ' : ''}${who}`, ...(r.a?.words ? [`"${r.a.words}"`] : []), what].join(' · ');
}
