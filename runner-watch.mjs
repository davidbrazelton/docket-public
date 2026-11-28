// Deciding whether the session runner is gone, without blaming it for the app's own stalls (#1124).
// A health check that times out while the app's event loop is blocked says nothing about the runner:
// its answer and the abort timer are both waiting when the loop comes back, and timers run first.
// So a check whose timer fired late does not count, and the runner is called gone only after
// several real misses in a row.

export const PROBE_TIMEOUT_MS = 2000; // how long a health check waits for the runner
export const LATE_SLACK_MS = 1000; // a check that took this much longer than its timeout: the app stalled
export const MISSES = 3; // real misses in a row before the runner is called gone
export const MAX_PROBES = 12; // checks in one decision, counting those the app's stalls spoilt
export const GAP_MS = 500; // between checks

// One check's verdict: 'up' (it answered), 'down' (a real miss) or 'unsure' (the app stalled, so no
// verdict). A refused connection is a real miss however long it took: nothing is listening.
export function probeVerdict({ ok, error, elapsedMs, timeoutMs = PROBE_TIMEOUT_MS, slackMs = LATE_SLACK_MS }) {
  if (ok) return 'up';
  if (error?.cause?.code === 'ECONNREFUSED' || error?.code === 'ECONNREFUSED') return 'down';
  if (elapsedMs > timeoutMs + slackMs) return 'unsure';
  return 'down';
}

// Asks url once. fetch and now can be stand-ins in the tests.
export async function probeOnce(url, { fetch = globalThis.fetch, now = Date.now, timeoutMs = PROBE_TIMEOUT_MS, slackMs = LATE_SLACK_MS } = {}) {
  const started = now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const body = r.ok ? await r.json() : null;
    return { verdict: probeVerdict({ ok: !!body, elapsedMs: now() - started, timeoutMs, slackMs }), body, elapsedMs: now() - started };
  } catch (error) {
    const elapsedMs = now() - started;
    return { verdict: probeVerdict({ ok: false, error, elapsedMs, timeoutMs, slackMs }), body: null, elapsedMs, error };
  }
}

// Checks until it knows: 'up' with the runner's /health answer as soon as one check answers, 'down'
// after `misses` real misses in a row, or 'unsure' when the app stalled through every one of
// `maxProbes` checks (then nothing should be started). Spoilt checks neither count nor break the run.
export async function decideRunner(probe, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), misses = MISSES, maxProbes = MAX_PROBES, gapMs = GAP_MS } = {}) {
  let inARow = 0, unsure = 0;
  for (let i = 0; i < maxProbes; i++) {
    if (i) await sleep(gapMs);
    const p = await probe();
    if (p.verdict === 'up') return { state: 'up', body: p.body, probes: i + 1, unsure };
    if (p.verdict === 'unsure') { unsure++; continue; }
    if (++inARow >= misses) return { state: 'down', probes: i + 1, unsure };
  }
  return { state: 'unsure', probes: maxProbes, unsure };
}
