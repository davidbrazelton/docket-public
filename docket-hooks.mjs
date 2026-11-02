// The Docket plugin (plugin/): the hooks Docket adds to every Claude session it starts.
// Shown only here and in server.mjs; the hook scripts themselves live in plugin/hooks/.
import fs from 'node:fs';
import path from 'node:path';

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
// A hook's short name is its script's file name: "node ${CLAUDE_PLUGIN_ROOT}/hooks/bash-cmdline-guard.mjs" -> bash-cmdline-guard.
const nameOf = (command) => (String(command || '').match(/([\w.-]+)\.(?:m?js|cjs)\b/) || [])[1] || '';

// The plugin's hooks: [{ name, event, matcher, detail, command }], in the order hooks.json lists them.
export function pluginHooks(pluginDir) {
  const j = readJson(path.join(pluginDir, 'hooks', 'hooks.json'));
  const out = [];
  for (const [event, groups] of Object.entries(j?.hooks || {})) for (const g of groups || []) for (const h of g.hooks || []) {
    const name = nameOf(h.command);
    if (name && !out.some((x) => x.name === name)) out.push({ name, event, matcher: g.matcher || '', detail: h.statusMessage || '', command: h.command });
  }
  return out;
}

// Names of Docket hooks the company's own Claude home already wires (its settings.json runs a script of the
// same name, as one that runs its own bash-cmdline-guard.js). Docket's copy steps aside so it never runs twice.
export function ownCopies(home, names) {
  const found = new Set();
  for (const f of ['settings.json', 'settings.local.json']) {
    const hooks = readJson(path.join(home, f))?.hooks || {};
    for (const groups of Object.values(hooks)) for (const g of groups || []) for (const h of g.hooks || []) {
      const n = nameOf(h.command);
      if (names.includes(n)) found.add(n);
    }
  }
  return [...found];
}

// A company's list as saved: { off: [names] }, or undefined when nothing is turned off.
export function cleanDocketHooks(v) {
  const off = [...new Set((Array.isArray(v?.off) ? v.off : []).map((s) => String(s).trim()).filter((s) => /^[\w.-]{1,60}$/.test(s)))];
  return off.length ? { off } : undefined;
}

// Every Docket hook with whether it runs for this company, and why not.
export function hooksFor(client, pluginDir) {
  const list = pluginHooks(pluginDir);
  const own = ownCopies(client.home, list.map((h) => h.name));
  const off = client.docketHooks?.off || [];
  return list.map((h) => ({ ...h, off: off.includes(h.name), ownCopy: own.includes(h.name) }));
}

// The value for DOCKET_HOOKS_OFF: turned off by the company, or already run by its own home.
export const hooksOffFor = (client, pluginDir) => hooksFor(client, pluginDir).filter((h) => h.off || h.ownCopy).map((h) => h.name).join(',');
