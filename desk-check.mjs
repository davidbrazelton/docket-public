// Desk check (#619): a report of how a desk is set up, and the setup problems Docket handles badly, each with
// what it means and its fix. It only reads: nothing here writes, moves or makes anything.
import fs from 'node:fs';
import path from 'node:path';

const realKey = (p) => { let r; try { r = fs.realpathSync.native(p); } catch { r = path.resolve(p); } return r.toLowerCase(); };
const samePath = (a, b) => !!a && !!b && realKey(a) === realKey(b);
// Whether p is dir or somewhere under it.
const inside = (p, dir) => { const rel = path.relative(realKey(dir), realKey(p)); return !rel || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
// What a folder is: missing, not a folder, unreadable, or there.
function look(dir) {
  try { if (!fs.statSync(dir).isDirectory()) return 'not a folder'; } catch (e) { return e.code === 'ENOENT' ? 'missing' : 'unreadable'; }
  try { fs.readdirSync(dir); return 'ok'; } catch { return 'unreadable'; }
}
const isRepo = (dir) => { try { return fs.existsSync(path.join(dir, '.git')); } catch { return false; } };
// The Claude setup a folder has: rules (CLAUDE.md, AGENTS.md), settings, and skills, commands or agents.
export function claudeSetup(dir) {
  const has = (f) => { try { return fs.existsSync(path.join(dir, f)); } catch { return false; } };
  const filled = (d) => { try { return fs.readdirSync(path.join(dir, d)).length > 0; } catch { return false; } };
  return [...['CLAUDE.md', 'AGENTS.md', '.claude/CLAUDE.md', '.claude/settings.json', '.claude/settings.local.json'].filter(has),
    ...['.claude/skills', '.claude/commands', '.claude/agents'].filter(filled)];
}

// ---------- skills and plugins that write into .claude (#1241) ----------
// Every write into a .claude folder (or the desk's Claude home) is a protected-path write: Auto mode reviews it even
// when an allow rule covers it, and refuses some. So a skill, command, agent or plugin whose text names a write there
// keeps running into those reviews. Hooks are left out: they run as programs, not as Claude's tool calls.
// A line names a write there when it names the folder and a writing word; a line that says never to is left out.
const CLAUDE_DIR = /(?<![\w.-])\.claude(?![\w.-])|CLAUDE_CONFIG_DIR/i;
const WRITES = /\b(?:write|writes|writing|written|wrote|save|saves|saved|saving|store|stores|stored|storing|cache[sd]?|caching|persist\w*|mkdir\w*|touch|tee|cp|copy|copies|copied|mv|append\w*|Set-Content|Add-Content|Out-File|New-Item|Copy-Item|Move-Item|writeFile\w*)\b|\s>>?\s*["'$~%\w]|\bopen\([^)]*["'][wa]\+?["']/i;
const NEVER = /\b(?:never|don't|do not|must not|instead of)\b/i;
const TEXT_FILE = /\.(?:md|txt|ps1|psm1|sh|bash|zsh|py|js|mjs|cjs|ts|json|cmd|bat|ya?ml|toml)$/i;
const SCAN_DEPTH = 4, SCAN_FILES = 200, SCAN_SIZE = 256 * 1024, LIST_MAX = 10;
const listDir = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } };
// The text files of a skill, command or agent: a file, or a folder and what is under it, within the limits above.
// Read without blocking: a desk with many plugins on a busy disk takes seconds.
async function textFiles(p) {
  const out = [];
  const walk = async (d, depth) => {
    let list; try { list = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (out.length >= SCAN_FILES) return;
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < SCAN_DEPTH && e.name !== 'node_modules' && e.name !== '.git') await walk(f, depth + 1); }
      else if (TEXT_FILE.test(e.name)) out.push(f);
    }
  };
  try { if ((await fs.promises.stat(p)).isDirectory()) await walk(p, 0); else if (TEXT_FILE.test(p)) out.push(p); } catch {}
  return out;
}
// The first line in these files that names a write into .claude or the Claude home: { file, line } or null.
async function firstWrite(files, home) {
  const homes = home ? [home, home.replace(/\\/g, '/')].map((h) => h.toLowerCase()) : [];
  for (const f of files) {
    let text; try { if ((await fs.promises.stat(f)).size > SCAN_SIZE) continue; text = await fs.promises.readFile(f, 'utf8'); } catch { continue; }
    for (const l of text.split(/\r?\n/)) {
      const names = CLAUDE_DIR.test(l) || homes.some((h) => l.toLowerCase().includes(h));
      if (names && WRITES.test(l) && !NEVER.test(l)) return { file: f, line: l.trim().slice(0, 160) };
    }
  }
  return null;
}
// The skills, commands, agents and plugins a desk's sessions load: [{ name, kind, where, path }], plugins as one each
// (their skills, commands and agents folders).
export function deskTools(home, folder) {
  const out = [];
  const each = (dir, kind, where, prefix = '') => {
    for (const e of listDir(dir)) {
      if (e.name.startsWith('.') || (kind === 'skill' ? !e.isDirectory() || (e.name === 'synced' && !prefix) : !(e.isDirectory() || /\.md$/i.test(e.name)))) continue;
      out.push({ name: prefix + e.name.replace(/\.md$/i, ''), kind, where, path: [path.join(dir, e.name)] });
    }
  };
  for (const [root, where] of [[home, 'the Claude home'], [folder && path.join(folder, '.claude'), 'the working folder']]) {
    if (!root) continue;
    each(path.join(root, 'skills'), 'skill', where);
    each(path.join(root, 'commands'), 'command', where);
    each(path.join(root, 'agents'), 'agent', where);
  }
  if (home) for (const b of listDir(path.join(home, 'skills', 'synced'))) if (b.isDirectory()) each(path.join(home, 'skills', 'synced', b.name), 'skill', 'shared by the claude.ai organization', 'anthropic-skills:');
  let installed = {}; try { installed = JSON.parse(fs.readFileSync(path.join(home, 'plugins', 'installed_plugins.json'), 'utf8')).plugins || {}; } catch {}
  for (const [key, list] of Object.entries(installed)) {
    const dir = (Array.isArray(list) ? list : [list])[0]?.installPath;
    if (dir) out.push({ name: key, kind: 'plugin', where: 'installed', path: ['skills', 'commands', 'agents'].map((d) => path.join(dir, d)) });
  }
  return out;
}
// Where a desk's tooling should keep its cookies, tokens, caches and marker files instead.
export const toolStateHome = (platform = process.platform) => platform === 'win32' ? '%LOCALAPPDATA%\\<tool>\\'
  : platform === 'darwin' ? '~/Library/Application Support/<tool>/' : '~/.local/share/<tool>/';
// The desk's skills, commands, agents and plugins whose text names a write into .claude: { checked, writers: [{ name, kind, where, file, line }] }.
// The caller passes it to deskCheck as `writers`, which stays a plain read of what it is given.
export async function claudeWriters(home, folder) {
  const tools = deskTools(home, folder), writers = [];
  for (const t of tools) {
    const hit = await firstWrite((await Promise.all(t.path.map(textFiles))).flat(), home);
    if (hit) writers.push({ name: t.name, kind: t.kind, where: t.where, ...hit });
  }
  return { checked: tools.length, writers };
}

const sessionsN = (n) => `${n} session${n === 1 ? '' : 's'}`;
const RECENT = 10; // "the last 10 sessions", for where work ran
const CWD_SAMPLE = 30;
const GROUP_RECENT = 5, GROUP_MIN = 3; // a group with no start folder: 3 of its last 5 sessions in one folder

// desk: { id, name, folder, home } with home already resolved (the default ~/.claude when the desk sets none).
// sessions: the desk's past sessions [{ id, cwd, lastModified, groupId }], any order.
// groups: the desk's open groups [{ id, name, folder }]. otherDesks: [{ name, folder }], to name a folder that is another desk's.
// writers: what claudeWriters found for this desk, or none to leave that part out.
// Returns { at, desk, findings: [{ key, title, means, fix, action? }], facts: [{ label, text }] }: findings are problems to fix.
// An action is a fix the Desks screen offers as a button: { kind: 'group-folder', group, folder, label }, which changes
// only Docket's own group setting.
export function deskCheck({ desk, sessions = [], groups = [], otherDesks = [], writers: scan = null, now = Date.now(), platform = process.platform }) {
  const findings = [], facts = [];
  const add = (key, title, means, fix) => findings.push({ key, title, means, fix });
  const folder = desk.folder ? path.resolve(desk.folder) : '';
  const fState = folder ? look(folder) : '';
  const fOk = fState === 'ok';
  const home = desk.home ? path.resolve(desk.home) : '';
  const hState = home ? look(home) : '';

  if (!folder) add('no-folder', 'No working folder is set', 'New sessions have no folder of this desk to start in, and Docket cannot check where its work lives.', 'Set the Working folder in this desk\'s settings to the folder its work starts from.');
  else if (!fOk) add('folder-' + fState.replace(/ /g, '-'), `The working folder is ${fState === 'missing' ? 'missing' : fState === 'unreadable' ? 'not readable' : 'not a folder'}`,
    `${folder} ${fState === 'missing' ? 'does not exist (a drive not connected, or the folder moved or renamed)' : fState === 'unreadable' ? 'cannot be read with this account' : 'is a file, not a folder'}, so new sessions cannot start there.`,
    fState === 'missing' ? 'Connect the drive, or set the Working folder to where the folder is now.' : 'Set the Working folder to a folder this account can open.');
  if (home && hState !== 'ok') add('home-' + hState.replace(/ /g, '-'), `The Claude home is ${hState === 'missing' ? 'missing' : hState === 'unreadable' ? 'not readable' : 'not a folder'}`,
    `${home} holds this desk's sign-in, settings, memory and past conversations. ${hState === 'missing' ? 'It does not exist, so the desk has no sign-in or past sessions there.' : 'Docket and its sessions cannot use it.'}`,
    hState === 'missing' ? 'If it moved, set the Claude home folder to where it is now. If it is new, sign in from this screen and Claude makes it.' : 'Set the Claude home folder to one this account can open.');

  // The working folder: its Claude setup, and whether it is a repo or a plain folder.
  const setup = fOk ? claudeSetup(folder) : [];
  const repo = fOk && isRepo(folder);
  if (fOk) {
    facts.push({ label: 'Working folder', text: `${folder}: ${repo ? 'a git repo' : 'a plain folder, not a git repo'}` });
    facts.push({ label: 'Claude setup there', text: setup.length ? setup.join(', ') : 'none (no CLAUDE.md, AGENTS.md, .claude settings, skills, commands or agents)' });
    if (!setup.length && !repo) add('no-setup', 'The working folder has no Claude setup',
      `${folder} has no CLAUDE.md, AGENTS.md or .claude settings, skills, commands or agents, so sessions started there know nothing about this desk's work.`,
      'Add a CLAUDE.md to the working folder that says what the work is, where the repos are and how to change them. Or, if all the work is in one place, set the Working folder to that place.');
  }

  // The Claude home inside the working folder.
  if (fOk && home && hState === 'ok') {
    const homeIn = inside(home, folder);
    facts.push({ label: 'Claude home', text: `${home}${homeIn ? ', inside the working folder' : ''}` });
    if (homeIn) add('home-inside', 'The Claude home is inside the working folder',
      `${home} holds the desk's sign-in, settings and every past conversation. Sessions work in the working folder and everything under it, so they can read and change their own settings and conversations, and searches of the folder run through them.`,
      'Move the Claude home folder out of the working folder (beside it is fine) and set the Claude home folder in this desk\'s settings to the new place, with no session running.');
  } else if (home && hState === 'ok') facts.push({ label: 'Claude home', text: home });

  // Skills, commands, agents and plugins that write into .claude (#1241).
  if (scan) {
    const { checked, writers } = scan;
    facts.push({ label: 'Writes into .claude', text: `${checked} skills, commands, agents and plugins checked; ${writers.length ? `${writers.length} name${writers.length === 1 ? 's' : ''} a write there` : 'none names a write there'}` });
    if (writers.length) add('claude-writers', `${writers.length === 1 ? 'A skill or plugin writes' : `${writers.length} skills or plugins write`} into .claude`,
      `Every write into a .claude folder or the Claude home is a protected-path write: Auto mode reviews it even when an allow rule covers it, and refuses some, and edits to skill files there are refused too. These name a write there: `
        + writers.slice(0, LIST_MAX).map((w) => `${w.kind} ${w.name} (${w.where}), in ${w.file}: "${w.line}"`).join('; ')
        + (writers.length > LIST_MAX ? `; and ${writers.length - LIST_MAX} more` : '') + '.',
      `Have each keep its cookies, tokens, caches and marker files in ${toolStateHome(platform)} (a folder only this account can open) and only read from .claude. A line that only reads from .claude is fine as it is.`);
  }

  // Where past sessions actually ran.
  const recent = sessions.filter((s) => s.cwd).sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
  const sample = recent.slice(0, CWD_SAMPLE);
  const where = (cwd) => {
    if (folder && inside(cwd, folder)) return samePath(cwd, folder) ? 'the working folder' : 'inside the working folder';
    const o = otherDesks.find((d) => d.folder && inside(cwd, d.folder));
    return o ? `${o.name}'s folder` : 'outside the working folder';
  };
  if (sample.length) {
    const by = new Map();
    for (const s of sample) { const k = realKey(s.cwd); const e = by.get(k) || by.set(k, { cwd: path.resolve(s.cwd), n: 0 }).get(k); e.n++; }
    const top = [...by.values()].sort((a, b) => b.n - a.n);
    facts.push({ label: `Where the last ${sessionsN(sample.length)} ran`, text: top.slice(0, 5).map((e) => `${e.cwd} (${e.n}, ${where(e.cwd)})`).join('; ') + (top.length > 5 ? `; and ${top.length - 5} more folders` : '') });
    const last = recent.slice(0, RECENT), out = folder ? last.filter((s) => !inside(s.cwd, folder)) : [];
    if (fOk && !setup.length && !repo && out.length * 2 > last.length) {
      const most = [...out.reduce((m, s) => m.set(realKey(s.cwd), [path.resolve(s.cwd), (m.get(realKey(s.cwd))?.[1] || 0) + 1]), new Map()).values()].sort((a, b) => b[1] - a[1])[0][0];
      add('work-elsewhere', 'Most work happens outside the working folder',
        `${out.length} of the last ${sessionsN(last.length)} ran outside ${folder}, most in ${most}. A session started in the working folder starts away from the work, with none of the rules that folder may have.`,
        `If the work lives under ${path.dirname(most)}, make that the Working folder (or a folder whose CLAUDE.md lists the repos). Otherwise add a CLAUDE.md to the working folder that says where the repos are.`);
    }
  } else facts.push({ label: 'Past sessions', text: 'none yet' });

  // Groups with no start folder whose recent sessions keep running in one folder (from the folders recorded, no guessing).
  for (const g of groups.filter((x) => !x.folder)) {
    const last = recent.filter((x) => x.groupId === g.id).slice(0, GROUP_RECENT);
    const by = new Map();
    for (const x of last) { const k = realKey(x.cwd); const e = by.get(k) || by.set(k, { cwd: path.resolve(x.cwd), n: 0 }).get(k); e.n++; }
    const top = [...by.values()].sort((a, b) => b.n - a.n)[0];
    if (!top || top.n < GROUP_MIN || (folder && samePath(top.cwd, folder)) || look(top.cwd) !== 'ok') continue;
    findings.push({ key: 'group-folder', title: `Group "${g.name}" has no start folder`,
      means: `${top.n === last.length ? `All of its last ${sessionsN(last.length)}` : `${top.n} of its last ${sessionsN(last.length)}`} ran in ${top.cwd}, but a new session in it starts in the desk's working folder.`,
      fix: `Make ${top.cwd} the group's start folder (the button here, or right-click the group > Set start folder…), so its new sessions start there.`,
      action: { kind: 'group-folder', group: g.id, folder: top.cwd, label: 'Set as start folder' } });
  }
  return { at: now, desk: { id: desk.id, name: desk.name }, findings, facts };
}
// The code hosts' findings (#1270), from the server's deskHosts: { ado: adoNeeds() and what was found, github:
// githubNeeds() } as findings, each with the Set up button for Azure DevOps.
export function hostFindings(h) {
  const out = [], ado = h?.ado, gh = h?.github;
  const where = (f) => f ? `${f.org}/${f.project}` : '';
  if (ado?.state === 'setup') out.push({ key: 'ado-setup', title: "Pull requests from Azure DevOps aren't linked",
    means: `Its sessions work in repos on Azure DevOps (${where(ado.suggest)}), but this desk has no Azure DevOps organization and project, so their pull requests never show on their rows.`,
    fix: 'Press Set up: it fills in the organization and project from the repos, and takes a token or your existing Azure DevOps sign-in.',
    action: { kind: 'ado-setup', label: 'Set up…' } });
  else if (ado?.state === 'token') out.push({ key: 'ado-token', title: ado.error ? 'The Azure DevOps sign-in does not work' : 'Azure DevOps has no sign-in',
    means: ado.error ? `${ado.error} So pull requests from ${ado.org}/${ado.project} are not linked.` : `No AZURE_DEVOPS_EXT_PAT token is set${ado.signIn ? ', and neither git nor the Azure CLI has a sign-in to borrow' : ''}, so pull requests from ${ado.org}/${ado.project} are not linked.`,
    fix: 'Press Set up and paste a token, or use your existing Azure DevOps sign-in.', action: { kind: 'ado-setup', label: 'Set up…' } });
  if (gh?.state === 'signin') out.push({ key: 'github-signin', title: "gh is not signed in, so GitHub pull requests aren't linked",
    means: `Its sessions work in repos on GitHub (${gh.found.slice(0, 3).join(', ')}), but gh, which Docket asks GitHub with, has no sign-in (or is not installed).`,
    fix: 'Run gh auth login in a terminal, as an account that can read those repos.' });
  else if (gh?.state === 'access') out.push({ key: 'github-access', title: "gh can't read some of this desk's GitHub repos",
    means: `No account signed in to gh can read ${gh.repos.slice(0, 3).join(', ')}${gh.repos.length > 3 ? ` and ${gh.repos.length - 3} more` : ''}, so their pull requests are not linked.`,
    fix: 'Run gh auth login in a terminal as an account that can read them; Docket tries every account gh is signed in as.' });
  return out;
}
// The report as plain text, for the desk_check tool.
export function deskCheckText(r) {
  const head = `Desk check for ${r.desk.name}, ${new Date(r.at).toLocaleString()}: ${r.findings.length ? `${r.findings.length} to fix` : 'nothing to fix'}.`;
  const items = r.findings.map((f, i) => `${i + 1}. ${f.title}\n   What it means: ${f.means}\n   Fix: ${f.fix}`);
  return [head, ...items, '', 'What it found:', ...r.facts.map((f) => `- ${f.label}: ${f.text}`)].join('\n');
}
