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
const sessionsN = (n) => `${n} session${n === 1 ? '' : 's'}`;
const RECENT = 10; // "the last 10 sessions", for where work ran
const CWD_SAMPLE = 30;
const GROUP_RECENT = 5, GROUP_MIN = 3; // a group with no start folder: 3 of its last 5 sessions in one folder

// desk: { id, name, folder, home } with home already resolved (the default ~/.claude when the desk sets none).
// sessions: the desk's past sessions [{ id, cwd, lastModified, groupId }], any order.
// groups: the desk's open groups [{ id, name, folder }]. otherDesks: [{ name, folder }], to name a folder that is another desk's.
// Returns { at, desk, findings: [{ key, title, means, fix, action? }], facts: [{ label, text }] }: findings are problems to fix.
// An action is a fix the Desks screen offers as a button: { kind: 'group-folder', group, folder, label }, which changes
// only Docket's own group setting.
export function deskCheck({ desk, sessions = [], groups = [], otherDesks = [], now = Date.now() }) {
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
// The report as plain text, for the desk_check tool.
export function deskCheckText(r) {
  const head = `Desk check for ${r.desk.name}, ${new Date(r.at).toLocaleString()}: ${r.findings.length ? `${r.findings.length} to fix` : 'nothing to fix'}.`;
  const items = r.findings.map((f, i) => `${i + 1}. ${f.title}\n   What it means: ${f.means}\n   Fix: ${f.fix}`);
  return [head, ...items, '', 'What it found:', ...r.facts.map((f) => `- ${f.label}: ${f.text}`)].join('\n');
}
