// A settings change a session proposes (#1239): suggest_settings shows a card with the diff against the current file,
// and Apply, the person's click, has Docket write it (a session may not edit its own permission settings). The rules are
// here, apart from the server, so they can be tested; server.mjs makes the card, writes the file and restarts the session.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { RULE_LISTS, ruleError } from './terminal-commands.mjs';

// The settings files a session may propose a change to, for the layers its desk loads (sources: the desk's
// settingSources, undefined for all three). Nothing else can be written from a card.
export function settingsTargets({ home, cwd, sources }) {
  const on = (l) => !sources || sources.includes(l), out = [];
  const add = (layer, file, label) => out.push({ layer, file: path.resolve(file), label });
  if (home && on('user')) {
    add('user', path.join(home, 'settings.json'), "the desk's settings.json");
    add('user', path.join(home, 'settings.local.json'), "the desk's settings.local.json");
  }
  if (cwd && on('project')) add('project', path.join(cwd, '.claude', 'settings.json'), "the folder's .claude/settings.json");
  if (cwd && on('local')) add('local', path.join(cwd, '.claude', 'settings.local.json'), "the folder's .claude/settings.local.json");
  return out;
}
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
// The target a session named: a path to one of them, or user / project / local for the layer's settings.json.
export function findTarget(targets, file) {
  const f = String(file || '').trim();
  if (['user', 'project', 'local'].includes(f)) return targets.find((t) => t.layer === f) || null;
  if (!f || !path.isAbsolute(f)) return null;
  return targets.find((t) => same(t.file, path.resolve(f))) || null;
}

// RFC 7396 JSON merge patch: an object merges key by key, null takes a key out, anything else (arrays too) replaces.
export function mergePatch(target, patch) {
  if (!isObj(patch)) return patch;
  const out = isObj(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
export const hashText = (text) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);

// What is wrong with a settings object, or ''. Only what Claude Code would refuse or misread: the shape of permissions
// and hooks, and each rule as /permissions checks it.
export function settingsError(j) {
  if (!isObj(j)) return 'Settings are a JSON object: { ... }';
  const p = j.permissions;
  if (p !== undefined) {
    if (!isObj(p)) return '"permissions" is an object';
    for (const k of RULE_LISTS) {
      if (p[k] === undefined) continue;
      if (!Array.isArray(p[k])) return `"permissions.${k}" is a list of rules`;
      for (const r of p[k]) { const bad = typeof r === 'string' ? ruleError(r) : 'each rule is a string'; if (bad) return `permissions.${k}: ${JSON.stringify(r)}: ${bad}`; }
    }
  }
  if (j.hooks !== undefined) {
    if (!isObj(j.hooks)) return '"hooks" is an object of event names, each a list';
    for (const [ev, list] of Object.entries(j.hooks)) if (!Array.isArray(list)) return `"hooks.${ev}" is a list`;
  }
  return '';
}

// The proposal against the file as it is now (currentText: '' when there is none). json: the proposed settings, or with
// merge a merge patch for them. -> { error } or { nextText, base, diff, added, removed }.
export const MAX_TEXT = 200000;
export function propose({ currentText = '', json, merge = false }) {
  let current = {};
  const cur = String(currentText || '').replace(/^﻿/, '');
  if (cur.trim()) {
    try { current = JSON.parse(cur); } catch (e) { return { error: `The file as it is now is not valid JSON (${e.message}), so a change to it cannot be shown. Fix it by hand first.` }; }
  }
  let given;
  try { given = JSON.parse(String(json ?? '')); } catch (e) { return { error: `Not valid JSON: ${e.message}` }; }
  if (!isObj(given)) return { error: merge ? 'A merge patch is a JSON object: { ... }' : 'Settings are a JSON object: { ... }' };
  const next = merge ? mergePatch(current, given) : given;
  const bad = settingsError(next);
  if (bad) return { error: bad };
  const nextText = JSON.stringify(next, null, 2) + '\n';
  if (nextText.length > MAX_TEXT) return { error: 'That is too big for a settings file' };
  const was = cur.trim() ? JSON.stringify(current, null, 2) + '\n' : '';
  if (was === nextText) return { error: 'That changes nothing: the file already says this.' };
  const diff = lineDiff(was, nextText);
  return { nextText, base: hashText(currentText || ''), diff, added: diff.filter((d) => d[0] === '+').length, removed: diff.filter((d) => d[0] === '-').length };
}

// The lines that differ, with `context` unchanged lines round each change: [[' ' | '-' | '+' | '…', text], ...].
// A plain longest-common-subsequence diff, which is enough for a settings file.
export function lineDiff(a, b, context = 3) {
  const x = a ? a.replace(/\n$/, '').split('\n') : [], y = b ? b.replace(/\n$/, '').split('\n') : [];
  const n = x.length, m = y.length, L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const all = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { all.push([' ', x[i]]); i++; j++; }
    else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) all.push(['-', x[i++]]);
    else all.push(['+', y[j++]]);
  }
  const keep = all.map(() => false);
  all.forEach((d, k) => { if (d[0] !== ' ') for (let c = Math.max(0, k - context); c <= Math.min(all.length - 1, k + context); c++) keep[c] = true; });
  const out = [];
  all.forEach((d, k) => { if (keep[k]) out.push(d); else if (out.length === 0 || out[out.length - 1][0] !== '…') out.push(['…', '']); });
  return out;
}

// Applies an open card: the file must still be as it was when proposed, the old one is kept beside it as
// <name>.bak-<date-time>, and the new text is written. -> { ok, backup } or { error, stale }.
export function applySettings({ file, nextText, base }, now = new Date()) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') return { error: `${path.basename(file)} could not be read: ${e.message}` }; }
  if (hashText(text) !== base) return { error: `${path.basename(file)} changed after this was proposed, so it was not applied. Ask the session to propose it again.`, stale: true };
  let backup = '';
  try {
    if (text) {
      const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      backup = `${file}.bak-${stamp}`;
      fs.copyFileSync(file, backup);
    } else fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, nextText);
  } catch (e) { return { error: `${path.basename(file)} could not be written: ${e.message}` }; }
  return { ok: true, backup };
}
