// A company's Grok home folder (GROK_HOME): the settings Docket gives a new one, the Docket hooks it
// writes there for Grok sessions, and how it reads what `grok` says about the sign-in.
import fs from 'node:fs';
import path from 'node:path';

// A new Grok home's config.toml. Grok also reads Claude's rules (CLAUDE.md) and Claude's hooks (~/.claude/settings.json)
// unless told not to, which would bring a company's Claude rulebook into its Grok sessions; these two lines keep them out.
export const NEW_CONFIG = `# Made by Docket for a new Grok home.
# Grok would also read Claude's rules (CLAUDE.md) and Claude's hooks (settings.json); these keep them out.
[compat.claude]
hooks = false
rules = false
`;

// Make the folder, and its config.toml when it has none. An existing config.toml is the company's own and is left alone.
export function makeGrokHome(home) {
  fs.mkdirSync(home, { recursive: true });
  const file = path.join(home, 'config.toml');
  if (fs.existsSync(file)) return false;
  fs.writeFileSync(file, NEW_CONFIG);
  return true;
}

// The Docket plugin's hook list in Grok's form. Grok's hook files use Claude's shape, so only the plugin folder changes:
// Grok expands ${CLAUDE_PLUGIN_ROOT} only for real plugins, and `grok agent --plugin-dir` loads no hooks (Grok 1.0.41,
// checked 2026-10-27), so the folder is written out in full.
export function grokHooks(pluginDir) {
  const j = JSON.parse(fs.readFileSync(path.join(pluginDir, 'hooks', 'hooks.json'), 'utf8'));
  const root = path.resolve(pluginDir).split(path.sep).join('/');
  const hooks = {};
  for (const [event, groups] of Object.entries(j.hooks || {})) {
    hooks[event] = (groups || []).map((g) => ({ ...(g.matcher ? { matcher: g.matcher } : {}),
      hooks: (g.hooks || []).map((h) => ({ ...h, command: String(h.command || '').split('${CLAUDE_PLUGIN_ROOT}').join(root) })) }));
  }
  return { hooks };
}

// Grok reads every *.json in <home>/hooks/ as trusted hooks. Docket owns hooks/docket.json there and rewrites it before
// each Grok session, so it follows the plugin and the folder Docket runs from. A company's DOCKET_HOOKS_OFF reaches the
// scripts through the session's environment, which Grok hands its hooks; outside Docket it is unset and they do nothing.
export const HOOK_FILE = 'docket.json';
export function writeGrokHooks(home, pluginDir) {
  const file = path.join(home, 'hooks', HOOK_FILE);
  const body = JSON.stringify(grokHooks(pluginDir), null, 2) + '\n';
  let old = null; try { old = fs.readFileSync(file, 'utf8'); } catch {}
  if (old === body) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return true;
}

// `grok models` starts with "You are logged in with grok.com." or "You are not authenticated." (Grok 1.0.41).
export const signedInFrom = (out) => /\blogged in\b/i.test(String(out)) && !/not authenticated/i.test(String(out));

// Who a Grok home is signed in as, from its auth.json (one entry per sign-in, each with the email, which may be empty,
// and the name; checked 2026-11-07): the email, else the name, else null.
export function grokAccount(home) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8'));
    const a = Object.values(j).find((x) => x && typeof x === 'object' && (x.email || x.first_name));
    return a ? a.email || a.first_name : null;
  } catch { return null; }
}

// `grok login --device-auth` prints a link that carries its code, then waits until the code is approved in a browser.
export function deviceLink(out) {
  const url = String(out).match(/https:\/\/\S+user_code=([\w-]+)/);
  return url ? { url: url[0], code: url[1] } : null;
}

// Whether a folder is the given folder or inside it. Windows and macOS (by default) ignore letter case in folder names, so the check does too.
export function isInside(child, parent, win = process.platform === 'win32' || process.platform === 'darwin') {
  const norm = (p) => { const r = path.resolve(p); return win ? r.toLowerCase() : r; };
  const rel = path.relative(norm(parent), norm(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
