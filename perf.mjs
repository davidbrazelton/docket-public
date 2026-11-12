// ☰ > Gauges > Performance (#935): one sample every 30 seconds of the power state, the computer's CPU and free
// memory, how many sessions are live, working and resting, the app's event-loop delay and the pages' long tasks,
// so a stretch on battery can be set beside one plugged in: is it the page, the sessions, or both? server.mjs takes
// the samples; this file keeps them (<data>/perf-samples.jsonl, the last day), adds up what the pages report, and
// says when something stays over a threshold, for the event log.
import fs from 'node:fs';
import path from 'node:path';

export const SAMPLE_MS = 30_000;
export const KEEP = 2880; // a day of samples; the file is cut back to this when it is a quarter over
export const fileFor = (dir) => path.join(dir, 'perf-samples.jsonl');

// The samples saved before, oldest first (bad lines skipped).
export function loadSamples(dir) {
  let text = '';
  try { text = fs.readFileSync(fileFor(dir), 'utf8'); } catch { return []; }
  const out = [];
  for (const l of text.split('\n')) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch {} }
  return out.slice(-KEEP);
}
// Adds a sample to the list and the file. The file only grows by a line, until it is a quarter over KEEP; then it
// is written again with the last KEEP. Never throws.
export function keepSample(dir, list, sample, { write = fs.writeFileSync, append = fs.appendFileSync } = {}) {
  list.push(sample);
  try {
    if (list.length > KEEP * 1.25) { list.splice(0, list.length - KEEP); write(fileFor(dir), list.map((x) => JSON.stringify(x)).join('\n') + '\n'); }
    else append(fileFor(dir), JSON.stringify(sample) + '\n');
  } catch {}
  return list;
}

// What the open pages said since the last sample. Each page sends { tasks, ms, frames, visible } every 30 seconds:
// its long tasks (over 50 ms), the time they held the page, and its slow frames (long animation frames, where the
// browser has them). take() turns the sums into rates per minute over `spanMs`, or nulls when no page reported.
export function pageTally() {
  let t = { pages: 0, tasks: 0, ms: 0, frames: 0, visible: 0 };
  return {
    add(r) {
      t.pages++; t.tasks += Math.max(0, Number(r?.tasks) || 0); t.ms += Math.max(0, Number(r?.ms) || 0);
      t.frames += Math.max(0, Number(r?.frames) || 0); if (r?.visible) t.visible++;
    },
    take(spanMs = SAMPLE_MS) {
      const per = 60_000 / Math.max(1000, spanMs), x = t;
      t = { pages: 0, tasks: 0, ms: 0, frames: 0, visible: 0 };
      if (!x.pages) return { pages: 0, pagesVisible: 0, pageTasks: null, pageMs: null, pageFrames: null };
      return { pages: x.pages, pagesVisible: x.visible, pageTasks: Math.round(x.tasks * per), pageMs: Math.round(x.ms * per), pageFrames: Math.round(x.frames * per) };
    },
  };
}

// When a figure counts as slow, held for HOLD samples in a row (two minutes) before it is logged.
export const LIMITS = { cpu: 85, loopP99: 200, pageTasks: 30 };
export const HOLD = 4;
const over = (x) => ({ cpu: x.cpu != null && x.cpu >= LIMITS.cpu, app: x.loopP99 != null && x.loopP99 >= LIMITS.loopP99, page: x.pageTasks != null && x.pageTasks >= LIMITS.pageTasks });

// One line for the event log: "on battery 54%, CPU 91% for 2 min, 7 working, app lag 340 ms, page long tasks 40/min".
export function summaryText(samples) {
  const last = samples.at(-1); if (!last) return '';
  const mins = Math.max(1, Math.round(samples.length * SAMPLE_MS / 60_000));
  const avg = (k) => { const v = samples.map((x) => x[k]).filter((n) => n != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const power = last.onBattery == null ? 'no battery' : last.onBattery ? `on battery${last.battery != null ? ' ' + last.battery + '%' : ''}` : 'plugged in';
  return [power, `CPU ${avg('cpu') ?? '–'}% for ${mins} min`, `${last.working ?? 0} working of ${last.live ?? 0} live`,
    `app lag ${avg('loopP99') ?? '–'} ms`, `page long tasks ${avg('pageTasks') ?? '–'}/min`, `${last.freeMb ?? '–'} MB free`].join(', ');
}

// Whether the newest samples start or end a slow stretch. `was` is the previous answer's `slow` (a set of 'cpu',
// 'app', 'page'). Returns { slow, log }: log is the event-log line when the set changes, else ''.
export function checkSlow(samples, was = new Set()) {
  const recent = samples.slice(-HOLD);
  const slow = new Set();
  if (recent.length === HOLD) for (const k of ['cpu', 'app', 'page']) if (recent.every((x) => over(x)[k])) slow.add(k);
  // A figure stays slow until it is back under its limit, so one sample just over does not log twice.
  for (const k of was) if (!slow.has(k) && over(samples.at(-1) || {})[k]) slow.add(k);
  const names = { cpu: 'CPU', app: 'app lag', page: 'page lag' };
  const added = [...slow].filter((k) => !was.has(k)), gone = [...was].filter((k) => !slow.has(k));
  let log = '';
  if (added.length) log = `performance: slow (${added.map((k) => names[k]).join(', ')})\n${summaryText(recent)}`;
  else if (gone.length && !slow.size) log = `performance: back to normal\n${summaryText(samples.slice(-1))}`;
  return { slow, log };
}

// The last hour (or `since`) for the window: the samples, and averages on battery and plugged in side by side.
export function perfView(samples, { now = Date.now(), since = now - 3600_000 } = {}) {
  const list = samples.filter((x) => x.at >= since);
  const avg = (l, k) => { const v = l.map((x) => x[k]).filter((n) => n != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null; };
  const side = (l) => ({ samples: l.length, minutes: Math.round(l.length * SAMPLE_MS / 60_000),
    ...Object.fromEntries(['cpu', 'docketCpu', 'freeMb', 'live', 'working', 'resting', 'loopP99', 'pageTasks', 'pageMs', 'pageFrames'].map((k) => [k, avg(l, k)])) });
  return { since, now, every: SAMPLE_MS, limits: LIMITS, samples: list,
    battery: side(list.filter((x) => x.onBattery === true)), plugged: side(list.filter((x) => x.onBattery !== true)) };
}
