// The environment guard (#1240): an optional PreToolUse hook a desk turns on in the setup wizard. The user names
// production markers and test-environment markers (exact environment names or hosts, never a bare word like
// "production", which raised cards on ordinary docs). Docket writes the hook as a script of its own, outside any
// .claude folder, runs its self-test, and only then adds the hook to the desk's settings.json.
//
// A hook that answers ask sends the call to the permission prompt (an Allow? card in Docket) instead of Auto mode's
// classifier, which had refused test-environment writes the user had already approved in chat; deny blocks in every
// mode. What it decides:
//   Edit/Write of a .claude/settings*.json file, the desk's settings or the guard   deny
//   a command that prints or saves an API key (or other secret) environment variable  deny
//   a production marker and a write in a command                                  deny
//   a production marker in file text (Edit/Write)                                 ask: it may only be documentation
//   a production marker in a command, no write                                    ask
//   a test-environment marker and a write in a command                            ask
//   anything else                                                                 no answer: the classifier decides
// A call made from a temporary script file hides its host from the guard, so sessions on a guarded desk are told to
// make such calls inline (prompts/optional/env-guard.md).

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const GUARD_MATCHER = 'Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit';
const MAX_MARKERS = 40;

// The markers as typed (a list, or text with one per line or comma), trimmed and without repeats. A marker of one
// character would match nearly everything, so it is dropped. Null when neither list has one.
export function cleanGuard(g) {
  if (!g || typeof g !== 'object') return null;
  const list = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[\n,]/))
    .map((x) => String(x).trim().slice(0, 200)).filter((x) => x.length > 1))].slice(0, MAX_MARKERS);
  const production = list(g.production), test = list(g.test).filter((t) => !production.some((p) => p.toLowerCase() === t.toLowerCase()));
  return production.length || test.length ? { production, test } : null;
}

// The first marker of the list found in the text, as a whole name: not inside a longer word or hyphenated name.
function guardHit(list, text) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const m of list || []) if (new RegExp(`(^|[^\\w-])${esc(m)}(?![\\w-])`, 'i').test(text)) return m;
  return '';
}

// The write in a command, if it has one: an HTTP method that changes something, or a verb that does (aws's
// update-item counts; --update and feature-update do not).
function guardWrite(cmd) {
  const m = cmd.match(/(?:^|[^\w-])(put|post|patch|delete|create|update|deploy|apply|destroy|drop|insert|upsert)(?!\w)/i)
    || cmd.match(/--data(?:-raw|-binary|-urlencode)?(?![\w-])|--json(?![\w-])/);
  return m ? (m[1] || m[0]) : '';
}

// A command that prints or saves a secret from the environment: an API key, token, secret or password variable used
// in the same step as echo, Write-Output, Out-File and the like, or a dump of every environment variable.
function guardPrintsKey(cmd) {
  const name = '[A-Z0-9_]*(?:API_?KEY|ACCESS_KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*';
  const ref = new RegExp(`\\$\\{?${name}\\}?(?![\\w])|%${name}%|process\\.env(?:\\.${name}|\\[['"]${name})|os\\.environ(?:\\.get\\(|\\[)['"]${name}|getenv\\(['"]${name}|\\bprintenv\\s+${name}`);
  const psRef = new RegExp(`(\\$env:|\\benv:)${name}(?![\\w])`, 'i');
  const show = /(?:^|[^\w-])(echo|printf|print|Write-Output|Write-Host|Out-File|Set-Content|Add-Content|tee|console\.log|printenv|Get-Item|gi)(?![\w-])/i;
  for (const seg of cmd.split(/\r?\n|;|&&|\|\|/)) { // a pipe stays in its step: $env:X | Out-File saves it
    if (/^\s*(printenv|env|export\s+-p|(Get-ChildItem|gci|dir|ls)\s+env:\\?)\s*$/i.test(seg)) return true;
    if ((ref.test(seg) || psRef.test(seg)) && show.test(seg)) return true;
  }
  return false;
}

// The guard's answer for one tool call: [decision, reason], or null to leave it to the classifier. cfg: the markers
// and protect, the guard's own files.
export function guardDecide(input, cfg) {
  const tool = input?.tool_name || '', t = input?.tool_input || {};
  const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const file = norm(t.file_path || t.notebook_path);
    if (/(^|\/)\.claude\/settings[^/]*\.json$/.test(file) || (cfg.protect || []).some((p) => norm(p) === file))
      return ['deny', 'The environment guard keeps Claude settings files and its own files from being changed by a session. Ask the user to make this change.'];
    const text = [t.content, t.new_string, t.new_source, ...(Array.isArray(t.edits) ? t.edits.map((e) => e?.new_string) : [])].filter((x) => typeof x === 'string').join('\n');
    const prod = guardHit(cfg.production, file + '\n' + text);
    return prod ? ['ask', `This file names the production environment (${prod}). It may only be documentation, so it is the user's to allow.`] : null;
  }
  if (tool !== 'Bash' && tool !== 'PowerShell') return null;
  const cmd = String(t.command || '');
  if (guardPrintsKey(cmd)) return ['deny', 'The environment guard blocks commands that print or save an API key or other secret from an environment variable. Use the variable without showing it.'];
  const prod = guardHit(cfg.production, cmd), write = guardWrite(cmd);
  if (prod && write) return ['deny', `The environment guard blocks writes to production (${prod}, ${write}). Production changes are the user's to make.`];
  if (prod) return ['ask', `This command reaches the production environment (${prod}). It does not look like a write, but it is the user's to allow.`];
  const test = guardHit(cfg.test, cmd);
  if (test && write) return ['ask', `This command writes to a test environment (${test}, ${write}).`];
  return null;
}

// The hook script: the functions above with the desk's markers, reading one tool call on stdin. Anything it cannot
// read gets no answer, so a broken call never blocks the session.
export function guardScript(cfg) {
  return `// Docket's environment guard for one desk (#1240). Docket writes this file; change the markers in Docket's setup.
// A PreToolUse hook: reads the tool call on stdin and answers ask or deny, or nothing to leave it to Auto mode.
const CFG = ${JSON.stringify(cfg, null, 1)};
${guardHit}
${guardWrite}
${guardPrintsKey}
${guardDecide}
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  let r = null;
  try { r = guardDecide(JSON.parse(raw), CFG); } catch {}
  if (r) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: r[0], permissionDecisionReason: r[1] } }));
});
`;
}

// The hook's command line, with forward slashes so no shell eats the backslashes.
export const guardCommand = (script) => `node "${script.replace(/\\/g, '/')}"`;

// The self-test: the script run as Claude Code runs it, on calls made from the desk's own markers, each answer checked
// against guardDecide and the fixed ones against the table above. Returns { ok, checks, failed: [what] }.
export async function guardSelfTest(script, cfg, node = process.execPath) {
  const p = cfg.production[0], t = cfg.test[0];
  const cases = [
    ['a Claude settings edit is blocked', { tool_name: 'Edit', tool_input: { file_path: 'C:/Work/app/.claude/settings.local.json', old_string: 'a', new_string: 'b' } }, 'deny'],
    ['an edit of the guard itself is blocked', { tool_name: 'Write', tool_input: { file_path: script, content: '' } }, 'deny'],
    ['printing an API key is blocked', { tool_name: 'Bash', tool_input: { command: 'echo $EXAMPLE_API_KEY' } }, 'deny'],
    ['an ordinary command is left alone', { tool_name: 'Bash', tool_input: { command: 'git status' } }, 'none'],
    ...(p ? [
      ['a production write is blocked', { tool_name: 'Bash', tool_input: { command: `curl -X POST https://${p}/v1/items` } }, 'deny'],
      ['a production read asks', { tool_name: 'PowerShell', tool_input: { command: `Invoke-RestMethod https://${p}/v1/items` } }],
      ['production in file text asks', { tool_name: 'Write', tool_input: { file_path: 'C:/Work/app/notes.md', content: `Release to ${p} after review.` } }, 'ask'],
    ] : []),
    ...(t ? [
      ['a test-environment write asks', { tool_name: 'Bash', tool_input: { command: `curl -X PATCH https://${t}/v1/items/1` } }, 'ask'],
      ['a test-environment read is left alone', { tool_name: 'Bash', tool_input: { command: `curl https://${t}/v1/items` } }],
    ] : []),
  ];
  // All at once, without holding up the app while they run.
  const run = (input) => new Promise((resolve) => {
    const child = execFile(node, [script], { encoding: 'utf8', timeout: 10000, windowsHide: true }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
    child.stdin.on('error', () => {}); // a script that exits before reading
    child.stdin.end(JSON.stringify(input));
  });
  const results = await Promise.all(cases.map(([, input]) => run(input)));
  const failed = [];
  cases.forEach(([what, input, fixed], i) => {
    const want = fixed || guardDecide(input, cfg)?.[0] || 'none', r = results[i];
    let got = 'none';
    try { if (r.stdout.trim()) got = JSON.parse(r.stdout).hookSpecificOutput.permissionDecision; } catch { got = 'unreadable output'; }
    if (r.error) got = `failed to run (${(r.stderr || '').trim().slice(0, 200) || r.error.message})`;
    if (got !== want) failed.push(`${what}: wanted ${want}, got ${got}`);
  });
  return { ok: !failed.length, checks: cases.length, failed };
}

// The desk's settings with the guard's hook in or out. Other hooks are kept; the guard's own entry is found by its
// script path, or by its status message when Docket's folder has moved since. Returns the new settings object.
const GUARD_STATUS = 'Checking the environment guard';
export function withGuardHook(settings, script, on) {
  const out = { ...(settings || {}) }, cmd = guardCommand(script), ours = (h) => h?.command === cmd || h?.statusMessage === GUARD_STATUS;
  const hooks = { ...(out.hooks || {}) };
  const pre = (Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [])
    .map((m) => ({ ...m, hooks: (m.hooks || []).filter((h) => !ours(h)) })).filter((m) => m.hooks.length);
  if (on) pre.push({ matcher: GUARD_MATCHER, hooks: [{ type: 'command', command: cmd, timeout: 10, statusMessage: GUARD_STATUS }] });
  if (pre.length) hooks.PreToolUse = pre; else delete hooks.PreToolUse;
  if (Object.keys(hooks).length) out.hooks = hooks; else delete out.hooks;
  return out;
}

// Turn the guard on (cfg) or off (null) for a desk: write the script to scriptFile, test it, then change settingsFile.
// A settings file Docket cannot read is left alone. Throws with what went wrong; the settings are untouched then.
export async function applyGuard({ scriptFile, settingsFile, cfg }) {
  scriptFile = path.resolve(scriptFile); // a session runs the hook from its own folder
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8').replace(/^\uFEFF/, '') || '{}'); }
  catch (e) { if (e.code !== 'ENOENT') throw new Error(`${settingsFile} could not be read (${e.message}), so the guard was not changed`); }
  let test = null;
  if (cfg) {
    const full = { ...cfg, protect: [scriptFile, settingsFile] };
    fs.mkdirSync(path.dirname(scriptFile), { recursive: true });
    fs.writeFileSync(scriptFile, guardScript(full));
    test = await guardSelfTest(scriptFile, full);
    if (!test.ok) throw new Error(`The environment guard's self-test failed, so it was not turned on: ${test.failed.join('; ')}`);
  }
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(withGuardHook(settings, scriptFile, !!cfg), null, 2) + '\n');
  if (!cfg) fs.rmSync(scriptFile, { force: true });
  return test;
}
