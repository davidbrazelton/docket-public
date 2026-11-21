// Spend by step (#1094): which tool calls a session's money went on, from the priced replies costs.mjs already makes.
// No model call: arithmetic over the logs, cached with them (costs.mjs analyse).
//
// The rule. A step is one tool call. It is charged the whole of the model call that read its result: the result's new
// tokens (input and cache writes), the re-read of the conversation so far (cache reads) and what that call wrote back,
// since every tool call costs one more round trip. When one call read several results (tools run side by side), its new
// tokens are split by the results' sizes and the rest evenly. A helper agent (Agent, Task, a workflow's agents) is one
// step: every call in its log is charged to the Agent call that started it (by its .meta.json), as is the call that
// read its answer. Asked is the output of the call that made the step, split over the calls it made; it is shown apart
// and not added in, since that call is charged to whatever it read.
// What is not tied to a step: the first call of each turn (it reads a message, not a tool result) and compactions.
// So a session's steps and those add up to its total.
import { analyse, localDate } from './costs.mjs';

export const TURN_START = '(start of turn)', COMPACTION = '(compaction)';
export const NO_STEP = [TURN_START, COMPACTION];
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
// Commands whose second word says what they do (git diff, gh pr, npm test).
const TWO_WORD = new Set(['git', 'gh', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno', 'docker', 'cargo', 'go', 'dotnet', 'kubectl', 'helm', 'terraform',
  'az', 'aws', 'gcloud', 'winget', 'brew', 'pip', 'pip3', 'uv', 'claude']);
// Skipped: a segment that only moves or sets things, or opens a loop (its body is the next segment, after "do").
const SKIP_CMD = new Set(['cd', 'export', 'set', 'pushd', 'popd', 'Set-Location', 'source', '.', 'for', 'while', 'until', 'if', 'elif', 'case', 'done', 'fi', 'esac']);
const PREFIX = new Set(['sudo', 'time', 'env', 'nohup', 'command', 'exec', '&', 'do', 'then', 'else', '{', '(']);
const FLAG_ARG = new Set(['-C', '-c', '-R', '--repo', '--prefix', '--git-dir', '--work-tree']);
// Commands that are often only a label before the real one (echo ---; git log): used only when nothing follows.
const WEAK = new Set(['echo', 'printf', 'Write-Output', 'Write-Host', 'true', ':', 'sleep']);

// What kind of command a Bash or PowerShell call ran, in a word or two: "git diff", "gh pr", "npm test", "node", "sed".
// Leading cd, exports and VAR=value are skipped, and so is the inside of $(...).
export function commandKind(command) {
  let cmd = String(command || '');
  for (let i = 0; i < 5 && /\$\([^()]*\)|`[^`]*`/.test(cmd); i++) cmd = cmd.replace(/\$\([^()]*\)|`[^`]*`/g, 'X');
  let weak = '';
  for (const seg of cmd.split(/&&|\|\||;|\||\n/)) {
    const words = seg.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < words.length && (/^[A-Za-z_]\w*=/.test(words[i]) || /^\$env:\w+=/i.test(words[i]) || PREFIX.has(words[i]))) i++;
    if (i >= words.length) continue;
    const first = words[i].replace(/^["'(]+|["')]+$/g, '').split(/[\\/]/).pop().replace(/\.(exe|cmd|bat)$/i, '');
    if (!first || SKIP_CMD.has(first)) continue;
    if (WEAK.has(first)) { weak ||= first; continue; }
    if (TWO_WORD.has(first)) {
      let j = i + 1;
      while (j < words.length && words[j].startsWith('-')) j += FLAG_ARG.has(words[j]) ? 2 : 1;
      if (j < words.length && /^[a-z][\w:-]*$/.test(words[j])) return `${first} ${words[j]}`;
    }
    if (/^python[\d.]*$|^py$/.test(first) && words[i + 1] === '-m' && words[i + 2]) return `${first} -m ${words[i + 2]}`;
    return first;
  }
  return weak;
}
// A step's detail, which the views group by: a shell command's kind, an agent's kind; nothing for other tools.
const detailOf = (t) => (SHELL_TOOLS.has(t.name) ? commandKind(t.brief) : AGENT_TOOLS.has(t.name) ? t.type || 'general-purpose' : '');
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 160);
// A step's label: its brief on one line; a shell command without the cd it starts with.
const labelOf = (t) => oneLine(SHELL_TOOLS.has(t.name) ? String(t.brief || '').replace(/^\s*(?:cd|Set-Location)\s+("[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, '') : t.brief);

// The steps of one session's priced replies (costs.mjs priceReplies) and the helper agents' logs (readSession's
// agentFiles). Returns { steps: [{ id, at, tool, detail, label, cost, chars, asked, inner }], loose: [{ at, tool, cost }] }:
// loose is what is not tied to a step, one entry per call.
export function attributeSteps(priced, agentFiles = []) {
  const calls = new Map(); // tool use id -> step
  for (const r of priced) for (const [id, t] of r.tools || []) {
    if (!calls.has(id)) calls.set(id, { id, at: r.at, tool: t.name, detail: detailOf(t), label: labelOf(t), cost: 0, chars: 0, asked: 0, inner: 0, fileIndex: r.fileIndex || 0, sidechain: !!r.sidechain });
  }
  for (const r of priced) if (r.priced && r.tools?.size) { const each = (r.parts.output || 0) / r.tools.size; for (const id of r.tools.keys()) calls.get(id).asked += each; }
  // A helper agent's log with no Agent call to tie it to (an old log with no .meta.json): one step of its own.
  const own = new Map();
  const ownStep = (key, info, at) => {
    if (!own.has(key)) {
      const s = { id: `agent:${key}`, at, tool: info?.workflow ? 'Workflow agent' : 'Agent', detail: info?.type || 'general-purpose', label: oneLine(info?.description) || 'helper agent', cost: 0, chars: 0, asked: 0, inner: 0, fileIndex: 0 };
      own.set(key, s); calls.set(s.id, s);
    }
    return own.get(key);
  };
  // The step a log's calls belong to: the Agent call that started it, followed up to the session's own log.
  const ownerOf = (fileIndex, sidechain, at, depth = 0) => {
    if (fileIndex > 0) {
      const info = agentFiles[fileIndex], c = info?.toolUseId && calls.get(info.toolUseId);
      return c ? topOf(c, depth + 1) : ownStep(fileIndex, info, at);
    }
    return sidechain ? ownStep('sidechain', null, at) : null;
  };
  const topOf = (c, depth = 0) => (depth > 8 ? c : ownerOf(c.fileIndex, c.sidechain, c.at, depth) || c);
  const loose = [];
  for (const r of priced) {
    if (!r.priced) continue;
    if (r.compaction) { loose.push({ at: r.at, tool: COMPACTION, cost: r.cost }); continue; }
    const owner = r.subagent ? ownerOf(r.fileIndex || 0, r.sidechain, r.at) : null;
    if (owner) { owner.cost += r.cost; owner.inner += r.cost; continue; }
    const reads = (r.reads || []).filter((x) => calls.has(x.id));
    if (!reads.length) { loose.push({ at: r.at, tool: TURN_START, cost: r.cost }); continue; }
    const fresh = (r.parts.input || 0) + (r.parts.cacheWrite1h || 0) + (r.parts.cacheWrite5m || 0), rest = r.cost - fresh;
    const chars = reads.reduce((a, x) => a + x.chars, 0);
    for (const x of reads) {
      const s = topOf(calls.get(x.id));
      s.cost += rest / reads.length + fresh * (chars ? x.chars / chars : 1 / reads.length);
      s.chars += x.chars;
    }
  }
  // Calls made inside a helper agent are in its step, not steps of their own.
  const steps = [...calls.values()].filter((s) => !s.fileIndex && !s.sidechain).map(({ fileIndex, sidechain, ...s }) => s);
  return { steps, loose };
}

const round = (n) => Math.round(n * 10000) / 10000;
// Per-day totals for the Usage page, kept with the session's rows: { Date, Tool, Detail, Steps, Cost, Chars, Asked }.
// The not-a-step entries come as their own Tool (TURN_START, COMPACTION), Steps counting their calls.
export function stepDays({ steps, loose }) {
  const out = new Map();
  const add = (at, tool, detail, cost, chars = 0, asked = 0) => {
    const Date = localDate(at), k = `${Date}|${tool}|${detail}`;
    const g = out.get(k) || { Date, Tool: tool, Detail: detail, Steps: 0, Cost: 0, Chars: 0, Asked: 0 };
    g.Steps++; g.Cost += cost; g.Chars += chars; g.Asked += asked;
    out.set(k, g);
  };
  for (const s of steps) add(s.at, s.tool, s.detail, s.cost, s.chars, s.asked);
  for (const l of loose) add(l.at, l.tool, '', l.cost);
  return [...out.values()].map((g) => ({ ...g, Cost: round(g.Cost), Asked: round(g.Asked) })).sort((a, b) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : b.Cost - a.Cost));
}

// One session's view (its details panel): its kinds of step by total, its dearest steps, and what is not a step.
export function stepView({ steps, loose }, top = 10) {
  const kinds = new Map();
  for (const s of steps) {
    const k = `${s.tool}|${s.detail}`;
    const g = kinds.get(k) || { tool: s.tool, detail: s.detail, steps: 0, cost: 0, chars: 0 };
    g.steps++; g.cost += s.cost; g.chars += s.chars;
    kinds.set(k, g);
  }
  const untied = {};
  for (const l of loose) untied[l.tool] = (untied[l.tool] || 0) + l.cost;
  return {
    kinds: [...kinds.values()].sort((a, b) => b.cost - a.cost),
    top: [...steps].sort((a, b) => b.cost - a.cost).slice(0, top).map(({ at, tool, detail, label, cost, chars, inner }) => ({ at, tool, detail, label, cost, chars, inner })),
    untied,
    total: steps.reduce((a, s) => a + s.cost, 0) + loose.reduce((a, l) => a + l.cost, 0),
  };
}

// A session's steps, from its logs (cached with its rows). models: as for costs.mjs sessionRows.
export function sessionSteps(mainFile, sessionId, pricingFile, models = null) {
  const d = analyse(mainFile, sessionId, pricingFile, models);
  return attributeSteps(d.priced, d.agentFiles || []);
}
