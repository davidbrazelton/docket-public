// Tickets and pull requests on session rows: Jira tickets, GitHub issues and Azure DevOps pull requests.
// A session's links come only from the git branches it worked on (its entries' gitBranch, and the branches its own
// shell commands made or pushed) and the issues its own shell commands filed, never from text it read or printed: a
// session reviewing others' work mentions dozens of tickets. Status is plain REST, no AI.
import path from 'node:path';

const NOT_BRANCHES = new Set(['master', 'main', 'develop', 'head', 'origin', 'upstream']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

// A word that can be a branch name: no variables, quotes or shell punctuation, not a trunk branch.
export function goodBranch(b) {
  b = String(b || '').replace(/^refs\/heads\//, '');
  if (!/^[\w][\w.\/#-]*$/.test(b) || b.length > 200 || b.endsWith('.lock') || b.includes('..')) return '';
  return NOT_BRANCHES.has(b.toLowerCase()) ? '' : b;
}

// The words of one command, quotes taken off: "a b" and 'a b' stay one word.
const words = (part) => (part.match(/"[^"]*"|'[^']*'|[^\s]+/g) || []).map((w) => w.replace(/^(["'])(.*)\1$/, '$2'));
// git checkout <branch> or git switch <branch>, to a branch that already exists. Erring toward real branch
// names: not checkout -- <file>, not a file or folder (a dot or slash in front, a backslash, a file ending like .js),
// not a commit, HEAD~1 or a remote's branch (origin/x leaves no branch checked out), not two names at once
// (git checkout <commit> <file>).
const CHECKOUT_FLAGS = new Set(['-f', '--force', '-q', '--quiet', '-m', '--merge', '--no-track', '--track', '-t', '--guess', '--no-guess',
  '--ignore-other-worktrees', '--progress', '--no-progress', '--discard-changes', '--recurse-submodules', '--no-recurse-submodules']);
function switchedTo(args) {
  const names = [];
  for (const a of args) {
    if (a === '--' || a === '-' || a.startsWith('-') && !CHECKOUT_FLAGS.has(a.split('=')[0])) return '';
    if (!a.startsWith('-')) names.push(a);
  }
  const b = names.length === 1 ? names[0] : '';
  if (!b || /^[./]|[\\~^:]|\/$|\.[A-Za-z]\w{0,4}$/.test(b) || /^(origin|upstream)\//i.test(b) || /^[0-9a-f]{7,40}$/i.test(b)) return '';
  return b;
}

// The branches one shell command makes, switches to or pushes: worktree add -b, checkout -b, switch -c,
// checkout <branch>, switch <branch>, push <remote> <branch>.
export function branchesInCommand(cmd) {
  const out = [];
  const word = String.raw`["']?([^\s"';&|()<>]+)["']?`;
  for (const part of String(cmd || '').split(/\r?\n|&&|\|\||;|\|/)) {
    // git, its own options (-C <folder>, -c <setting>, --no-pager), then the command itself: not "git stash push"
    // or a commit message that says push.
    const git = String.raw`(?:^|[\s(])git(?:\.exe)?(?:\s+-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)|\s+--?[\w-]+(?:=\S+)?)*\s+`;
    let m;
    const make = new RegExp(String.raw`${git}(?:worktree\s+add\b.*?\s-[bB]|checkout\b.*?\s-[bB]|switch\b.*?\s(?:-[cC]|--create|--force-create))\s+${word}`, 'g');
    while ((m = make.exec(part))) out.push(m[1]);
    const to = part.match(new RegExp(String.raw`${git}(checkout|switch)\b(.*)$`));
    if (to && !/\s(?:-[bBcC]|--create|--force-create|--orphan)\b/.test(to[2])) out.push(switchedTo(words(to[2])));
    const push = part.match(new RegExp(String.raw`${git}\bpush\b(.*)$`));
    if (push && !/\s(--delete|-d)\b/.test(push[1])) {
      const args = push[1].trim().split(/\s+/).filter((a) => a && !a.startsWith('-')).map((a) => a.replace(/^["']|["']$/g, ''));
      for (const ref of args.slice(1)) out.push(ref.replace(/^\+/, '').split(':').pop());
    }
  }
  return [...new Set(out.map(goodBranch).filter(Boolean))];
}

// The folders one shell command did branch work in, whose branch is then the session's: the folder git worktree add
// makes, and each folder it ran git commit, push, checkout, switch, merge, rebase, cherry-pick, revert or am in, or
// gh pr create. A folder it only cd'd into or read from (git grep, log, fetch, status, diff, show) is not one: a repo
// it only read may be on someone else's branch. Each folder is taken from the one before it (cd, chdir, pushd,
// Set-Location, Push-Location, git -C <folder>), from cwd, the session's own folder, to start.
// last: the folder the command worked in at its end, for which branch the session is on now: the last folder it moved
// to or ran git in, else ''. A folder with a variable, ~ or a wildcard in it is left out.
const MOVES = new Set(['cd', 'chdir', 'pushd', 'set-location', 'sl', 'push-location']);
const BRANCH_WORK = new Set(['commit', 'push', 'checkout', 'switch', 'merge', 'rebase', 'cherry-pick', 'revert', 'am']);
const WORKTREE_VALUE = new Set(['-b', '-B', '--reason']);
const winPath = (p) => /^[A-Za-z]:([\\/]|$)|^\\\\/.test(p);
export function resolveFolder(base, p) {
  p = String(p || ''); base = String(base || '');
  if (!p || p === '-' || /[$%`*?<>|"']|^~/.test(p)) return '';
  if (winPath(base)) p = p.replace(/^\/([A-Za-z])(?=\/|$)/, (_, d) => d.toUpperCase() + ':/'); // Git Bash: /v/Repos is V:/Repos
  const win = winPath(base) || winPath(p);
  if (!base && !(win || p.startsWith('/'))) return ''; // relative, with nothing to start from
  return (win ? path.win32 : path.posix).resolve(base || p, p);
}
export function foldersInCommand(cmd, cwd) {
  const folders = [];
  let here = String(cwd || ''), last = '';
  const worked = (d) => { if (d) folders.push(d); };
  for (const part of String(cmd || '').split(/\r?\n|&&|\|\||;|\|/)) {
    const w = words(part.replace(/^[\s(&]+/, ''));
    if (!w.length) continue;
    if (MOVES.has(w[0].toLowerCase())) {
      const d = resolveFolder(here, w.slice(1).find((a) => !/^(\/d|-Path|-LiteralPath)$/i.test(a)));
      if (d) here = last = d;
      continue;
    }
    if (/^gh(\.exe)?$/i.test(w[0]) && w[1] === 'pr' && w[2] === 'create') { if (here) worked(last = here); continue; }
    const g = w.findIndex((a) => /^git(\.exe)?$/i.test(a));
    if (g < 0) continue;
    let dir = here, i = g + 1;
    for (; dir && i < w.length && w[i].startsWith('-'); i++) {
      if (w[i] === '-C' && i + 1 < w.length) dir = resolveFolder(dir, w[++i]); else if (w[i] === '-c') i++;
    }
    if (!dir) continue;
    last = dir;
    if (BRANCH_WORK.has(w[i])) worked(dir);
    if (w[i] === 'worktree' && w[i + 1] === 'add') {
      const args = w.slice(i + 2);
      for (let j = 0; j < args.length; j++) {
        if (WORKTREE_VALUE.has(args[j])) j++;
        else if (!args[j].startsWith('-')) { const d = resolveFolder(dir, args[j]); if (d) worked(last = d); break; }
      }
    }
  }
  return { folders: [...new Set(folders)], last };
}

// One session-file entry's branches: where it ran (gitBranch) and what its own shell commands made or pushed.
export function branchesInEntry(e) {
  const out = [];
  const gb = goodBranch(e?.gitBranch);
  if (gb) out.push(gb);
  const content = e?.type === 'assistant' && Array.isArray(e.message?.content) ? e.message.content : [];
  for (const c of content) if (c?.type === 'tool_use' && SHELL_TOOLS.has(c.name) && typeof c.input?.command === 'string') out.push(...branchesInCommand(c.input.command));
  return out;
}

// A shell command that files a GitHub issue: gh issue create as the command itself (after any VAR=value or & in front),
// not words inside a commit message, an echo or a script.
export const filesIssue = (cmd) => String(cmd || '').replace(/\$\([^()]*\)/g, 'x').split(/\r?\n|&&|\|\||;|\|/)
  .some((part) => /^\s*(?:&\s*)?(?:\w+=\S+\s+)*gh(?:\.exe)?(?:\s+(?:-R|--repo)[\s=]\S+)?\s+issue\s+create\b/.test(part));
// The GitHub issue addresses in a piece of text: https://github.com/<owner>/<repo>/issues/<n>.
const ISSUE_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)(?![\w/])/gi;
export function parseIssueUrl(u) {
  const m = String(u || '').trim().match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/?(?:[?#].*)?$/i);
  return m ? { url: `https://github.com/${m[1]}/issues/${Number(m[2])}`, repo: m[1], number: Number(m[2]) } : null;
}
const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : x?.text || '')).join('\n') : '');

// What a session file says, read a piece at a time: its GitHub "pr-link" entries, its branches, and the GitHub issues
// its own gh issue create commands filed. scan holds what was read so far; text is what the file gained since.
// A pull request keeps the branch last seen before its link (last), for when GitHub cannot say which branch it came
// from. dirs: branch -> the folder the session was in when it saw it, to find the branch's GitHub repository.
// filing: the gh issue create commands still waiting for their output.
// folders: its own folder, the folders its shell commands did branch work in and those it edited files in, oldest
// first, and lastFolder the one it worked in last;
// made: the last branch its own commands made or switched to.
export function newLinkScan() { return { offset: 0, rest: '', prs: new Map(), branches: new Set(), last: '', dirs: new Map(), issues: new Map(), filing: new Set(), folders: new Set(), lastFolder: '', made: '' }; }
const MAX_FOLDERS = 30;
function sawFolder(scan, d) {
  scan.folders.delete(d); scan.folders.add(d); // the newest last
  if (scan.folders.size > MAX_FOLDERS) scan.folders.delete(scan.folders.values().next().value);
}
// A file the session edited (Edit, Write): its folder is one it worked in, for a worktree a script made. A folder
// already listed that holds it is kept instead, so editing many files in one repo stays one folder.
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const samePath = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
function editedIn(scan, file) {
  const f = String(file || '');
  if (!winPath(f) && !f.startsWith('/')) return;
  const dir = (winPath(f) ? path.win32 : path.posix).dirname(f), d = samePath(dir);
  sawFolder(scan, [...scan.folders].find((x) => d === samePath(x) || d.startsWith(samePath(x) + '/')) || dir);
}
export function scanLinkText(scan, text) {
  const lines = (scan.rest + text).split('\n');
  scan.rest = lines.pop(); // a line still being written
  for (const line of lines) {
    const pr = line.includes('"pr-link"'), br = line.includes('"gitBranch"') || line.includes('"tool_use"');
    const res = scan.filing.size > 0 && line.includes('"tool_result"');
    if (!pr && !br && !res) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'pr-link' && e.prUrl && !scan.prs.has(e.prUrl)) scan.prs.set(e.prUrl, { url: e.prUrl, number: e.prNumber, repo: e.prRepository, branch: scan.last });
    for (const b of branchesInEntry(e)) {
      scan.branches.add(b); scan.last = b;
      if (e.cwd && !scan.dirs.has(b)) scan.dirs.set(b, String(e.cwd));
    }
    const content = Array.isArray(e.message?.content) ? e.message.content : [];
    if (e.cwd && !scan.folders.size) { sawFolder(scan, String(e.cwd)); scan.lastFolder = String(e.cwd); }
    if (e.type === 'assistant') for (const c of content) {
      if (c?.type === 'tool_use' && EDIT_TOOLS.has(c.name)) editedIn(scan, c.input?.file_path || c.input?.notebook_path);
      if (c?.type !== 'tool_use' || !SHELL_TOOLS.has(c.name) || typeof c.input?.command !== 'string') continue;
      if (filesIssue(c.input.command)) scan.filing.add(c.id);
      const f = foldersInCommand(c.input.command, e.cwd), made = branchesInCommand(c.input.command);
      for (const d of f.folders) sawFolder(scan, d);
      if (f.last) scan.lastFolder = f.last;
      if (made.length) scan.made = made[made.length - 1];
      if (f.last) for (const b of made) scan.dirs.set(b, f.last); // the folder it was made in, not the session's own
    }
    if (e.type === 'user') for (const c of content) {
      if (c?.type !== 'tool_result' || !scan.filing.delete(c.tool_use_id)) continue;
      for (const m of resultText(c.content).matchAll(ISSUE_URL)) { const i = parseIssueUrl(m[0]); if (i) scan.issues.set(i.url, i); }
    }
  }
  return scan;
}

// A session's branches for the Details panel, the one it is on now first. here: folder -> the branch that folder
// is on now ('' for none or a trunk branch), for the folders that were asked; only folders in scan.folders count (an
// answer saved before for a folder the session only read is left out), and a branch found that way is remembered in
// the scan. The branch now is the one its latest folder is on, else the one that folder was on when last asked, else
// the last one its own commands made or switched to, else the last one seen.
export function sessionBranches(scan, here = new Map()) {
  here = new Map([...here].filter(([dir]) => scan.folders.has(dir)));
  for (const [dir, b] of here) {
    const g = goodBranch(b);
    if (!g) continue;
    scan.branches.add(g);
    if (!scan.dirs.has(g)) scan.dirs.set(g, dir);
  }
  if (scan.lastFolder && here.has(scan.lastFolder)) scan.now = { dir: scan.lastFolder, branch: goodBranch(here.get(scan.lastFolder)) };
  const now = scan.now && scan.now.dir === scan.lastFolder ? scan.now.branch : goodBranch(scan.made) || scan.last, all = [...scan.branches];
  return all.includes(now) ? { current: now, branches: [now, ...all.filter((b) => b !== now)] } : { current: '', branches: all };
}

// The GitHub issue number in a branch name, or 0: issue-12, gh-12, fix/12-typo, details-branches-317, feature/317.
// Careful with stray numbers: not a Jira key (ABC-12), a name with a number (utf-8, node-18), a date, a year, a step;
// the server also asks GitHub, and a number that is not an issue there is left out.
const NUMBER_WORDS = new Set(['utf', 'x86', 'x64', 'amd', 'arm', 'sha', 'md', 'base', 'ipv', 'es', 'py', 'python', 'node', 'net', 'php', 'java', 'http',
  'h', 'v', 'win', 'windows', 'ios', 'android', 'iso', 'mp', 'ie', 'step', 'part', 'phase', 'stage', 'round', 'try', 'attempt', 'take', 'pass', 'retry',
  'wave', 'batch', 'day', 'week', 'sprint', 'q', 'rc', 'beta', 'alpha', 'pr', 'pull', 'version', 'ver']);
export function branchIssue(branch) {
  const b = String(branch || '');
  if (ticketKeys([b]).length) return 0;
  const parts = b.toLowerCase().split('/'), last = parts.pop();
  const ok = (n) => (/^[1-9]\d{0,5}$/.test(n) && !/^(19|20)\d\d$/.test(n) ? Number(n) : 0);
  let m = last.match(/(?:^|[-_])(?:issues?|gh)[-_#]?(\d+)(?=[-_]|$)/);
  if (m) return ok(m[1]);
  if (/^\d+$/.test(last)) return parts.length ? ok(last) : 0;
  if ((m = last.match(/^(\d+)[-_][a-z]/))) return ok(m[1]);
  if ((m = last.match(/(?:^|[-_])([a-z][a-z0-9]*)[-_](\d+)$/)) && !NUMBER_WORDS.has(m[1]) && !/\d[-_.]\d+$/.test(last)) return ok(m[2]);
  return 0;
}
// One issue as GitHub's GraphQL sends it, in the shape the page shows Jira tickets: open is in progress (a session
// worked on it), closed as completed is done, closed as not planned or a duplicate is dropped, and one the sign-in
// cannot read is Unknown. ref is what the × unlinks.
export function githubTicket(i, d) {
  const status = d.state === 'OPEN' ? 'Open' : d.state !== 'CLOSED' ? 'Unknown' : d.stateReason === 'NOT_PLANNED' ? 'Not planned' : d.stateReason === 'DUPLICATE' ? 'Duplicate' : 'Closed';
  return { kind: 'github', ref: i.url, key: `#${i.number}`, url: i.url, repo: i.repo, summary: d.title || '', status,
    category: d.state === 'OPEN' ? 'indeterminate' : status === 'Closed' ? 'done' : status === 'Unknown' ? 'unknown' : 'dropped' };
}
// Jira and Azure DevOps only say new / indeterminate / done; blocked and dropped come from the status name.
const BLOCKED_NAMES = ['blocked', 'on hold', 'on-hold', 'hold'];
const DROPPED_NAMES = ['removed', 'cut', "won't do", "won't fix", 'wont do', 'wont fix', 'cancelled', 'canceled', 'duplicate', 'rejected', 'not planned', 'declined', 'abandoned', 'obsolete'];
export function categoryByName(name) {
  const n = String(name || '').trim().toLowerCase().replace(/[\u2018\u2019]/g, "'");
  return BLOCKED_NAMES.includes(n) ? 'blocked' : DROPPED_NAMES.includes(n) ? 'dropped' : '';
}
// A ticket that will not move again (done or dropped): checked less often, and its comments not polled.
export const ticketFinished = (category) => category === 'done' || category === 'dropped';

// The ticket keys in branch names. keys: the company's Jira project keys (any case in the branch), or none for any
// key-shaped word in capitals.
export function ticketKeys(branches, keys) {
  const list = (keys || []).map((k) => String(k).trim().toUpperCase()).filter((k) => /^[A-Z][A-Z0-9_]+$/.test(k));
  const re = list.length ? new RegExp(String.raw`(?<![A-Za-z0-9])(${list.join('|')})-(\d+)(?!\d)`, 'gi') : /(?<![A-Za-z0-9])([A-Z][A-Z0-9]+)-(\d+)(?!\d)/g;
  const out = new Set();
  for (const b of branches) for (const m of String(b).matchAll(re)) out.add(`${m[1].toUpperCase()}-${m[2]}`);
  return [...out];
}
export const isTicketKey = (k) => /^[A-Z][A-Z0-9_]+-\d+$/.test(String(k || ''));

// ---------- GitHub by branch ----------
// A folder's remote as owner/name when it is on GitHub (https, ssh, or git@github.com:owner/name.git), else ''.
export function githubRepo(remote) {
  const m = String(remote || '').trim().match(/^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : '';
}
// GitHub's state in the chip styles: open, conflict, merged, closed, unknown.
export const ghStatus = (d) => d?.state === 'MERGED' ? 'merged' : d?.state === 'CLOSED' ? 'closed'
  : d?.state === 'OPEN' ? (d.mergeable === 'CONFLICTING' ? 'conflict' : 'open') : 'unknown';
// The issues a pull request closes (Fixes #N in its description, or linked by hand on GitHub), asked in the same
// query as its status, for the Tickets list. The server takes closes off before the page sees the pull request.
export const CLOSES = 'closingIssuesReferences(first: 10) { nodes { number repository { nameWithOwner } } }';
export const closesOf = (d) => (d?.closingIssuesReferences?.nodes || []).filter((i) => i?.repository?.nameWithOwner && i.number)
  .map((i) => parseIssueUrl(`https://github.com/${i.repository.nameWithOwner}/issues/${i.number}`));
// One GraphQL query for the pull requests opened from each { repo, branch }, open or finished.
export function ghBranchQuery(pairs) {
  return 'query { ' + pairs.map(({ repo, branch }, n) => {
    const [owner, name] = repo.split('/');
    return `b${n}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequests(headRefName: ${JSON.stringify(branch)}, first: 20, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { number url state isDraft mergeable title headRefName ${CLOSES} } } }`;
  }).join(' ') + ' }';
}
// Its answer per pair: the pull requests, or null where GitHub could not say (no such repo, no access).
export function ghBranchAnswer(pairs, data) {
  return pairs.map(({ repo }, n) => {
    const nodes = data?.[`b${n}`]?.pullRequests?.nodes;
    if (!Array.isArray(nodes)) return null;
    return nodes.map((d) => ({ kind: 'github', url: d.url, number: d.number, repo, status: ghStatus(d), draft: !!d.isDraft, title: d.title || '', branch: d.headRefName || '', closes: closesOf(d) }));
  });
}

// Which gh account can read a repo. gh asks as its active account, which may not see another account's private
// repos. How many repos GitHub could not find or would not show in a GraphQL answer: errors on a repository itself
// (the path is just its alias), not on a pull request or issue number inside one.
export function ghUnreadable(json) {
  return (json?.errors || []).filter((e) => Array.isArray(e?.path) && e.path.length === 1 && /^(NOT_FOUND|FORBIDDEN)$/.test(e.type || '')).length;
}
// The github.com accounts `gh auth status` lists, as { login, active }.
export function ghAccounts(text) {
  const out = [];
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/Logged in to (\S+) (?:account|as) ([\w-]+)/);
    if (m) { cur = m[1].toLowerCase() === 'github.com' ? { login: m[2], active: false } : null; if (cur) out.push(cur); }
    else if (cur && /Active account: true/.test(line)) cur.active = true;
  }
  return out;
}
// The accounts to try for a repo owner after the active one: first the one named like the owner, then the rest.
export function ghAccountOrder(owner, accounts) {
  const o = String(owner || '').toLowerCase();
  const rest = (accounts || []).filter((a) => !a.active);
  return [...rest.filter((a) => a.login.toLowerCase() === o), ...rest.filter((a) => a.login.toLowerCase() !== o)].map((a) => a.login);
}

// The desk's default when ghDefault is not set: the one signed-in account that is not the active one.
// With none or several there is no default, so '' and the active account stays.
export function ghDerivedDefault(accounts) {
  const rest = (accounts || []).filter((a) => !a.active);
  return rest.length === 1 ? rest[0].login : '';
}

// Which signed-in account a session runs gh as: the one named like the repo owner, else the one this group
// used last, else the desk's default: ghDefault when set, else the only other signed-in account. Each
// must be signed in (in accounts). { login, why }; login '' means none, so the active account stays.
export function ghPick({ owner, accounts, groupLast, companyDefault }) {
  const has = (n) => (accounts || []).find((a) => n && a.login.toLowerCase() === String(n).toLowerCase())?.login;
  let login = has(owner);
  if (login) return { login, why: `repo owner ${owner}` };
  if ((login = has(groupLast))) return { login, why: 'the account this group used last' };
  if ((login = has(companyDefault))) return { login, why: "the desk's default account (set in its settings)" };
  if ((login = has(ghDerivedDefault(accounts)))) return { login, why: "the desk's default account (worked out: its only other sign-in)" };
  return { login: '', why: 'no match, so the active account' };
}

// ---------- Azure DevOps ----------
// The organization as typed (a name, https://dev.azure.com/<name> or https://<name>.visualstudio.com), as a base URL.
export function adoBase(org) {
  const o = String(org || '').trim().replace(/\/+$/, '');
  if (!o) return '';
  if (/^https:\/\//i.test(o)) return o;
  return /^[\w.-]+$/.test(o) ? `https://dev.azure.com/${o}` : '';
}
// A pull request's page: https://dev.azure.com/<org>/<project>/_git/<repo>/pullrequest/<id> (or <org>.visualstudio.com/...).
export function parseAdoPrUrl(url) {
  const m = String(url || '').trim().match(/^(https:\/\/dev\.azure\.com\/[^/]+|https:\/\/[^/]+\.visualstudio\.com)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/i);
  if (!m) return null;
  return { base: m[1], project: decodeURIComponent(m[2]), repo: decodeURIComponent(m[3]), number: Number(m[4]) };
}
export const adoPrPage = (base, project, repo, id) => `${base}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${id}`;
// One pull request as Azure DevOps sends it, in the shape the page shows GitHub ones.
export function adoPR(base, project, p) {
  const repo = p?.repository?.name || '';
  const status = p?.status === 'completed' ? 'merged' : p?.status === 'abandoned' ? 'closed'
    : p?.status === 'active' ? (p.mergeStatus === 'conflicts' ? 'conflict' : 'open') : 'unknown';
  return { kind: 'ado', url: adoPrPage(base, p?.repository?.project?.name || project, repo, p?.pullRequestId), number: p?.pullRequestId,
    repo: `${p?.repository?.project?.name || project}/${repo}`, status, draft: !!p?.isDraft, title: p?.title || '', branch: String(p?.sourceRefName || '').replace(/^refs\/heads\//, '') };
}
const basic = (user, secret) => 'Basic ' + Buffer.from(`${user}:${secret}`).toString('base64');
async function getJson(fetchFn, url, auth) {
  const r = await fetchFn(url, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}
// Pull requests whose source branch is this one, in any repository of the project, open or finished.
export async function adoPRsForBranch({ base, project, pat, branch, fetchFn = fetch }) {
  const q = `searchCriteria.sourceRefName=${encodeURIComponent('refs/heads/' + branch)}&searchCriteria.status=all&api-version=7.1`;
  const d = await getJson(fetchFn, `${base}/${encodeURIComponent(project)}/_apis/git/pullrequests?${q}`, basic('', pat));
  return (d.value || []).map((p) => adoPR(base, project, p));
}
export async function adoPRById({ base, project, repo, number, pat, fetchFn = fetch }) {
  const p = await getJson(fetchFn, `${base}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests/${number}?api-version=7.1`, basic('', pat));
  return adoPR(base, project, p);
}

// ---------- Azure DevOps work items ----------
// Kept as tickets with the key AB#<id>, the form Azure DevOps itself uses in commit messages.
export const adoItemKey = (id) => `AB#${id}`;
export const isAdoItemKey = (k) => /^AB#[1-9]\d{0,8}$/.test(String(k || ''));
// The work item numbers in branch names: AB#123 anywhere, or a number that starts a part of the name and is followed by
// a word (123-some-name, feature/123-x, 123_x). A bare number part (bug/123) counts only after a work kind, so
// release/2024 or hotfix/3 is left out; so are numbers followed by more digits (2026-10-28) or inside a word (ABC-12, v2).
const ITEM_KINDS = new Set(['feature', 'features', 'feat', 'bug', 'bugs', 'bugfix', 'fix', 'task', 'tasks', 'story', 'stories', 'userstory', 'pbi', 'wi', 'workitem', 'item', 'issue', 'issues', 'ticket']);
export function adoWorkItemIds(branches) {
  const out = new Set();
  for (const b of branches) {
    const s = String(b);
    for (const m of s.matchAll(/(?<![A-Za-z0-9])AB#([1-9]\d{0,8})(?!\d)/gi)) out.add(Number(m[1]));
    const parts = s.split('/');
    parts.forEach((p, i) => {
      let m = p.match(/^([1-9]\d{0,8})[-_][A-Za-z]/);
      if (!m && i > 0 && ITEM_KINDS.has(parts[i - 1].toLowerCase())) m = p.match(/^([1-9]\d{0,8})$/);
      if (m) out.add(Number(m[1]));
    });
  }
  return [...out];
}
// A work item's page (…/<project>/_workitems/edit/<id>, or …/_workitems?id=<id>), or AB#<id> / #<id>, as its key.
export function adoItemKeyFrom(text) {
  const t = String(text || '').trim();
  const m = t.match(/^https:\/\/(?:dev\.azure\.com\/[^/]+|[^/]+\.visualstudio\.com)\/.*?(?:_workitems\/edit\/|_workitems\/?\?(?:.*&)?id=|_apis\/wit\/workitems\/)([1-9]\d{0,8})(?!\d)/i)
    || t.match(/^(?:AB)?#([1-9]\d{0,8})$/i);
  return m ? adoItemKey(m[1]) : '';
}
export const adoItemPage = (base, project, id) => `${base}/${encodeURIComponent(project)}/_workitems/edit/${id}`;
// A state's category from its name, for when Azure DevOps cannot say (the names of its own processes).
const STATE_NAMES = { new: ['new', 'to do', 'proposed', 'approved', 'open', 'design'], indeterminate: ['active', 'in progress', 'committed', 'doing', 'resolved', 'ready', 'in review', 'testing'], done: ['done', 'closed', 'completed'] };
export function adoCategory(stateCategory, name) {
  const c = categoryByName(name) || { Proposed: 'new', InProgress: 'indeterminate', Resolved: 'indeterminate', Completed: 'done', Removed: 'dropped' }[stateCategory];
  if (c) return c;
  const n = String(name || '').trim().toLowerCase();
  return Object.keys(STATE_NAMES).find((k) => STATE_NAMES[k].includes(n)) || 'unknown';
}
// One work item as Azure DevOps sends it, in the shape the page shows Jira tickets (plus its type).
export function adoWorkItem(base, w, categories) {
  const f = w?.fields || {}, status = f['System.State'] || '', type = f['System.WorkItemType'] || '';
  return { kind: 'ado', key: adoItemKey(w?.id), id: w?.id, url: adoItemPage(base, f['System.TeamProject'] || '', w?.id), summary: f['System.Title'] || '',
    type, status, project: f['System.TeamProject'] || '', comments: Number(f['System.CommentCount']) || 0, category: adoCategory(categories?.get?.(`${f['System.TeamProject']}|${type}`)?.get(status), status) };
}
// The work items linked to one pull request: their numbers.
export async function adoPRWorkItemIds({ base, project, repo, number, pat, fetchFn = fetch }) {
  const d = await getJson(fetchFn, `${base}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullRequests/${number}/workitems?api-version=7.1`, basic('', pat));
  return (d.value || []).map((w) => Number(w.id)).filter((n) => n > 0);
}
// A work item type's states and their categories: state name -> Proposed / InProgress / Resolved / Completed / Removed.
export async function adoTypeStates({ base, project, type, pat, fetchFn = fetch }) {
  const d = await getJson(fetchFn, `${base}/${encodeURIComponent(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states?api-version=7.1`, basic('', pat));
  return new Map((d.value || []).map((s) => [s.name, s.category]));
}
// Many work items, 200 to a request; a number Azure DevOps does not know (or this token may not see) is left out.
// categories: a Map of project|type -> state categories, filled as types are met, so each type is asked once.
export async function adoWorkItems({ base, pat, ids, categories = new Map(), fetchFn = fetch }) {
  const items = [];
  for (let i = 0; i < ids.length; i += 200) {
    const q = `ids=${ids.slice(i, i + 200).join(',')}&fields=System.Title,System.State,System.WorkItemType,System.TeamProject,System.CommentCount&errorPolicy=omit&api-version=7.1`;
    const d = await getJson(fetchFn, `${base}/_apis/wit/workitems?${q}`, basic('', pat));
    items.push(...(d.value || []).filter((w) => w?.id));
  }
  for (const w of items) {
    const project = w.fields?.['System.TeamProject'], type = w.fields?.['System.WorkItemType'], k = `${project}|${type}`;
    if (!project || !type || categories.has(k)) continue;
    try { categories.set(k, await adoTypeStates({ base, project, type, pat, fetchFn })); } catch { categories.set(k, new Map()); }
  }
  return items.map((w) => adoWorkItem(base, w, categories));
}

// ---------- Jira ----------
// One ticket as Jira sends it: its status name, and new / indeterminate / done (or blocked / dropped by name) for the color. lastComment is who
// wrote the newest comment and when (never its text); byMe when that is the signed-in user's accountId, me.
export function jiraTicket(url, issue, me) {
  const st = issue?.fields?.status;
  const cat = st?.statusCategory?.key;
  let last = null;
  for (const c of issue?.fields?.comment?.comments || []) if (Date.parse(c?.created) && (!last || Date.parse(c.created) > Date.parse(last.created))) last = c;
  // byMe null: who "me" is is not known, so the comment is never called someone else's
  const lastComment = last ? { by: last.author?.displayName || '', byMe: me ? last.author?.accountId === me : null, at: Date.parse(last.created) } : null;
  return { key: issue?.key, url: `${String(url).replace(/\/+$/, '')}/browse/${issue?.key}`, summary: issue?.fields?.summary || '',
    status: st?.name || '', category: categoryByName(st?.name) || (['new', 'indeterminate', 'done'].includes(cat) ? cat : 'unknown'), lastComment };
}
// The signed-in Jira user's accountId, for telling their comments from others'.
export async function jiraMe({ url, user, token, fetchFn = fetch }) {
  return (await getJson(fetchFn, `${String(url).replace(/\/+$/, '')}/rest/api/3/myself`, basic(user, token))).accountId || '';
}
// Unread: the newest comment is someone else's and came after the user last opened the ticket from Docket (seen).
export const ticketUnread = (t, seen) => t?.lastComment?.byMe === false && !(seen >= t.lastComment.at);
// Many tickets in one search; a key Jira does not know is left out.
export async function jiraTickets({ url, user, token, keys, me, fetchFn = fetch }) {
  const base = String(url).replace(/\/+$/, ''), out = [];
  for (let i = 0; i < keys.length; i += 50) {
    const jql = `key in (${keys.slice(i, i + 50).join(', ')})`;
    const d = await getJson(fetchFn, `${base}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=status,summary,comment&maxResults=100`, basic(user, token));
    for (const issue of d.issues || []) {
      // a search may cut a long list of comments short: then ask for the newest one alone
      const c = issue?.fields?.comment;
      if (c && c.total > (c.comments || []).length) {
        try { c.comments = (await getJson(fetchFn, `${base}/rest/api/3/issue/${issue.key}/comment?orderBy=-created&maxResults=1`, basic(user, token))).comments || c.comments; } catch {}
      }
      out.push(jiraTicket(base, issue, me));
    }
  }
  return out;
}
// The Jira sign-in a company's Claude home already has: the env of its "jira" MCP server (top level, else any project's).
export function jiraFromClaudeJson(j) {
  const pick = (m) => { const env = m?.jira?.env; return env?.JIRA_URL && env.JIRA_USERNAME && env.JIRA_API_TOKEN ? { url: env.JIRA_URL, user: env.JIRA_USERNAME, token: env.JIRA_API_TOKEN } : null; };
  return pick(j?.mcpServers) || Object.values(j?.projects || {}).map((p) => pick(p?.mcpServers)).find(Boolean) || null;
}
// ---------- Comments waiting on the user ----------
// Who wrote a comment and when, never its text: { by, byMe, at }, byMe null when who "me" is is not known.
const said = (by, mine, at) => (Date.parse(at) ? { by: by || '', byMe: mine, at: Date.parse(at) } : null);
const newest = (list) => list.filter(Boolean).reduce((a, c) => (!a || c.at > a.at ? c : a), null);
// A thread or comment waits on the user when its newest comment is someone else's and came after they last opened the
// item from Docket (seen); the same rule as ticketUnread.
const waits = (c, seen) => c?.byMe === false && !(seen >= c.at);
// A pull request's waiting talk: { threads, comment, by, at } (open threads waiting, whether a conversation comment
// waits, and the newest of those), or null. threads: the newest comment of each open thread; comment: the newest
// conversation comment.
export function prTalk(t, seen) {
  const comment = t?.comment || null, open = (t?.threads || []).filter((c) => waits(c, seen)), plain = waits(comment, seen) ? comment : null;
  const last = newest([...open, plain]);
  return last ? { threads: open.length, comment: !!plain, by: last.by, at: last.at } : null;
}
// An Azure DevOps identity that is a person: not a service one, such as the build service the AI review posts as
// (no uniqueName on pull request threads; Build\<id> and a svc. descriptor on work items).
const adoPerson = (a) => !!a?.uniqueName && !/^Build\\/i.test(a.uniqueName) && !/^svc\./.test(a.descriptor || '');
// Azure DevOps threads, as the threads API sends them: the active ones, each as its newest comment by a person. A
// system comment (votes, pushes, policy) or a service identity's is not a person's, so a thread with only those does
// not count. me: the signed-in identity's id.
export function adoThreadLasts(threads, me) {
  const person = (c) => c && !c.isDeleted && c.commentType !== 'system' && adoPerson(c.author);
  return (threads || []).filter((t) => t?.status === 'active' && !t.isDeleted).map((t) => newest((t.comments || []).filter(person)
    .map((c) => said(c.author.displayName, me ? c.author.id === me : null, c.publishedDate)))).filter(Boolean);
}
// GitHub: the GraphQL fields asked for a pull request's or an issue's talk, and its newest comment (not a bot's) by login.
export const GH_TALK_PR = 'reviewThreads(last: 50) { nodes { isResolved comments(last: 1) { nodes { author { login } createdAt } } } } comments(last: 5) { nodes { author { __typename login } createdAt } }';
export const GH_TALK_ISSUE = 'comments(last: 5) { nodes { author { __typename login } createdAt } }';
const ghSaid = (c, me) => said(c?.author?.login || 'ghost', me ? String(c?.author?.login || '').toLowerCase() === String(me).toLowerCase() : null, c?.createdAt);
const ghNewestComment = (d, me) => newest((d?.comments?.nodes || []).filter((c) => c?.author?.__typename !== 'Bot').map((c) => ghSaid(c, me)));
export function ghPrTalkOf(d, me) {
  return { threads: (d?.reviewThreads?.nodes || []).filter((t) => t && !t.isResolved).map((t) => ghSaid(t.comments?.nodes?.[0], me)).filter(Boolean),
    comment: ghNewestComment(d, me) };
}
export const ghIssueLast = (d, me) => ghNewestComment(d, me);
// An Azure DevOps work item comment, as the comments API sends it (createdBy, createdDate); null for a service's.
export const adoItemLast = (c, me) => (c && adoPerson(c.createdBy) ? said(c.createdBy.displayName, me ? c.createdBy.id === me : null, c.createdDate) : null);
// Its newest comment by a person, from the newest few.
export async function adoItemNewestComment({ base, project, id, pat, me, fetchFn = fetch }) {
  const d = await getJson(fetchFn, `${base}/${encodeURIComponent(project)}/_apis/wit/workItems/${id}/comments?$top=10&order=desc&api-version=7.1-preview.4`, basic('', pat));
  return newest((d.comments || []).filter((c) => !c.isDeleted).map((c) => adoItemLast(c, me)));
}
export async function adoPrThreads({ base, project, repo, number, pat, fetchFn = fetch }) {
  return (await getJson(fetchFn, `${base}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullRequests/${number}/threads?api-version=7.1`, basic('', pat))).value || [];
}
// The signed-in Azure DevOps identity's id.
export async function adoMe({ base, pat, fetchFn = fetch }) {
  return (await getJson(fetchFn, `${base}/_apis/connectionData`, basic('', pat))).authenticatedUser?.id || '';
}

// How long a status stays good: a couple of minutes while it can still move, an hour once finished.
export const linkTtl = (done) => (done ? 3600000 : 120000);
