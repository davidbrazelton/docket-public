// When each saved message was written, by its id (UTC ms). Claude's SDK message list leaves the time out, but every
// line of a Claude transcript file carries it as a UTC timestamp, so the times are read from the file's text here.
export function transcriptTimes(text) {
  const times = new Map();
  for (const line of String(text || '').split('\n')) {
    if (!line.includes('"timestamp"')) continue;
    try {
      const o = JSON.parse(line);
      const at = Date.parse(o.timestamp);
      if (o.uuid && at) times.set(o.uuid, at);
    } catch { /* a line that is not JSON is skipped */ }
  }
  return times;
}

// ---------- the time hooks hold a turn up (#743) ----------
// A hook runs synchronously unless its settings say async: true, and a synchronous one holds the turn up while it runs
// (a company's PreToolUse hook inside a Bash step, its UserPromptSubmit hook before the first model call). Claude says
// when each hook starts and ends (hook_started, hook_response with includeHookEvents) but not whether it was async, so
// the settings say that: an event whose every configured hook is async is left out.
// settings: the parsed settings files (and plugin hooks.json files) the session reads, in any order.
export function asyncHookEvents(settings) {
  const seen = new Map(); // event -> true while every hook seen for it is async
  for (const j of settings) {
    for (const [event, groups] of Object.entries(j?.hooks || {})) {
      for (const g of Array.isArray(groups) ? groups : []) {
        for (const h of Array.isArray(g?.hooks) ? g.hooks : []) seen.set(event, (seen.get(event) ?? true) && h?.async === true);
      }
    }
  }
  return new Set([...seen].filter(([, all]) => all).map(([e]) => e));
}

// How much of the time line [start, end) spans cover, counting overlaps once. spans: [[from, to], ...] in ms.
export function covered(spans, start = -Infinity, end = Infinity) {
  const s = spans.map(([a, b]) => [Math.max(a, start), Math.min(b, end)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, upTo = -Infinity;
  for (const [a, b] of s) { if (b <= upTo) continue; total += b - Math.max(a, upTo); upTo = b; }
  return total;
}

// A turn's time split hooks first: time a hook covers is hook time even inside a step or a model call, then the steps'
// time outside the hooks, and the rest is the model's (with Claude's own work between calls). null with no hook time,
// so a turn on a computer without hooks shows as before. hooks, tools: [[from, to], ...]; a span still open ends at end.
export function turnSplit({ start, end, hooks, tools }) {
  const open = (xs) => xs.map(([a, b]) => [a, b || end]);
  const hookMs = covered(open(hooks), start, end);
  if (!hookMs) return null;
  const toolMs = covered([...open(hooks), ...open(tools)], start, end) - hookMs;
  return { hookMs, toolMs, modelMs: Math.max(0, end - start - hookMs - toolMs) };
}
