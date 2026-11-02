// Plugin sources (#574): the marketplaces a desk installs Claude plugins from, on GitHub, on any other git host
// (GitLab, Bitbucket, Azure DevOps, a company server) or in a folder on the computer. Claude Code does the adding and
// installing itself (claude plugin marketplace add / plugin install, user scope, so only the desk home changes); this
// reads what a source lists and what each plugin brings, and turns git's and claude's errors into plain words.
// Docket never stores a sign-in: git uses the computer's own credential helper or ssh-agent, with prompts off.
import fs from 'node:fs';
import path from 'node:path';

// Where Docket keeps its own clone of a repo whose marketplace sits in a subfolder: <desk home>/plugin-sources/<name>.
// claude plugin marketplace add only finds .claude-plugin/marketplace.json at a repo's top, so for a subfolder Docket
// clones just that folder (git sparse checkout) and adds it as a folder source.
export const CLONES = 'plugin-sources';

// What the user typed, as a source: { kind: 'folder', path } or { kind: 'git', url, sub, host }. sub: the repo's folder
// that holds .claude-plugin/marketplace.json ('' for its top). Throws a plain message for anything else.
// paths: the platform's path functions (tests pass path.win32 or path.posix to try both).
export function sourceFrom(address, sub = '', paths = path) {
  const { isAbsolute } = paths;
  let a = String(address ?? '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
  let s = String(sub ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!a) throw new Error('Type a git address or the full path of a folder.');
  const cleanSub = (v) => {
    if (v.split('/').some((p) => p === '..' || p === '.') || /^[a-z]:/i.test(v)) throw new Error('The subfolder is a folder inside the repo, like ai-lab or tools/plugins.');
    return v;
  };
  const scp = a.match(/^([\w.-]+)@([\w.-]+):(?!\/\/)(.+)$/); // git@host:owner/repo.git
  if (/^(https?|ssh|git):\/\//i.test(a) || scp) {
    if (/\s/.test(a)) throw new Error('A git address has no spaces in it.');
    let host = scp ? scp[2] : '';
    if (!scp) {
      let u; try { u = new URL(a); } catch { throw new Error('That is not a git address Docket can read.'); }
      if (u.password) throw new Error('Leave the password or token out of the address. Sign in to the host with git on this computer instead; Docket never keeps a sign-in.');
      host = u.hostname;
      // An Azure DevOps page address names the folder it shows (?path=/ai-lab); the clone address is the part before it.
      const shown = u.searchParams.get('path');
      if (shown && !s && /\/_git\//.test(u.pathname)) s = shown.replace(/^\/+|\/+$/g, '');
      u.search = ''; u.hash = '';
      a = u.toString();
    }
    return { kind: 'git', url: a, sub: cleanSub(s), host };
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(a) && !isAbsolute(a)) // owner/repo always means github.com
    return { kind: 'git', url: `https://github.com/${a}.git`, sub: cleanSub(s), host: 'github.com' };
  if (!isAbsolute(a)) throw new Error('Type a git address (https://… or git@…) or the full path of a folder on this computer.');
  return { kind: 'folder', path: s ? paths.join(a, cleanSub(s)) : paths.normalize(a) };
}

// The git commands that make Docket's clone of just the subfolder, as argument lists. --filter keeps the download to
// the files checked out where the host allows it (git goes on without it where not); --depth 1 skips the history.
export function cloneCommands(src, dir) {
  return [['clone', '--depth', '1', '--filter=blob:none', '--sparse', src.url, dir], ['-C', dir, 'sparse-checkout', 'set', src.sub]];
}
// The env git and claude run with: every prompt off: a sign-in git would have to ask for fails at once, rather than waiting
// on a window nobody sees. A sign-in the credential helper already holds still works.
export const noPrompts = (env) => ({ ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_SSH_COMMAND: env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes' });

// git's or claude's output, said plainly. host: the git host, for the sign-in message.
export function plainError(out, host = '') {
  const t = String(out || '');
  const at = host ? ` to ${host}` : '';
  if (/terminal prompts disabled|could not read (Username|Password)|user interactivity has been disabled|unable to get password|Authentication failed|HTTP Basic: Access denied|Permission denied \(publickey|Host key verification failed|error: 40[13]|HTTP 40[13]|TF400813|not authorized/i.test(t))
    return `Git could not sign in${at}. Sign in${at} with git once on this computer (for example, git clone the repo in a terminal, which saves the sign-in in Git Credential Manager or your ssh-agent), then try again. Docket never keeps a sign-in of its own.`;
  if (/Repository not found|repository '[^']*' not found|TF401019|does not appear to be a git repository|repository not exported|error: 404|HTTP 404/i.test(t))
    return `Git found no repo at that address${host ? ` on ${host}` : ''}, or the sign-in on this computer cannot see it. Check the address.`;
  if (/Could not resolve host|Failed to connect|Connection timed out|Operation timed out|unable to access/i.test(t))
    return `Could not reach ${host || 'the git host'}. Check the address, and the network or VPN.`;
  if (/spawn git ENOENT|'git' is not recognized|git: command not found/i.test(t)) return 'Git is not installed on this computer, or not on its PATH.';
  if (/spawn .*ENOENT/i.test(t)) return 'The claude program was not found on this computer.';
  // claude's own --json line carries a message; else the last lines it printed.
  for (const l of t.split(/\r?\n/).reverse()) { try { const j = JSON.parse(l); if (j && j.message) return String(j.message); } catch {} }
  const lines = t.split(/\r?\n/).map((l) => l.replace(/^[✘✔×]\s*/, '').trim()).filter(Boolean);
  return lines.slice(-3).join(' ') || 'It stopped without saying why.';
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const exists = (p) => { try { fs.statSync(p); return true; } catch { return false; } };
const listOf = (dir, keep) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter(keep); } catch { return []; } };

// A source folder's marketplace.json, or null. dir: the folder that holds .claude-plugin/.
export const marketFile = (dir) => path.join(dir, '.claude-plugin', 'marketplace.json');
export function readMarket(dir) {
  const j = dir && readJson(marketFile(dir));
  return j && typeof j === 'object' && typeof j.name === 'string' && Array.isArray(j.plugins) ? j : null;
}

// The git host a marketplace entry's plugin comes from ('' for one kept in the source itself), for plainError.
export function hostOf(src) {
  if (src?.source === 'github') return 'github.com';
  try { return new URL(src?.url).hostname; } catch { return String(src?.url || '').match(/^[\w.-]+@([\w.-]+):/)?.[1] || ''; }
}
// A marketplace entry's own source, as a line: where the plugin comes from.
export function whereFrom(src) {
  if (typeof src === 'string') return src;
  if (!src || typeof src !== 'object') return 'unknown';
  const s = src.source;
  if (s === 'github') return `GitHub ${src.repo}${src.ref ? ` (${src.ref})` : ''}`;
  if (s === 'url' || s === 'git' || s === 'git-subdir') return `${src.url}${src.path ? ` (${src.path})` : ''}${src.ref ? ` (${src.ref})` : ''}`;
  if (s === 'directory' || s === 'file') return src.path;
  if (s === 'npm') return `npm ${src.package}`;
  return s || 'unknown';
}

// What one plugin brings, read from its folder (and its marketplace entry, which can declare the same parts).
// Skills, commands and agents are text the AI reads; hooks, MCP and LSP servers, and programs in bin/ run code on
// this computer. { text: [...], code: [...] }, each a list of plain words.
export function pluginBrings(dir, entry = {}) {
  const man = readJson(path.join(dir, '.claude-plugin', 'plugin.json')) || {};
  const has = (k) => man[k] !== undefined || entry[k] !== undefined;
  const n = (count, one) => `${count} ${one}${count === 1 ? '' : 's'}`;
  const skills = listOf(path.join(dir, 'skills'), (d) => d.isDirectory() && exists(path.join(dir, 'skills', d.name, 'SKILL.md'))).length;
  const md = (sub) => listOf(path.join(dir, sub), (d) => d.isFile() && d.name.endsWith('.md')).length;
  const commands = md('commands'), agents = md('agents');
  const text = [skills && n(skills, 'skill'), commands && n(commands, 'command'), agents && n(agents, 'agent'),
    !skills && has('skills') && 'skills', !commands && has('commands') && 'commands', !agents && has('agents') && 'agents'].filter(Boolean);
  const mcpOf = (v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v.mcpServers || v) : [];
  const mcp = [...new Set([...mcpOf(readJson(path.join(dir, '.mcp.json'))), ...mcpOf(man.mcpServers), ...mcpOf(entry.mcpServers)])];
  const code = [(exists(path.join(dir, 'hooks', 'hooks.json')) || has('hooks')) && 'hooks',
    (mcp.length || has('mcpServers')) && `MCP servers${mcp.length ? ` (${mcp.join(', ')})` : ''}`,
    (exists(path.join(dir, '.lsp.json')) || has('lspServers')) && 'LSP servers',
    isDir(path.join(dir, 'bin')) && 'programs in bin/'].filter(Boolean);
  return { text, code, version: man.version };
}

// The plugins a source lists. dir: the source folder on disk (its clone, or the folder itself). Each:
// { name, description, version, from, dir?, brings? }. dir and brings only for a plugin kept in the source itself
// (a ./ path), which is on disk before it is installed; any other comes from elsewhere and is seen only once installed.
export function pluginsIn(dir, market = readMarket(dir)) {
  if (!market) return [];
  const root = path.resolve(dir, market.metadata?.pluginRoot || '');
  return market.plugins.filter((e) => e && typeof e.name === 'string').map((e) => {
    const local = typeof e.source === 'string' && !/^[a-z][\w+.-]*:/i.test(e.source);
    // a ./ path is from the source folder, a bare name from metadata.pluginRoot
    const pdir = local ? path.resolve(/^\.\.?[\\/]/.test(e.source) ? dir : root, e.source) : '';
    const brings = pdir && isDir(pdir) ? pluginBrings(pdir, e) : null;
    return { name: e.name, description: e.description || '', version: e.version || brings?.version || '', from: whereFrom(e.source), dir: brings ? pdir : undefined, brings: brings || undefined };
  });
}

// The plain line beside a plugin's Install button.
export function bringsText(p) {
  if (!p.brings) return `comes from ${p.from}: what it brings shows only once it is installed`;
  const { text, code } = p.brings;
  return [text.length ? `${text.join(', ')} (text only)` : '', code.length ? `runs code on this computer: ${code.join(', ')}` : 'runs no code'].filter(Boolean).join(' · ');
}

// A source as known_marketplaces.json has it, as a line, and whether its folder is Docket's own clone (home: the desk's).
export function sourceLine(src, home) {
  const s = src || {};
  if (s.source === 'github') return `GitHub ${s.repo}`;
  if (s.source === 'git') return `${s.url}${s.path ? ` (${s.path})` : ''}`;
  if (s.source === 'directory' || s.source === 'file') {
    const clone = isClone(s.path, home);
    const meta = clone && readJson(clone + '.json');
    return meta?.url ? `${meta.url}${meta.sub ? ` (${meta.sub})` : ''}` : s.path;
  }
  return whereFrom(s);
}
// The clone folder (<home>/plugin-sources/<name>) a folder source sits in, or ''.
export function isClone(p, home) {
  if (!p || !home) return '';
  const base = path.resolve(home, CLONES) + path.sep, full = path.resolve(p);
  if (!full.toLowerCase().startsWith(base.toLowerCase())) return '';
  return base + full.slice(base.length).split(path.sep)[0];
}
