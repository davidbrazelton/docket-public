// Grok session usage: turns a company's Grok session folders into the same per-day rows costs.mjs makes from
// Claude logs (CSV_COLUMNS), with Brand 'grok'.
//
// Where Grok keeps it (Grok 1.0.41, checked 2026-10-27 on 16 sessions in two Grok homes):
//  - <grok home>/sessions/<folder, URL-encoded>/<session id>/usage.json holds one entry per turn: when it ended, and per
//    model the tokens (inputTokens counts cached reads too; outputTokens counts reasoning too), the number of model calls,
//    and costUsdTicks, Grok's own price for the turn in ten-billionths of a dollar. The turns add up to the session total.
//    The same numbers reach Docket over ACP in each turn_completed update (updates.jsonl keeps them too).
//  - Grok's price includes what token rates alone miss: $0.005 per server-side tool call (web search) and the higher
//    rate of a call over the long-context line. So Cost is Grok's own figure, not a recount from pricing.json.
//  - xAI has no cache writes (cacheCreationTokens is always 0) and no cache that expires on a timer Docket can see, so
//    CacheCreate and CacheExpiry stay 0. Every turn in events.jsonl is "primary": no helper agents seen, so no 'agent' rows.
//  - Each auto-compaction leaves one file in compaction_checkpoints/; it is counted on its day (Compacting). Its cost
//    is not reported apart from the turn it happened in, so there are no 'compact' rows.
//  - Lines added and removed stay 0: usage.json and events.jsonl hold no diffs (events.jsonl names each tool
//    call, not what it changed), so Grok's edits are not counted.
//  - On a grok.com sign-in (not an API key) the work is covered by the Grok plan, so like a Claude subscription the
//    cost is what the same use would cost on the API.
import fs from 'node:fs';
import path from 'node:path';
import { loadPrices, pricesVersion, modelRates } from './costs.mjs';

const TICKS_PER_DOLLAR = 1e10;
const localDate = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Every Grok session folder in a Grok home: Grok session id -> folder.
export function grokSessionDirs(home) {
  const map = new Map();
  const root = path.join(home, 'sessions');
  let folders = [];
  try { folders = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return map; }
  for (const f of folders) {
    let ids = [];
    try { ids = fs.readdirSync(path.join(root, f.name), { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { continue; }
    for (const d of ids) {
      const dir = path.join(root, f.name, d.name);
      if (fs.existsSync(path.join(dir, 'usage.json'))) map.set(d.name, dir);
    }
  }
  return map;
}

// The title Grok gave a session, for sessions Docket did not start.
export function grokTitle(dir) {
  try { const s = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8')); return s.generated_title || s.session_summary || ''; } catch { return ''; }
}

// Who the Grok home is signed in as, from auth.json (only the name or email is read; the keys stay where they are).
export function grokAccount(home) {
  try {
    const a = Object.values(JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')))[0] || {};
    return a.email || (a.first_name ? `${a.first_name} (Grok)` : '');
  } catch { return ''; }
}

const ROWS_VERSION = 2; // 2: lines added and removed, always 0
export function grokSignature(dirs, pricingFile) {
  loadPrices(pricingFile);
  return dirs.map((d) => {
    let s = 0, c = 0;
    try { s = fs.statSync(path.join(d, 'usage.json')).size; } catch {}
    try { c = fs.readdirSync(path.join(d, 'compaction_checkpoints')).length; } catch {}
    return `${s}.${c}`;
  }).join(',') + '|' + pricesVersion() + '|g' + ROWS_VERSION;
}

// One record per turn and model.
function readTurns(dir) {
  let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8')); } catch { return []; }
  const out = [];
  for (const t of j.turns || []) {
    const at = Date.parse(t.endedAt) || 0;
    const byModel = t.modelUsage && Object.keys(t.modelUsage).length ? t.modelUsage : (t.primaryModelId ? { [t.primaryModelId]: t } : {});
    for (const [model, u] of Object.entries(byModel)) {
      if (!u.modelCalls && !u.costUsdTicks) continue;
      const cached = u.cachedReadTokens || 0;
      out.push({ at, model, calls: u.modelCalls || 0, input: Math.max(0, (u.inputTokens || 0) - cached), cacheRead: cached,
        output: u.outputTokens || 0, cost: (u.costUsdTicks || 0) / TICKS_PER_DOLLAR });
    }
  }
  return out;
}
// Tool calls per day, from events.jsonl's tool_started lines.
function toolsByDay(dir) {
  const out = {};
  let text = ''; try { text = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8'); } catch { return out; }
  for (const line of text.split('\n')) {
    if (!line.includes('"tool_started"')) continue;
    const ts = line.match(/"ts":"([^"]+)"/);
    if (ts) { const d = localDate(Date.parse(ts[1])); out[d] = (out[d] || 0) + 1; }
  }
  return out;
}
function compactionsByDay(dir) {
  const out = {};
  const cdir = path.join(dir, 'compaction_checkpoints');
  let names = []; try { names = fs.readdirSync(cdir); } catch { return out; }
  for (const n of names) { try { const d = localDate(fs.statSync(path.join(cdir, n)).mtimeMs); out[d] = (out[d] || 0) + 1; } catch {} }
  return out;
}

// The per-day rows for one Docket session (or one Grok session Docket did not start). A Docket session that started
// Grok more than once (Grok cannot pick up an earlier conversation yet) has several folders; their rows are added up.
// billed: the account's label, or { connection } from connection.mjs.
export function grokRows(client, sessionId, dirs, pricingFile, title, billed) {
  const prices = loadPrices(pricingFile);
  const conn = typeof billed === 'object' && billed ? billed.connection : null;
  const who = conn ? { BilledProfile: conn.label || '', ProfileInferred: conn.recorded ? 0 : 1, Connection: conn.key || '' } : { BilledProfile: billed || '', ProfileInferred: 1, Connection: '' };
  const groups = new Map(), tools = {}, compacts = {};
  for (const dir of dirs) {
    for (const [d, n] of Object.entries(toolsByDay(dir))) tools[d] = (tools[d] || 0) + n;
    for (const [d, n] of Object.entries(compactionsByDay(dir))) compacts[d] = (compacts[d] || 0) + n;
    for (const t of readTurns(dir)) {
      const day = localDate(t.at), key = `${day}|${t.model}`;
      const g = groups.get(key) || { Client: client, SessionId: sessionId, Date: day, Title: (title || '(untitled)').slice(0, 60), Source: 'main', Model: t.model,
        Turns: 0, Agents: 0, CacheExpiry: 0, Compacting: 0, ToolCalls: 0, FilesTouched: 0, AvgTokensPerTurn: 0,
        InputTokens: 0, OutputTokens: 0, CacheRead: 0, CacheCreate: 0, CacheCreate1h: 0, Cost: 0, PersonalCost: 0,
        ...who, HypotheticalCost: 0, CacheSaved: 0, Brand: 'grok',
        AgentSeconds: 0, WaitSeconds: 0, UserSeconds: 0, LinesAdded: 0, LinesRemoved: 0 }; // Grok's usage.json has when each turn ended, not when it started
      g.Turns += t.calls; g.InputTokens += t.input; g.OutputTokens += t.output; g.CacheRead += t.cacheRead; g.Cost += t.cost;
      const r = modelRates(prices, t.model, t.at);
      if (r) g.CacheSaved += t.cacheRead * (r.input - r.cacheRead) / 1e6;
      groups.set(key, g);
    }
  }
  const rows = [...groups.values()].sort((a, b) => (a.Date + a.Model < b.Date + b.Model ? -1 : 1));
  const daysDone = new Set();
  for (const g of rows) {
    if (!daysDone.has(g.Date)) { daysDone.add(g.Date); g.Compacting = compacts[g.Date] || 0; g.ToolCalls = tools[g.Date] || 0; }
    g.AvgTokensPerTurn = g.Turns ? Math.round((g.InputTokens + g.OutputTokens + g.CacheRead) / g.Turns) : 0;
    // Grok's own price is the list price; there is no Opus routing comparison for Grok work, so it is its own hypothetical.
    for (const k of ['Cost', 'CacheSaved']) g[k] = Math.round(g[k] * 10000) / 10000;
    g.PersonalCost = g.Cost; g.HypotheticalCost = g.Cost;
  }
  return rows;
}
