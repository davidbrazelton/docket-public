// Session cost and usage rows. Turns a session's logs into one record per
// Claude reply (time, model, tokens by kind, dollars), then either adds them up
// for one session or groups them into per-day rows for reporting, in the same
// columns as a usage tracker's ai-usage-raw.csv.
//
// Prices come from pricing.json: periods by date (as in the tracker), per-model
// rates inside a period, family rates (opus/sonnet/haiku) for models not listed.
// They are API list prices; on a subscription this is the API value of the use.
//
// Columns the tracker has and Docket adds: PersonalCost is the API list price (Cost without
// Bedrock's regional uplift), BilledProfile the account that paid (the AWS profile for a Bedrock
// reply, else the company's Claude sign-in, read from today's settings, so ProfileInferred is 1).
// Connection is the billing connection's key from connection.mjs; BilledProfile is then its label, and
// ProfileInferred is 0 when the session recorded its connection when it started.
// Two more feed the Usage page: HypotheticalCost, every reply on pricing.json's routingBaseline model
// (an Opus; replies already on an Opus keep their own price), and CacheSaved, what the cache reads
// would have cost as plain input. Brand is which AI wrote the reply: claude, codex or grok;
// codex-usage.mjs builds its rows with dayRows below; grok-usage.mjs makes its own from Grok's usage.json.
//
// Reading the logs (lessons from the "receipts" plugin, and where it differs
// from the tracker's parser):
//  - one reply is written as several log lines that share a request id and each
//    repeat the reply's usage; they are grouped and charged once (counting every
//    line, as the tracker does, overstates cost about 2.5-3 times);
//  - a resumed session copies earlier lines into its new log; each line counts
//    once, by its uuid;
//  - cache writes are itemized as 5-minute and 1-hour and priced separately;
//  - helper agents log to <session>/subagents/*.jsonl and belong to the session;
//  - a cache expiry is a gap between replies longer than the cache that was
//    actually in use (1 hour or 5 minutes), not a fixed 5 minutes.
//
// Lessons from reconciling these estimates against an AWS bill:
//  - Bedrock logs a model as us.anthropic.claude-opus-5-5 as well as claude-opus-5-5;
//    both are the same model and price;
//  - a Bedrock reply has a msg_bdrk_ message id, whatever model name it carries. A
//    regional inference profile (us., eu., ...) bills at bedrockRegionalMultiplier
//    times the list price; a global. one bills at list;
//  - the compaction call is not in the log. Each compact_boundary is charged a cache
//    read of its preTokens plus pricing.json's compactionEstimate, on the session's
//    model, and the reply after it (which rewrites the cache) counts as compaction;
//  - workflow agents log one level down, under subagents/workflows/<run>/.
//
// Cause says what started the turn a reply is in (turnCause below): a turn runs from one message into the main log
// (not a tool result, a compact summary or a meta or local command) to the next, and its cause is read from that
// message's words. Helper agents' replies go to the main turn they ran in, by time. A report turn that called
// report_quiet (not to cancel it) is report-quiet. Replies before the first message have no cause ('').
//
// Lines added and removed come from the tool results of file edits: a user line whose toolUseResult has a
// structuredPatch (Edit, MultiEdit, a Write over a file) counts its hunks' + and - lines; a Write of a new file
// (type "create", empty patch) counts its content's lines as added. Like the replies, each line counts once by uuid.
import fs from 'node:fs';
import path from 'node:path';

// ---------- prices ----------
let priceCache = { mtime: 0, prices: null };
export function loadPrices(file) {
  const { mtimeMs } = fs.statSync(file);
  if (priceCache.prices && priceCache.mtime === mtimeMs) return priceCache.prices;
  const prices = JSON.parse(fs.readFileSync(file, 'utf8'));
  priceCache = { mtime: mtimeMs, prices };
  return prices;
}
export const pricesVersion = () => priceCache.mtime;

const localDate = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// claude-opus-5-5, us.anthropic.claude-opus-5-5 and anthropic.claude-opus-5-5-v1:0 are one model.
export const modelKey = (model) => String(model || '').replace(/^(?:[a-z]{2,6}\.)?anthropic\./, '').replace(/-v\d+(?::\d+)?$/, '');
const familyOf = (model) => (/opus/i.test(model) ? 'opus' : /sonnet/i.test(model) ? 'sonnet' : /haiku/i.test(model) ? 'haiku' : null);

// The rates for one reply: its period by date, then its model (longest id prefix, since log ids
// can carry a date suffix), then its family.
function ratesFor(prices, model, at) {
  const day = localDate(at);
  const periods = prices.pricing_periods || [];
  const period = periods.find((p) => day >= p.start_date && (!p.end_date || day <= p.end_date))
    || [...periods].sort((a, b) => (a.start_date < b.start_date ? 1 : -1))[0];
  if (!period) return null;
  let best = null;
  for (const key of Object.keys(period.models || {})) if ((model === key || model.startsWith(key + '-')) && (!best || key.length > best.length)) best = key;
  if (best) return { ...period.models[best], name: period.models[best].name || best };
  const fam = familyOf(model);
  if (fam && period.families?.[fam]) return { ...period.families[fam], name: `${fam[0].toUpperCase()}${fam.slice(1)} (family rate)` };
  return null;
}

// ---------- reading logs ----------
// Keep the larger value of each number: lines of one reply sometimes disagree on
// output tokens while it streams, and the largest is the final count.
function maxUsage(a, b) {
  if (!a) return b;
  const out = { ...a };
  for (const k of Object.keys(b)) {
    if (typeof b[k] === 'number') out[k] = Math.max(a[k] || 0, b[k]);
    else if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) out[k] = maxUsage(a[k], b[k]);
  }
  return out;
}

export function sessionLogFiles(mainFile, sessionId) {
  const files = [mainFile];
  const subDir = path.join(path.dirname(mainFile), sessionId, 'subagents');
  const add = (dir) => { try { for (const n of fs.readdirSync(dir)) if (n.endsWith('.jsonl')) files.push(path.join(dir, n)); } catch {} };
  add(subDir);
  // Workflow agents: subagents/workflows/<run>/*.jsonl
  try { for (const run of fs.readdirSync(path.join(subDir, 'workflows'))) add(path.join(subDir, 'workflows', run)); } catch {}
  return files;
}

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// Tools whose answer always comes from the person: the time from asking to the answer is wait time.
const ASK_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);

// Lines added and removed by one file edit's tool result, or null when it is not one.
export function editLines(result) {
  if (!result || typeof result !== 'object') return null;
  const hunks = Array.isArray(result.structuredPatch) ? result.structuredPatch : [];
  let added = 0, removed = 0;
  for (const h of hunks) for (const l of h?.lines || []) { if (l[0] === '+') added++; else if (l[0] === '-') removed++; }
  if (!hunks.length && result.type === 'create' && typeof result.content === 'string' && result.content) {
    added = result.content.split('\n').length - (result.content.endsWith('\n') ? 1 : 0);
  }
  return added || removed ? { added, removed } : null;
}

// What started a turn, from the words of the message that began it: a report from a session this one started
// (report), the brief a session was started with (brief), work another session sent (send), a note from Docket about
// its sessions (notice-coord) or about something else (notice), a background task's result (task), else the person.
export const CAUSES = ['person', 'brief', 'send', 'report', 'report-quiet', 'notice-coord', 'notice', 'task'];
// The coordination causes: what parent and child sessions cost each other beyond the work itself.
export const COORDINATION = ['report', 'report-quiet', 'notice-coord'];
const COORD_NOTICE = /reports to you|handed its work off|started your proposal|under this one from the portal|now reports to the session|no longer reports|moved .* under/;
export function turnCause(text) {
  const t = String(text || '');
  if (t.includes('<session-report>')) return 'report';
  if (t.includes('This session was started by the session')) return 'brief';
  if (t.includes('(Sent by the session')) return 'send';
  if (/^\s*\(From Docket:/.test(t)) return COORD_NOTICE.test(t) ? 'notice-coord' : 'notice';
  if (t.includes('<task-notification>')) return 'task';
  return 'person';
}
const messageText = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '');
// A local command (/clear, /model...) or an interruption marker: in the log as a user line, but no turn.
const notATurn = (text) => /^<(command-|local-command)/.test(text.trim()) || text.startsWith('[Request interrupted');
// The cause of a reply at time `at`: that of the last turn started at or before it.
function causeAt(causes, at) {
  let lo = 0, hi = causes.length - 1, hit = null;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (causes[mid].start <= at) { hit = causes[mid]; lo = mid + 1; } else hi = mid - 1; }
  return !hit ? '' : hit.cause === 'report' && hit.quiet ? 'report-quiet' : hit.cause;
}

// One record per Claude reply, plus the session's compactions, title, turns and waits on the person.
// turns: each message sent (or task notification) to the last reply or tool result before the next one, from the
// main log only, so a helper agent's work counts inside its parent's turn. waits: a question form or plan approval,
// asked to answered. edits: { at, added, removed } per file edit, from every log (helper agents' too).
export function readSession(files) {
  const seen = new Set();
  const replies = new Map(); // request id -> reply
  const compactions = [];
  const turns = [], waits = [], asked = new Map(), userSeen = new Set();
  const edits = [], editSeen = new Set();
  const causes = []; // { start, cause, quiet }: each turn's cause
  let title = '', turn = null, causeTurn = null;
  files.forEach((file, fileIndex) => {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
    for (const line of text.split('\n')) {
      if (!line) continue;
      if (line.includes('"toolUseResult"') && (line.includes('"structuredPatch"') || line.includes('"create"'))) {
        let e; try { e = JSON.parse(line); } catch { e = null; }
        const n = e?.type === 'user' && !(e.uuid && editSeen.has(e.uuid)) ? editLines(e.toolUseResult) : null;
        if (n) { if (e.uuid) editSeen.add(e.uuid); edits.push({ at: Date.parse(e.timestamp) || 0, ...n }); }
      }
      if (fileIndex === 0 && line.includes('"type":"user"')) {
        let e; try { e = JSON.parse(line); } catch { continue; }
        const at = Date.parse(e.timestamp) || 0;
        if (e.type !== 'user' || e.isSidechain || !at || (e.uuid && userSeen.has(e.uuid))) continue;
        if (e.uuid) userSeen.add(e.uuid);
        const content = e.message?.content;
        const results = Array.isArray(content) ? content.filter((b) => b.type === 'tool_result') : [];
        if (results.length) {
          if (turn) turn.end = Math.max(turn.end, at);
          for (const b of results) if (asked.has(b.tool_use_id)) { waits.push([asked.get(b.tool_use_id), at]); asked.delete(b.tool_use_id); }
        } else if (!e.isCompactSummary) {
          turn = { start: at, end: at }; turns.push(turn);
          const text = messageText(content);
          if (!e.isMeta && !notATurn(text)) { causeTurn = { start: at, cause: turnCause(text), quiet: false }; causes.push(causeTurn); }
        }
        continue;
      }
      if (fileIndex === 0 && (line.includes('"custom-title"') || line.includes('"compact_boundary"'))) {
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'custom-title' && e.customTitle) title = e.customTitle;
        if (e.subtype === 'compact_boundary' && e.timestamp) compactions.push({ at: Date.parse(e.timestamp), preTokens: e.compactMetadata?.preTokens || 0 });
        continue;
      }
      if (!line.includes('"assistant"') || !line.includes('"usage"')) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.type !== 'assistant' || !e.message?.usage) continue;
      if (fileIndex === 0 && !e.isSidechain && !(e.uuid && seen.has(e.uuid))) {
        const at = Date.parse(e.timestamp) || 0;
        if (turn && at) turn.end = Math.max(turn.end, at);
        for (const b of e.message.content || []) {
          if (b.type === 'tool_use' && ASK_TOOLS.has(b.name) && at) asked.set(b.id, at);
          if (b.type === 'tool_use' && /(^|__)report_quiet$/.test(b.name || '') && !b.input?.cancel && causeTurn) causeTurn.quiet = true;
        }
      }
      const rawModel = e.message.model || '';
      if (!rawModel || rawModel.startsWith('<')) continue; // "<synthetic>" lines are not API calls
      const model = modelKey(rawModel);
      if (e.uuid) { if (seen.has(e.uuid)) continue; seen.add(e.uuid); }
      const key = e.requestId || e.message.id || e.uuid;
      const r = replies.get(key) || { key, model, at: Date.parse(e.timestamp) || 0, subagent: fileIndex > 0 || !!e.isSidechain, usage: null, tools: new Map(),
        bedrock: /^msg_bdrk/.test(e.message.id || ''), global: false };
      if (rawModel.startsWith('global.')) r.global = true;
      r.usage = maxUsage(r.usage, e.message.usage);
      for (const b of e.message.content || []) if (b.type === 'tool_use' && b.id) r.tools.set(b.id, { name: b.name, file: FILE_TOOLS.has(b.name) ? b.input?.file_path || b.input?.notebook_path || null : null });
      replies.set(key, r);
    }
  });
  const sorted = [...replies.values()].sort((a, b) => a.at - b.at);
  causes.sort((a, b) => a.start - b.start);
  for (const r of sorted) r.cause = causeAt(causes, r.at);
  return { replies: sorted, compactions, title, turns: turns.filter((t) => t.end > t.start), waits, edits, causes };
}

// ---------- time ----------
// Agent and wait seconds per day from a session's turns ({ start, end }) and its waits on the person ([start, end], from
// the log and from Docket's own record of each prompt it showed). Overlapping waits count once, and only inside a turn;
// a turn's agent time is its length less its waits. A stretch over midnight is split between the two days.
function mergeSpans(spans) {
  const out = [];
  for (const [a, b] of spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}
function addByDay(out, key, a, b) {
  while (a < b) {
    const midnight = new Date(a); midnight.setHours(24, 0, 0, 0);
    const end = Math.min(b, midnight.getTime());
    (out[localDate(a)] ||= { agent: 0, wait: 0 })[key] += (end - a) / 1000;
    a = end;
  }
}
export function timeByDay(turns, waits = []) {
  const out = {};
  const held = mergeSpans(waits);
  for (const [a, b] of mergeSpans(turns.map((t) => [t.start, t.end]))) {
    let cur = a;
    for (const [wa, wb] of held) {
      if (wb <= a || wa >= b) continue;
      const s = Math.max(a, wa), e = Math.min(b, wb);
      addByDay(out, 'agent', cur, s); addByDay(out, 'wait', s, e); cur = e;
    }
    addByDay(out, 'agent', cur, b);
  }
  return out;
}
// A row with no use on it, for a day that only has time on it.
export const emptyRow = (from, day) => ({ ...from, Date: day, Source: 'main', Turns: 0, Agents: 0, CacheExpiry: 0, Compacting: 0, ToolCalls: 0, FilesTouched: 0,
  AvgTokensPerTurn: 0, InputTokens: 0, OutputTokens: 0, CacheRead: 0, CacheCreate: 0, CacheCreate1h: 0, Cost: 0, PersonalCost: 0, HypotheticalCost: 0, CacheSaved: 0,
  AgentSeconds: 0, WaitSeconds: 0, UserSeconds: 0, LinesAdded: 0, LinesRemoved: 0, Cause: '' });
// Each day's seconds (or lines) (key: AgentSeconds, WaitSeconds or UserSeconds) go on that day's first row, as Compacting does, so
// adding up any set of rows counts them once. A day with time but no row gets an empty row of its own to carry it.
export function addSeconds(rows, key, byDay) {
  const first = new Map();
  for (const r of rows) { r[key] = 0; if (!first.has(r.Date)) first.set(r.Date, r); }
  for (const [day, n] of Object.entries(byDay)) {
    const secs = Math.round(n);
    if (secs < 1) continue;
    if (first.has(day)) first.get(day)[key] = secs;
    else if (rows.length) { const r = emptyRow(rows[0], day); r[key] = secs; rows.push(r); first.set(day, r); }
  }
  return rows.sort((a, b) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0));
}

// Tokens by kind and dollars for one reply.
export function priceReply(r, prices) {
  const u = r.usage;
  const cc = u.cache_creation || null;
  const tokens = {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheWrite1h: cc ? cc.ephemeral_1h_input_tokens || 0 : 0,
    cacheWrite5m: cc ? cc.ephemeral_5m_input_tokens || 0 : u.cache_creation_input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
  };
  const searches = u.server_tool_use?.web_search_requests || 0;
  const p = ratesFor(prices, r.model, r.at);
  if (!p) return { ...r, tokens, searches, cost: null, priced: false };
  const prompt = tokens.input + tokens.cacheWrite1h + tokens.cacheWrite5m + tokens.cacheRead;
  const rate = p.longPromptOver && prompt > p.longPromptOver ? { ...p, ...p.longPrompt } : p;
  // Bedrock's regional profiles bill above list. Like fast mode it scales every part, so it is folded into the same factor.
  const regional = r.bedrock && !r.global ? prices.bedrockRegionalMultiplier || 1 : 1;
  const fast = (u.speed === 'fast' ? p.fastMultiplier || 1 : 1) * regional;
  const parts = {
    input: tokens.input * rate.input / 1e6 * fast,
    output: tokens.output * rate.output / 1e6 * fast,
    cacheWrite1h: tokens.cacheWrite1h * (rate.cacheWrite1h ?? rate.cacheWrite5m) / 1e6 * fast,
    cacheWrite5m: tokens.cacheWrite5m * rate.cacheWrite5m / 1e6 * fast,
    cacheRead: tokens.cacheRead * rate.cacheRead / 1e6 * fast,
    webSearch: searches * (prices.webSearchPerRequest || 0),
  };
  const cost = Object.values(parts).reduce((a, b) => a + b, 0);
  return { ...r, tokens, searches, parts, cost, listCost: parts.webSearch + (cost - parts.webSearch) / regional,
    cacheSaved: tokens.cacheRead * (rate.input - rate.cacheRead) / 1e6 * fast,
    priced: true, fast: u.speed === 'fast' && (p.fastMultiplier || 1) > 1, regional: regional > 1, modelName: p.name };
}
// The same reply on the routing baseline (an Opus): what it would have cost with no cheaper model.
const baselineOf = (prices) => prices.routingBaseline || 'claude-opus';
function hypothetical(r, prices) {
  if (!r.priced) return 0;
  if (familyOf(r.model) === 'opus' || (r.brand && r.brand !== 'claude')) return r.cost; // another brand has no Opus to compare with
  return priceReply({ ...r, model: baselineOf(prices) }, prices).cost || 0;
}
// A friendly name for a model id ("claude-opus-5-5" is "Opus 5.5"), from pricing.json.
export const modelName = (prices, model, at = Date.now()) => ratesFor(prices, modelKey(model), at)?.name || model;
export const modelRates = (prices, model, at = Date.now()) => ratesFor(prices, modelKey(model), at);

// Rows kept from before these columns existed (sessions whose logs are gone) get them from their token
// totals: close, but without fast mode, Bedrock rates, long-prompt rates or web searches.
export function fillRow(row, prices) {
  if (row.HypotheticalCost !== undefined) return row;
  const at = Date.parse(row.Date + 'T12:00:00');
  const price = (model) => {
    const p = ratesFor(prices, model, at);
    if (!p) return 0;
    const w5 = (row.CacheCreate || 0) - (row.CacheCreate1h || 0);
    return ((row.InputTokens || 0) * p.input + (row.OutputTokens || 0) * p.output + (row.CacheRead || 0) * p.cacheRead
      + w5 * p.cacheWrite5m + (row.CacheCreate1h || 0) * (p.cacheWrite1h ?? p.cacheWrite5m)) / 1e6;
  };
  const p = ratesFor(prices, row.Model, at);
  const round = (n) => Math.round(n * 10000) / 10000;
  return { ...row, PersonalCost: row.PersonalCost ?? row.Cost,
    HypotheticalCost: familyOf(row.Model) === 'opus' ? row.Cost : round(price(baselineOf(prices))),
    CacheSaved: p ? round((row.CacheRead || 0) * (p.input - p.cacheRead) / 1e6) : 0 };
}

// Cache expiries: main-session replies further apart than the cache in use.
function markCacheExpiries(priced) {
  let ttl = 300, prev = null;
  for (const r of priced) {
    if (r.subagent || r.estimate) continue;
    if (prev && r.at - prev.at > ttl * 1000) r.cacheExpired = true;
    if (r.tokens.cacheWrite1h > 0) ttl = 3600; else if (r.tokens.cacheWrite5m > 0) ttl = 300;
    prev = r;
  }
}

// ---------- compactions ----------
// The compaction call itself is not logged: add an estimated reply for each one, on the model of the last
// main reply before it, and count the reply after it (the cache rebuilt from the summary) as compaction too.
function addCompactions(replies, compactions, prices) {
  const est = prices.compactionEstimate;
  if (!est || !compactions.length) return replies;
  const main = replies.filter((r) => !r.subagent);
  const out = [...replies];
  for (const c of compactions) {
    const before = [...main].reverse().find((r) => r.at <= c.at) || main.find((r) => r.at > c.at);
    if (!before) continue;
    const after = main.find((r) => r.at > c.at);
    if (after) after.compaction = true;
    out.push({ key: `compact:${c.at}`, model: before.model, at: c.at, subagent: false, cause: (after || before).cause || '', tools: new Map(), bedrock: before.bedrock, global: before.global, compaction: true, estimate: true,
      usage: { input_tokens: est.input || 0, output_tokens: est.output || 0, cache_read_input_tokens: c.preTokens,
        cache_creation: { ephemeral_1h_input_tokens: est.cacheWrite1h || 0, ephemeral_5m_input_tokens: 0 } } });
  }
  return out.sort((a, b) => a.at - b.at);
}

// ---------- one session's total ----------
export function summarize(priced) {
  const zero = () => ({ input: 0, output: 0, cacheWrite1h: 0, cacheWrite5m: 0, cacheRead: 0, webSearch: 0 });
  const real = priced.filter((r) => !r.estimate);
  const out = { cost: 0, replies: real.length, tokens: zero(), dollars: zero(), byModel: {}, main: 0, subagents: 0, compaction: 0, regional: false, unpricedModels: [],
    first: real[0]?.at || null, last: real[real.length - 1]?.at || null };
  for (const r of priced) {
    if (r.compaction && r.priced) out.compaction += r.cost;
    if (r.regional) out.regional = true;
    for (const k of Object.keys(r.tokens)) out.tokens[k] += r.tokens[k];
    out.tokens.webSearch += r.searches;
    if (!r.priced) { if (!out.unpricedModels.includes(r.model)) out.unpricedModels.push(r.model); continue; }
    out.cost += r.cost;
    for (const k of Object.keys(r.parts)) out.dollars[k] += r.parts[k];
    const m = (out.byModel[r.model] ||= { name: r.modelName, replies: 0, cost: 0 });
    if (!r.estimate) m.replies++;
    m.cost += r.cost;
    if (r.subagent) out.subagents += r.cost; else out.main += r.cost;
  }
  return out;
}

// ---------- per-day rows, in the tracker's columns ----------
export const CSV_COLUMNS = ['Client', 'Group', 'SessionId', 'Date', 'Title', 'Source', 'Model', 'Turns', 'Agents', 'CacheExpiry', 'Compacting', 'ToolCalls', 'FilesTouched',
  'AvgTokensPerTurn', 'InputTokens', 'OutputTokens', 'CacheRead', 'CacheCreate', 'CacheCreate1h', 'Cost', 'PersonalCost', 'BilledProfile', 'ProfileInferred',
  'HypotheticalCost', 'CacheSaved', 'Brand', 'AgentSeconds', 'WaitSeconds', 'UserSeconds', 'LinesAdded', 'LinesRemoved', 'Connection', 'Cause'];
// billed: { subscription, bedrock, bedrockKnown } names the account each kind of reply was paid by; with
// connection / bedrockConnection (connection.mjs) the row gets its key in Connection and its label in BilledProfile.
// A connection recorded on the session when it started (recorded: true) is not inferred; one read from today's setup is.
// A session through a LiteLLM gateway has the gateway as both connections, and models (below) to price its names.
// times: { turns, waits } for the agent and wait seconds; without it they are 0.
// edits: { at, added, removed } per file edit; each day's lines go on its first row, as the seconds do.
function billedColumns(bedrock, billed) {
  const conn = bedrock ? billed.bedrockConnection : billed.connection;
  if (conn) return { BilledProfile: conn.label || '', ProfileInferred: conn.recorded ? 0 : 1, Connection: conn.key || '' };
  return { BilledProfile: (bedrock ? billed.bedrock : billed.subscription) || '', ProfileInferred: bedrock && billed.bedrockKnown ? 0 : 1, Connection: '' };
}
export function dayRows(client, sessionId, title, priced, compactions, agentCount, prices, billed = {}, times = null, edits = []) {
  const groups = new Map(); // date|source|model -> row
  const compactsByDay = {};
  for (const c of compactions) compactsByDay[localDate(c.at)] = (compactsByDay[localDate(c.at)] || 0) + 1;
  const toolsByDay = {}, filesByDay = {}, expiriesByDay = {};
  for (const r of priced) {
    const day = localDate(r.at), source = r.subagent ? 'agent' : r.compaction ? 'compact' : 'main';
    const key = `${day}|${source}|${r.model}|${r.bedrock ? 'bedrock' : r.brand || 'claude'}|${r.cause || ''}`;
    const g = groups.get(key) || { Client: client, SessionId: sessionId, Date: day, Title: (title || '(untitled)').slice(0, 60), Source: source, Model: r.model,
      Turns: 0, Agents: 0, CacheExpiry: 0, Compacting: 0, ToolCalls: 0, FilesTouched: 0, AvgTokensPerTurn: 0,
      InputTokens: 0, OutputTokens: 0, CacheRead: 0, CacheCreate: 0, CacheCreate1h: 0, Cost: 0, PersonalCost: 0,
      ...billedColumns(r.bedrock, billed),
      HypotheticalCost: 0, CacheSaved: 0, Brand: r.brand || 'claude', AgentSeconds: 0, WaitSeconds: 0, UserSeconds: 0, LinesAdded: 0, LinesRemoved: 0, Cause: r.cause || '', _files: new Set() };
    if (!r.estimate) g.Turns++;
    g.InputTokens += r.tokens.input; g.OutputTokens += r.tokens.output; g.CacheRead += r.tokens.cacheRead;
    g.CacheCreate += r.tokens.cacheWrite5m + r.tokens.cacheWrite1h; g.CacheCreate1h += r.tokens.cacheWrite1h;
    g.Cost += r.cost || 0;
    g.PersonalCost += r.listCost || 0;
    g.HypotheticalCost += hypothetical(r, prices);
    g.CacheSaved += r.cacheSaved || 0;
    if (r.cacheExpired) g.CacheExpiry++;
    g.ToolCalls += r.tools.size;
    for (const t of r.tools.values()) if (t.file) g._files.add(t.file);
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((a, b) => (a.Date + a.Source + a.Model + a.Cause < b.Date + b.Source + b.Model + b.Cause ? -1 : 1));
  // Per-day and per-session counts go on one row each, so adding up the CSV counts them once.
  const daysDone = new Set();
  for (const g of rows) {
    g.FilesTouched = g._files.size; delete g._files;
    if (!daysDone.has(g.Date)) { daysDone.add(g.Date); g.Compacting = compactsByDay[g.Date] || 0; }
    g.AvgTokensPerTurn = g.Turns ? Math.round((g.InputTokens + g.OutputTokens + g.CacheRead + g.CacheCreate) / g.Turns) : 0;
    for (const k of ['Cost', 'PersonalCost', 'HypotheticalCost', 'CacheSaved']) g[k] = Math.round(g[k] * 10000) / 10000;
  }
  if (rows.length) rows[0].Agents = agentCount;
  const byDay = Object.entries(times ? timeByDay(times.turns || [], times.waits || []) : {});
  addSeconds(rows, 'AgentSeconds', Object.fromEntries(byDay.map(([d, t]) => [d, t.agent])));
  addSeconds(rows, 'WaitSeconds', Object.fromEntries(byDay.map(([d, t]) => [d, t.wait])));
  const added = {}, removed = {};
  for (const e of edits) { if (!e.at) continue; const d = localDate(e.at); added[d] = (added[d] || 0) + e.added; removed[d] = (removed[d] || 0) + e.removed; }
  addSeconds(rows, 'LinesAdded', added);
  return addSeconds(rows, 'LinesRemoved', removed);
}

// ---------- reading a session once, for both uses, cached until a log file or the prices change ----------
const sessionCache = new Map(); // main file -> { sig, data }
// models: a gateway's model names -> the gear model ids they stand for, so they are priced as those.
function analyse(mainFile, sessionId, pricingFile, models = null) {
  const files = sessionLogFiles(mainFile, sessionId);
  const prices = loadPrices(pricingFile);
  const sig = sessionSignature(mainFile, sessionId, pricingFile) + (models ? JSON.stringify(models) : '');
  const hit = sessionCache.get(mainFile);
  if (hit && hit.sig === sig) return hit.data;
  const { replies, compactions, title, turns, waits, edits } = readSession(files);
  if (models) for (const r of replies) r.model = models[r.model] || r.model;
  const priced = addCompactions(replies, compactions, prices).map((r) => priceReply(r, prices));
  markCacheExpiries(priced);
  const data = { sig, priced, compactions, title, turns, waits, edits, agentCount: files.length - 1 };
  sessionCache.set(mainFile, { sig, data });
  return data;
}
// ROWS_VERSION changes when the rows gain columns, so every session that still has a log is read again once.
const ROWS_VERSION = 5; // 3: agent and wait seconds; 4: lines added and removed; 5: cause
export function sessionSignature(mainFile, sessionId, pricingFile) {
  loadPrices(pricingFile);
  return sessionLogFiles(mainFile, sessionId).map((f) => { try { return fs.statSync(f).size; } catch { return 0; } }).join(',') + '|' + priceCache.mtime + '|v' + ROWS_VERSION;
}

export function sessionCost(mainFile, sessionId, pricingFile) {
  const d = analyse(mainFile, sessionId, pricingFile);
  const s = summarize(d.priced);
  return { ...s, subagentFiles: d.agentCount, cacheExpiries: d.priced.filter((r) => r.cacheExpired).length, compactions: d.compactions.length, pricesAsOf: loadPrices(pricingFile).about,
    lines: editTotals(d.edits, d.priced.length > 0) };
}
// The session's lines added and removed, counted as its rows count them (dayRows): edits with a time, and only
// when the session has rows to carry them; so the details panel shows the same total as the Usage page.
export function editTotals(edits, hasRows = true) {
  const out = { added: 0, removed: 0 };
  if (hasRows) for (const e of edits) if (e.at) { out.added += e.added; out.removed += e.removed; }
  return out;
}
// The same total from a session's rows, for the brands whose rows are made elsewhere (Codex, Grok).
export const rowLines = (rows) => ({ added: rows.reduce((a, r) => a + (r.LinesAdded || 0), 0), removed: rows.reduce((a, r) => a + (r.LinesRemoved || 0), 0) });

// appWaits: [start, end] of each prompt Docket showed this session (a permission, a question form, a plan), kept by the app.
export function sessionRows(client, mainFile, sessionId, pricingFile, title, billed, appWaits = []) {
  const d = analyse(mainFile, sessionId, pricingFile, billed?.models && Object.keys(billed.models).length ? billed.models : null);
  return dayRows(client, sessionId, title || d.title, d.priced, d.compactions, d.agentCount, loadPrices(pricingFile), billed,
    { turns: d.turns, waits: [...d.waits, ...appWaits] }, d.edits);
}

// ---------- the CSV ----------
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function writeCsv(file, rows) {
  const text = [CSV_COLUMNS.join(','), ...rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
