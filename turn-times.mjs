// Turn timings over days (#793): one JSON line per finished turn in <data>/turn-times-YYYY-MM.jsonl, so a week or
// two of them shows whether slow turns come from this computer and its hooks, the model, or Docket itself.
// scripts/turn-report.mjs reads them back. Each line costs nothing much to take: no process listing (the ☰ gauges'
// machineNow is far too slow for this), only os.cpus() time totals and the event-loop delay histogram.
import fs from 'node:fs';
import path from 'node:path';
import { covered } from './chat-times.mjs';

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // a month's file stops growing past this (about 50,000 turns)
export const fileFor = (dir, at = Date.now()) => {
  const d = new Date(at);
  return path.join(dir, `turn-times-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}.jsonl`);
};

// The computer's busy share since the last look, from os.cpus()'s per-core time totals: [{ times: { user, nice,
// sys, idle, irq } }]. Null for the first look.
export const cpuTotals = (cpus) => cpus.reduce((t, c) => {
  const all = Object.values(c.times).reduce((a, b) => a + b, 0);
  return { busy: t.busy + all - c.times.idle, all: t.all + all };
}, { busy: 0, all: 0 });
export function cpuBusy(before, after) {
  if (!before || !after || after.all <= before.all) return null;
  return Math.round(((after.busy - before.busy) / (after.all - before.all)) * 100);
}

// What the computer and Docket were like since the previous line. `histogram` is perf_hooks.monitorEventLoopDelay's,
// already enabled with `resolutionMs`; it is reset at each look so every line covers only its own stretch. Its
// figures include that sampling step, which is taken off, so 0 means no hold-up.
export function createSampler({ cpus, freemem, histogram, resolutionMs = 0 }) {
  const ms = (ns) => Math.max(0, Math.round(ns / 1e5 - resolutionMs * 10) / 10); // ns to ms, one decimal
  let last = cpuTotals(cpus());
  return () => {
    const now = cpuTotals(cpus());
    const out = {
      cpu: cpuBusy(last, now), freeMb: Math.round(freemem() / 1048576),
      loopP50: histogram?.count ? ms(histogram.percentile(50)) : null, loopP99: histogram?.count ? ms(histogram.percentile(99)) : null,
    };
    last = now; histogram?.reset();
    return out;
  };
}

// One turn's line. `split` is hookSplit's { modelMs, toolMs, hookMs }, or null when no hook ran: then the tools'
// own spans ([[start, end]]) give the tool time. No prompt text or tool inputs.
export function turnLine({ at = Date.now(), session, desk, brand, model, error, ms, split, tools = [], usage, working, machine = {} }) {
  const end = at, start = end - (ms || 0);
  const toolMs = split ? split.toolMs : ms ? covered(tools.map(([a, b]) => [a, b || end]), start, end) : 0;
  const hookMs = split ? split.hookMs : 0;
  return {
    at: new Date(at).toISOString(), session, desk, brand: brand || 'claude', model: model || null, error: !!error,
    ms: ms || 0, modelMs: split ? split.modelMs : Math.max(0, (ms || 0) - toolMs), toolMs, hookMs, tools: tools.length,
    outTok: usage?.output_tokens ?? null, inTok: usage?.input_tokens ?? null,
    cacheTok: usage ? (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) : null,
    working, ...machine,
  };
}

// Appends a line to this month's file, unless that file is already at the cap. Never throws.
export function appendLine(dir, line, { append = fs.promises.appendFile, size = (f) => { try { return fs.statSync(f).size; } catch { return 0; } } } = {}) {
  const f = fileFor(dir, Date.parse(line.at));
  if (size(f) >= MAX_FILE_BYTES) return Promise.resolve(false);
  return append(f, JSON.stringify(line) + '\n').then(() => true, () => false);
}

// ---- the report ----

// Every line from the files in `dir` at or after `since` (ms).
export function readLines(dir, since = 0) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /^turn-times-\d{4}-\d{2}\.jsonl$/.test(f)).sort(); } catch { return []; }
  const out = [];
  for (const f of files) for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try { const x = JSON.parse(l); if (Date.parse(x.at) >= since) out.push(x); } catch {}
  }
  return out;
}

export const WORKING_BUCKETS = [['1', (n) => n <= 1], ['2–3', (n) => n >= 2 && n <= 3], ['4–7', (n) => n >= 4 && n <= 7], ['8+', (n) => n >= 8]];
export const workingBucket = (n) => WORKING_BUCKETS.find(([, t]) => t(n || 0))[0];
export const hourOf = (at) => new Date(at).getHours(); // the computer's own hour of day

export const pct = (xs, p) => {
  const s = xs.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null;
};

// The figures for one group of lines.
export function summarize(lines) {
  const sum = (k) => lines.reduce((t, l) => t + (l[k] || 0), 0);
  const timed = lines.filter((l) => l.outTok != null && l.modelMs > 0);
  const modelSecs = timed.reduce((t, l) => t + l.modelMs, 0) / 1000;
  const of = (k) => lines.map((l) => l[k]);
  return {
    turns: lines.length, errors: lines.filter((l) => l.error).length,
    ms: [pct(of('ms'), 0.5), pct(of('ms'), 0.9)], modelMs: [pct(of('modelMs'), 0.5), pct(of('modelMs'), 0.9)],
    toolMs: [pct(of('toolMs'), 0.5), pct(of('toolMs'), 0.9)], hookMs: [pct(of('hookMs'), 0.5), pct(of('hookMs'), 0.9)],
    hookShare: sum('ms') ? sum('hookMs') / sum('ms') : null,
    tokPerSec: modelSecs ? timed.reduce((t, l) => t + l.outTok, 0) / modelSecs : null,
    cpu: pct(of('cpu'), 0.5), loopP50: pct(of('loopP50'), 0.5), loopP99: pct(of('loopP99'), 0.5),
  };
}

// The lines grouped by `keyOf`, in the order of `keys` (groups with no lines left out).
export function groupBy(lines, keyOf, keys) {
  const m = new Map(keys.map((k) => [k, []]));
  for (const l of lines) m.get(keyOf(l))?.push(l);
  return [...m].filter(([, ls]) => ls.length).map(([key, ls]) => ({ key, ...summarize(ls) }));
}
export const byHour = (lines) => groupBy(lines, (l) => hourOf(l.at), [...Array(24).keys()]);
export const byWorking = (lines) => groupBy(lines, (l) => workingBucket(l.working), WORKING_BUCKETS.map(([k]) => k));

// A hook program's own log (lines like `time=2026-11-03T10:00:00Z … hook done: … outcome=deadline …`), counted by
// the computer's hour of day: { [hour]: { calls, deadline } }, from `since` (ms) on.
export function hookLogHours(text, since = 0, into = {}) {
  for (const line of text.split('\n')) {
    if (!line.includes('hook done:')) continue;
    const at = Date.parse((line.match(/^time=(\S+)/) || [])[1]);
    if (!at || at < since) continue;
    const h = (into[hourOf(at)] ||= { calls: 0, deadline: 0 });
    h.calls++;
    if (/\boutcome=deadline\b/.test(line)) h.deadline++;
  }
  return into;
}

const secs = (ms) => (ms == null ? '–' : (ms / 1000).toFixed(1));
const pair = ([a, b]) => `${secs(a)} / ${secs(b)}`;
const num = (x, d = 0) => (x == null ? '–' : x.toFixed(d));

// The report as Markdown tables.
export function reportText(lines, { days, hookHours } = {}) {
  if (!lines.length) return `No turns logged${days ? ` in the last ${days} days` : ''}.\n`;
  const first = lines.reduce((a, l) => (l.at < a ? l.at : a), lines[0].at), last = lines.reduce((a, l) => (l.at > a ? l.at : a), lines[0].at);
  const hooks = hookHours && Object.keys(hookHours).length;
  const head = (key, extra = '') => `| ${key} | turns | turn p50 / p90 | model p50 / p90 | tools p50 / p90 | hooks p50 / p90 | hooks share | out tok/s | CPU % | loop p50 / p99 ms |${extra}\n|${'---|'.repeat(10 + (extra.match(/\|/g) || []).length)}`;
  const row = (g, extra = '') => `| ${g.key} | ${g.turns}${g.errors ? ` (${g.errors} err)` : ''} | ${pair(g.ms)} | ${pair(g.modelMs)} | ${pair(g.toolMs)} | ${pair(g.hookMs)} | ${g.hookShare == null ? '–' : Math.round(g.hookShare * 100) + '%'} | ${num(g.tokPerSec, 1)} | ${num(g.cpu)} | ${num(g.loopP50, 1)} / ${num(g.loopP99, 1)} |${extra}`;
  const all = { key: 'all', ...summarize(lines) };
  return [
    `${lines.length} turns from ${first} to ${last}. Times in seconds (p50 / p90); hooks share is hook time over all turn time;`,
    'out tok/s is output tokens per second of model time; CPU % and loop delay are medians of each turn\'s figures.',
    '', '## By sessions working when the turn ended', '', head('working'), ...byWorking(lines).map((g) => row(g)), row(all),
    '', '## By hour of day (this computer\'s clock)', '',
    head('hour', hooks ? ' hook calls | deadline |' : ''),
    ...byHour(lines).map((g) => row({ ...g, key: String(g.key).padStart(2, '0') }, hooks ? ` ${hookHours[g.key]?.calls ?? 0} | ${hookHours[g.key]?.deadline ?? 0} |` : '')),
    '',
  ].join('\n');
}
