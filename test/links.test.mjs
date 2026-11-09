// Tests for links.mjs: the Jira tickets and Azure DevOps pull requests a session row shows. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newLinkScan, scanLinkText, branchesInCommand, ticketKeys, adoBase, parseAdoPrUrl, adoPR, adoPRsForBranch, adoWorkItemIds, adoItemKeyFrom, adoCategory, adoPRWorkItemIds, adoWorkItems, jiraTicket, jiraTickets, ticketFinished, jiraMe, ticketUnread, jiraFromClaudeJson, githubRepo, ghStatus, ghBranchQuery, ghBranchAnswer,
  filesIssue, parseIssueUrl, branchIssue, githubTicket, closesOf, ghUnreadable, ghAccounts, ghAccountOrder, ghPick, ghNote, ghDerivedDefault, foldersInCommand, sessionBranches, sessionMadePr } from '../links.mjs';

const fixture = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures', 'session-links.jsonl'), 'utf8');

test('branches come from gitBranch and the session\'s own git commands, never from text it read or wrote', () => {
  const scan = scanLinkText(newLinkScan(), fixture);
  assert.deepEqual([...scan.branches].sort(), ['bugfix/ABC-31-typo', 'feature/ABC-12-sweep-limits']);
  assert.deepEqual([...scan.prs.values()], [{ url: 'https://github.com/example/repo/pull/7', number: 7, repo: 'example/repo', branch: 'bugfix/ABC-31-typo' }]); // the branch it was on
  assert.deepEqual(ticketKeys(scan.branches), ['ABC-12', 'ABC-31']);
});

test('a file read in pieces finds the same as one read whole', () => {
  const scan = newLinkScan();
  const cut = fixture.indexOf('\n', fixture.length / 2) + 1;
  scanLinkText(scan, fixture.slice(0, cut));
  scanLinkText(scan, fixture.slice(cut));
  assert.deepEqual([...scan.branches].sort(), ['bugfix/ABC-31-typo', 'feature/ABC-12-sweep-limits']);
});

test('GitHub issues: the ones its own gh issue create filed, never ones it viewed or a commit message named', () => {
  const scan = scanLinkText(newLinkScan(), fixture);
  assert.deepEqual([...scan.issues.keys()], ['https://github.com/example/repo/issues/41']);
  assert.equal(scan.filing.size, 0);
  const cut = fixture.indexOf('"tool_use_id":"t6"');
  const pieces = newLinkScan();
  scanLinkText(pieces, fixture.slice(0, cut)); // the command read, its output not yet written
  assert.equal(pieces.filing.size, 1);
  scanLinkText(pieces, fixture.slice(cut));
  assert.deepEqual([...pieces.issues.keys()], ['https://github.com/example/repo/issues/41']);
});

test('which shell commands file an issue', () => {
  assert.equal(filesIssue('cd w && GH_TOKEN=$(gh auth token) gh issue create --title "A" -m v1'), true);
  assert.equal(filesIssue('gh -R a/b issue create --body-file x'), true);
  assert.equal(filesIssue('gh issue view 3; gh issue list'), false);
  assert.equal(filesIssue('git commit -m "run gh issue create"'), false);
  assert.equal(filesIssue('echo gh issue create'), false);
  assert.equal(filesIssue('node -e "fs.writeFileSync(f, \'gh issue create\')"'), false);
  assert.equal(filesIssue('export GH_TOKEN=$(gh auth token --user me)\ngh issue create --title A'), true);
  assert.equal(filesIssue('GH_TOKEN=$(gh auth token --user me) gh issue create --title A'), true);
  assert.equal(filesIssue('& gh.exe issue create --title A'), true);
});

test('GitHub issue addresses and repositories', () => {
  assert.deepEqual(parseIssueUrl('https://github.com/a/b.c/issues/012#issuecomment-1'), { url: 'https://github.com/a/b.c/issues/12', repo: 'a/b.c', number: 12 });
  assert.equal(parseIssueUrl('https://github.com/a/b/pull/3'), null);
  assert.equal(parseIssueUrl('#3'), null);
  assert.equal(githubRepo('https://github.com/pat/docket.git\n'), 'pat/docket');
  assert.equal(githubRepo('git@github.com:a/b.git'), 'a/b');
  assert.equal(githubRepo('https://x-access-token:t@github.com/a/b'), 'a/b');
  assert.equal(githubRepo('https://dev.azure.com/o/p/_git/r'), '');
});

test('the issue number in a branch name, and not stray numbers', () => {
  const want = { 'details-branches-317': 317, 'gh-issue-tickets-327': 327, 'fix/12-typo': 12, 'feature/317': 317, 'issue-5': 5, 'gh-9-x': 9, 'claude/sidebar-fix-44': 44 };
  for (const [b, n] of Object.entries(want)) assert.equal(branchIssue(b), n, b);
  for (const b of ['fix-utf-8', 'node-18', 'feature/ABC-12', 'ABC-12-x', 'report-2026', '2026-10-28-notes', 'step-2', '317', 'main', 'v1.2-3', 'x-1-2', 'fix-007', 'big-1234567', 'claude/fix-thing'])
    assert.equal(branchIssue(b), 0, b);
});

test('a GitHub issue shows like a Jira ticket: open in progress, completed done, not planned grey', () => {
  const i = parseIssueUrl('https://github.com/a/b/issues/7');
  assert.deepEqual(githubTicket(i, { state: 'OPEN', title: 'T' }),
    { kind: 'github', ref: i.url, key: '#7', url: i.url, repo: 'a/b', summary: 'T', status: 'Open', category: 'indeterminate' });
  assert.deepEqual([githubTicket(i, { state: 'CLOSED', stateReason: 'COMPLETED' }), githubTicket(i, { state: 'CLOSED', stateReason: 'NOT_PLANNED' })].map((t) => [t.status, t.category]),
    [['Closed', 'done'], ['Not planned', 'dropped']]);
  assert.equal(githubTicket(i, { state: 'CLOSED', stateReason: 'DUPLICATE' }).category, 'dropped');
  assert.deepEqual([githubTicket(i, { state: 'UNKNOWN' })].map((t) => [t.status, t.category]), [['Unknown', 'unknown']]); // the sign-in cannot read it
});

test('git commands that make or push a branch', () => {
  assert.deepEqual(branchesInCommand('git worktree add ../w/x -b feature/X-1-a master'), ['feature/X-1-a']);
  assert.deepEqual(branchesInCommand('git checkout -B fix/y && git switch --create fix/z'), ['fix/y', 'fix/z']);
  assert.deepEqual(branchesInCommand('git -C repo push --set-upstream origin "feature/q"'), ['feature/q']);
  assert.deepEqual(branchesInCommand('git push origin +local:refs/heads/remote-name'), ['remote-name']);
  assert.deepEqual(branchesInCommand('git push'), []);
  assert.deepEqual(branchesInCommand('git push origin master; git checkout -b develop; git switch -c HEAD'), []);
  assert.deepEqual(branchesInCommand('echo "checkout -b not-git"'), []);
});

test('git checkout and git switch to a branch that already exists, but not to files or commits', () => {
  assert.deepEqual(branchesInCommand('git checkout feature/a-1'), ['feature/a-1']);
  assert.deepEqual(branchesInCommand('cd ../w && git switch --track fix-2; git -C x checkout -q "gh-405-x"'), ['fix-2', 'gh-405-x']);
  for (const c of ['git checkout -- a.js', 'git checkout src/a.js', 'git checkout ./lib', 'git checkout .', 'git checkout HEAD~1', 'git checkout abc1234',
    'git checkout origin/x', 'git checkout main', 'git switch -', 'git checkout fix-2 links.mjs', 'git checkout --detach v2', 'git checkout -p x', 'git stash; echo checkout fix-3'])
    assert.deepEqual(branchesInCommand(c), [], c);
  assert.deepEqual(branchesInCommand('git checkout -b new-1 && git switch -c new-2'), ['new-1', 'new-2']); // made, counted once
});

test('the folders a shell command did branch work in, each from the one before', () => {
  const home = 'V:\\Repos\\docket';
  assert.deepEqual(foldersInCommand('cd ../docket-work/x && npm test', home), { folders: [], last: 'V:\\Repos\\docket-work\\x' });
  assert.deepEqual(foldersInCommand('Set-Location "V:/Repos/a b"; git status', home), { folders: [], last: 'V:\\Repos\\a b' });
  assert.deepEqual(foldersInCommand('cd /v/Repos/y && git log', home).last, 'V:\\Repos\\y'); // Git Bash
  assert.deepEqual(foldersInCommand('pushd sub; git -C ../other status', home), { folders: [], last: 'V:\\Repos\\docket\\other' });
  assert.deepEqual(foldersInCommand('git worktree add -b fix-1 ../docket-work/fix-1 master', home), { folders: ['V:\\Repos\\docket-work\\fix-1'], last: 'V:\\Repos\\docket-work\\fix-1' });
  assert.deepEqual(foldersInCommand('git -C /r/app worktree add --reason why ../w', '/home/u'), { folders: ['/r/w'], last: '/r/w' });
  assert.deepEqual(foldersInCommand('git status', '/home/u'), { folders: [], last: '/home/u' }); // git in its own folder
  assert.deepEqual(foldersInCommand('npm test', '/home/u'), { folders: [], last: '' });
  assert.deepEqual(foldersInCommand('cd $env:TEMP; cd ~/x; cd -', '/home/u'), { folders: [], last: '' });
  assert.deepEqual(foldersInCommand('cd rel', ''), { folders: [], last: '' }); // nothing to start from
  // read-only git in another repo is not branch work there; commit, push, checkout and gh pr create are
  assert.deepEqual(foldersInCommand('cd "V:/Repos/COS/cos-environment"; git fetch -q origin master; git grep -n Foo origin/master', home),
    { folders: [], last: 'V:\\Repos\\COS\\cos-environment' });
  assert.deepEqual(foldersInCommand('cd /r/b && git log --oneline && git diff && git show HEAD && git status', '/r/a').folders, []);
  assert.deepEqual(foldersInCommand('cd /r/b && git add -A && git commit -m "x" && git push -u origin fix-2', '/r/a').folders, ['/r/b']);
  assert.deepEqual(foldersInCommand('git -C /r/c checkout feature/y', '/r/a').folders, ['/r/c']);
  assert.deepEqual(foldersInCommand('cd /r/d; gh pr create --fill', '/r/a').folders, ['/r/d']);
});

test('a folder the session only read never adds its branch, even one saved before', () => {
  const entry = (content) => JSON.stringify({ type: 'assistant', cwd: '/r/own', gitBranch: 'PROJ-1170-mine', message: { content } });
  const bash = (cmd) => entry([{ type: 'tool_use', id: 't', name: 'Bash', input: { command: cmd } }]);
  const scan = scanLinkText(newLinkScan(), [bash('cd "/r/cos-environment"; git fetch -q origin master; git grep -n Foo origin/master')].join('\n') + '\n');
  assert.deepEqual([...scan.folders], ['/r/own']);
  // an answer saved by an older Docket for the folder it only read is left out
  const saved = new Map([['/r/own', 'PROJ-1170-mine'], ['/r/cos-environment', 'feature/PROJ-966']]);
  assert.deepEqual(sessionBranches(scan, saved), { current: 'PROJ-1170-mine', branches: ['PROJ-1170-mine'] });
  assert.deepEqual(ticketKeys(sessionBranches(scan, saved).branches), ['PROJ-1170']);
  // a commit and push in another folder: that folder's branch is the session's
  scanLinkText(scan, bash('cd /r/other && git commit -am "x" && git push') + '\n');
  assert.deepEqual([...scan.folders], ['/r/own', '/r/other']);
  assert.deepEqual(sessionBranches(scan, new Map([...saved, ['/r/other', 'PROJ-1200-other']])).branches, ['PROJ-1200-other', 'PROJ-1170-mine']);
  // files edited in a folder count it once, under the folder already listed that holds them
  scanLinkText(scan, entry([{ type: 'tool_use', id: 'e', name: 'Edit', input: { file_path: '/r/w/x/src/a.js' } }, { type: 'tool_use', id: 'f', name: 'Write', input: { file_path: '/r/other/b/c.js' } }]) + '\n');
  assert.deepEqual([...scan.folders], ['/r/own', '/r/w/x/src', '/r/other']);
});

test('the branch a session is on now: its latest folder\'s, listed first', () => {
  const tool = (cmd) => JSON.stringify({ type: 'assistant', cwd: '/r/app', gitBranch: 'start-1', message: { content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: cmd } }] } });
  const edit = JSON.stringify({ type: 'assistant', cwd: '/r/app', gitBranch: 'start-1', message: { content: [{ type: 'tool_use', id: 'e', name: 'Edit', input: { file_path: '/r/w/fix-9/a.js' } }] } });
  const scan = scanLinkText(newLinkScan(), [tool('ls'), tool('powershell worktree.ps1 new app fix-9'), edit, tool('cd /r/w/fix-9 && npm test')].join('\n') + '\n');
  assert.deepEqual([...scan.folders], ['/r/app', '/r/w/fix-9']);
  assert.equal(scan.lastFolder, '/r/w/fix-9');
  // not asked yet: the last one seen, which is the start folder's
  assert.deepEqual(sessionBranches(scan), { current: 'start-1', branches: ['start-1'] });
  // asked: the script's branch is found in the folder it worked in, and is the one now
  assert.deepEqual(sessionBranches(scan, new Map([['/r/app', 'start-1'], ['/r/w/fix-9', 'fix-9']])), { current: 'fix-9', branches: ['fix-9', 'start-1'] });
  assert.equal(scan.dirs.get('fix-9'), '/r/w/fix-9');
  // remembered once found, and the one now while the latest folder is not asked again
  assert.deepEqual(sessionBranches(scan), { current: 'fix-9', branches: ['fix-9', 'start-1'] });
  // switched back to master there: nothing listed is the one now
  assert.deepEqual(sessionBranches(scan, new Map([['/r/w/fix-9', '']])), { current: '', branches: ['start-1', 'fix-9'] });
  // a later git checkout in another folder, not asked: the branch it switched to
  scanLinkText(scan, tool('git -C /r/other checkout feature/z') + '\n');
  assert.deepEqual(sessionBranches(scan), { current: 'feature/z', branches: ['feature/z', 'start-1', 'fix-9'] });
  assert.equal(scan.dirs.get('feature/z'), '/r/other');
});

test('ticket keys: the company\'s project keys in any case, else capital key-shaped words', () => {
  assert.deepEqual(ticketKeys(['feature/abc-7-x', 'feature/XYZ-8'], ['ABC']), ['ABC-7']);
  assert.deepEqual(ticketKeys(['feature/abc-7-x', 'feature/XYZ-8', 'utf-8-fix']), ['XYZ-8']);
  assert.deepEqual(ticketKeys(['ABC-12', 'ABC-12-again']), ['ABC-12']);
  assert.deepEqual(ticketKeys(['ABC-123x']), ['ABC-123']);
});

test('Azure DevOps addresses', () => {
  assert.equal(adoBase('example'), 'https://dev.azure.com/example');
  assert.equal(adoBase('https://dev.azure.com/example/'), 'https://dev.azure.com/example');
  assert.equal(adoBase('not a name'), '');
  assert.deepEqual(parseAdoPrUrl('https://dev.azure.com/example/My%20Project/_git/Repo/pullrequest/42?_a=files'),
    { base: 'https://dev.azure.com/example', project: 'My Project', repo: 'Repo', number: 42 });
  assert.deepEqual(parseAdoPrUrl('https://example.visualstudio.com/Proj/_git/Repo/pullrequest/5'),
    { base: 'https://example.visualstudio.com', project: 'Proj', repo: 'Repo', number: 5 });
  assert.equal(parseAdoPrUrl('https://github.com/a/b/pull/1'), null);
});

test('Azure DevOps status maps to the GitHub chip styles', () => {
  const pr = (fields) => adoPR('https://dev.azure.com/example', 'Proj', { pullRequestId: 9, title: 'T', sourceRefName: 'refs/heads/feature/ABC-1', repository: { name: 'Repo', project: { name: 'Proj' } }, ...fields });
  assert.equal(pr({ status: 'active', mergeStatus: 'succeeded' }).status, 'open');
  assert.equal(pr({ status: 'active', mergeStatus: 'conflicts' }).status, 'conflict');
  assert.equal(pr({ status: 'completed' }).status, 'merged');
  assert.equal(pr({ status: 'abandoned' }).status, 'closed');
  assert.equal(pr({ status: 'notSet' }).status, 'unknown');
  const d = pr({ status: 'active', isDraft: true });
  assert.equal(d.draft, true);
  assert.deepEqual({ url: d.url, number: d.number, repo: d.repo, branch: d.branch, kind: d.kind },
    { url: 'https://dev.azure.com/example/Proj/_git/Repo/pullrequest/9', number: 9, repo: 'Proj/Repo', branch: 'feature/ABC-1', kind: 'ado' });
});

test('Azure DevOps is asked by source branch, with the token as Basic auth', async () => {
  let asked;
  const fetchFn = async (url, opts) => { asked = { url, auth: opts.headers.Authorization }; return { ok: true, json: async () => ({ value: [{ pullRequestId: 3, status: 'active', repository: { name: 'R' } }] }) }; };
  const prs = await adoPRsForBranch({ base: 'https://dev.azure.com/example', project: 'P Q', pat: 'secret', branch: 'feature/ABC-1', fetchFn });
  assert.equal(asked.url, 'https://dev.azure.com/example/P%20Q/_apis/git/pullrequests?searchCriteria.sourceRefName=refs%2Fheads%2Ffeature%2FABC-1&searchCriteria.status=all&api-version=7.1');
  assert.equal(asked.auth, 'Basic ' + Buffer.from(':secret').toString('base64'));
  assert.equal(prs[0].status, 'open');
});

test('Jira status: its name, colored by its category; unknown keys left out', async () => {
  const issue = (key, name, cat) => ({ key, fields: { summary: 'S ' + key, status: { name, statusCategory: { key: cat } } } });
  assert.deepEqual(jiraTicket('https://example.atlassian.net/', issue('ABC-1', 'Needs Code Review', 'indeterminate')),
    { key: 'ABC-1', url: 'https://example.atlassian.net/browse/ABC-1', summary: 'S ABC-1', status: 'Needs Code Review', category: 'indeterminate', lastComment: null });
  assert.equal(jiraTicket('https://x', issue('ABC-2', 'Odd', 'weird')).category, 'unknown');
  // Jira only has three categories: blocked and dropped come from the status name, whatever its category
  assert.deepEqual([['Blocked', 'indeterminate'], ['On Hold', 'new'], ["Won't Do", 'done'], ['Won\u2019t Fix', 'done'], ['Cancelled', 'done'], ['Duplicate', 'done'], ['Rejected', 'done']]
    .map(([n, c]) => jiraTicket('https://x', issue('ABC-3', n, c)).category), ['blocked', 'blocked', 'dropped', 'dropped', 'dropped', 'dropped', 'dropped']);
  let asked;
  const fetchFn = async (url) => { asked = url; return { ok: true, json: async () => ({ issues: [issue('ABC-1', 'Done', 'done')] }) }; };
  const got = await jiraTickets({ url: 'https://example.atlassian.net', user: 'u', token: 't', keys: ['ABC-1', 'ABC-404'], fetchFn });
  assert.match(decodeURIComponent(asked), /search\/jql\?jql=key in \(ABC-1, ABC-404\)&fields=status,summary,comment/);
  assert.deepEqual(got.map((t) => [t.key, t.category]), [['ABC-1', 'done']]);
});

test('Jira last comment: who and when, mine by accountId, never the text', async () => {
  const c = (id, name, created) => ({ author: { accountId: id, displayName: name, emailAddress: '' }, created, body: { secret: 'text' } });
  const issue = (comments, total) => ({ key: 'ABC-1', fields: { summary: 'S', status: { name: 'Open', statusCategory: { key: 'new' } }, comment: { comments, total: total ?? comments.length } } });
  const two = [c('me-1', 'Dana', '2026-10-28T10:00:00.000-0400'), c('tim-2', 'Pat Quinn', '2026-10-28T16:48:49.623-0400')];
  const t = jiraTicket('https://x', issue(two), 'me-1');
  assert.deepEqual(t.lastComment, { by: 'Pat Quinn', byMe: false, at: Date.parse('2026-10-28T20:48:49.623Z') });
  assert.equal(JSON.stringify(t).includes('secret'), false);
  assert.equal(jiraTicket('https://x', issue([...two].reverse()), 'me-1').lastComment.by, 'Pat Quinn'); // newest, whatever the order
  assert.equal(jiraTicket('https://x', issue([two[1], c('me-1', 'Dana', '2026-10-28T17:00:00.000-0400')]), 'me-1').lastComment.byMe, true);
  assert.equal(jiraTicket('https://x', issue(two)).lastComment.byMe, null); // who "me" is is not known
  assert.equal(jiraTicket('https://x', issue([])).lastComment, null);
  assert.equal(jiraTicket('https://x', { key: 'ABC-2', fields: {} }).lastComment, null);

  // unread: someone else's, newer than when the user last opened it; never when "me" is not known
  const at = t.lastComment.at;
  assert.equal(ticketUnread(t, undefined), true);
  assert.equal(ticketUnread(t, at - 1), true);
  assert.equal(ticketUnread(t, at), false);
  assert.equal(ticketUnread(jiraTicket('https://x', issue(two)), undefined), false);
  assert.equal(ticketUnread(jiraTicket('https://x', issue([])), undefined), false);

  // a search that cut the comments short asks for the newest one alone
  const asked = [];
  const fetchFn = async (url) => { asked.push(url); return { ok: true, json: async () => (url.includes('/comment?') ? { comments: [c('tim-2', 'Pat Quinn', '2026-10-29T09:00:00.000Z')] } : { issues: [issue(two, 40)] }) }; };
  const [got] = await jiraTickets({ url: 'https://x', user: 'u', token: 't', keys: ['ABC-1'], me: 'me-1', fetchFn });
  assert.equal(asked[1], 'https://x/rest/api/3/issue/ABC-1/comment?orderBy=-created&maxResults=1');
  assert.equal(got.lastComment.at, Date.parse('2026-10-29T09:00:00.000Z'));
  assert.equal(await jiraMe({ url: 'https://x/', user: 'u', token: 't', fetchFn: async (url) => ({ ok: true, json: async () => ({ accountId: url.endsWith('/rest/api/3/myself') ? 'me-1' : '' }) }) }), 'me-1');
});

test('the Jira sign-in comes from the jira MCP server in .claude.json', () => {
  const env = { JIRA_URL: 'https://example.atlassian.net', JIRA_USERNAME: 'me', JIRA_API_TOKEN: 't' };
  assert.deepEqual(jiraFromClaudeJson({ mcpServers: { jira: { env } } }), { url: env.JIRA_URL, user: 'me', token: 't' });
  assert.deepEqual(jiraFromClaudeJson({ projects: { 'C:/w': { mcpServers: { jira: { env } } } } }), { url: env.JIRA_URL, user: 'me', token: 't' });
  assert.equal(jiraFromClaudeJson({ mcpServers: { other: { env } } }), null);
  assert.equal(jiraFromClaudeJson(null), null);
});

test('Azure DevOps work item numbers in branch names, without stray numbers', () => {
  assert.deepEqual(adoWorkItemIds(['AB#123', 'feature/AB#45-thing', 'users/me/ab#6']), [123, 45, 6]);
  assert.deepEqual(adoWorkItemIds(['123-some-name', 'feature/77-x', 'bug/88', 'task/99_y']), [123, 77, 88, 99]);
  assert.deepEqual(adoWorkItemIds(['release/2024', 'hotfix/3', '2026-10-28-notes', 'feature/ABC-12-x', 'v2-fix', 'fix-123', 'feature/x12', '0-zero']), []);
  assert.deepEqual(branchesInCommand('git checkout -b feature/AB#5-x'), ['feature/AB#5-x']);
});

test('a work item from link_session: its address, AB#n or #n', () => {
  assert.equal(adoItemKeyFrom('https://dev.azure.com/example/My%20Project/_workitems/edit/321/'), 'AB#321');
  assert.equal(adoItemKeyFrom('https://example.visualstudio.com/Proj/_workitems?id=9&_a=edit'), 'AB#9');
  assert.equal(adoItemKeyFrom('ab#12'), 'AB#12');
  assert.equal(adoItemKeyFrom('#12'), 'AB#12');
  assert.equal(adoItemKeyFrom('ABC-12'), '');
  assert.equal(adoItemKeyFrom('https://dev.azure.com/example/Proj/_git/Repo/pullrequest/5'), '');
});

test('work item states color like Jira tickets', () => {
  assert.equal(adoCategory('Proposed', 'New'), 'new');
  assert.equal(adoCategory('InProgress', 'Doing'), 'indeterminate');
  assert.equal(adoCategory('Resolved', 'Resolved'), 'indeterminate');
  assert.equal(adoCategory('Completed', 'Closed'), 'done');
  assert.equal(adoCategory(undefined, 'Active'), 'indeterminate');
  assert.equal(adoCategory(undefined, 'To Do'), 'new');
  assert.equal(adoCategory(undefined, 'Something odd'), 'unknown');
  assert.equal(adoCategory('Removed', 'Removed'), 'dropped');
  assert.equal(adoCategory('Removed', 'Gone'), 'dropped'); // the Removed category, whatever the name
  assert.equal(adoCategory(undefined, 'Cut'), 'dropped');
  assert.equal(adoCategory('Completed', 'Cut'), 'dropped'); // the name wins over Completed
  assert.equal(adoCategory('InProgress', 'Blocked'), 'blocked');
  assert.equal(adoCategory(undefined, 'On Hold'), 'blocked');
});

test('done and dropped tickets are finished; the rest may still move', () => {
  assert.deepEqual(['done', 'dropped', 'new', 'indeterminate', 'blocked', 'unknown'].map(ticketFinished), [true, true, false, false, false, false]);
});

test('work items linked to a pull request, then their title, type and state', async () => {
  const asked = [];
  const reply = (body) => ({ ok: true, json: async () => body });
  const fetchFn = async (url, opts) => {
    asked.push(url);
    assert.equal(opts.headers.Authorization, 'Basic ' + Buffer.from(':secret').toString('base64'));
    if (url.includes('/pullRequests/7/workitems')) return reply({ value: [{ id: '11', url: 'x' }, { id: '12', url: 'y' }] });
    if (url.includes('/_apis/wit/workitems?')) return reply({ count: 2, value: [
      { id: 11, fields: { 'System.Title': 'Fix login', 'System.State': 'Doing', 'System.WorkItemType': 'Bug', 'System.TeamProject': 'P Q', 'System.CommentCount': 2 } },
      null,
      { id: 13, fields: { 'System.Title': 'Ship it', 'System.State': 'Closed', 'System.WorkItemType': 'Bug', 'System.TeamProject': 'P Q' } }] });
    if (url.includes('/workitemtypes/Bug/states')) return reply({ value: [{ name: 'Doing', category: 'InProgress' }, { name: 'Closed', category: 'Completed' }] });
    return { ok: false, status: 404 };
  };
  const base = 'https://dev.azure.com/example';
  assert.deepEqual(await adoPRWorkItemIds({ base, project: 'P Q', repo: 'R', number: 7, pat: 'secret', fetchFn }), [11, 12]);
  assert.equal(asked[0], 'https://dev.azure.com/example/P%20Q/_apis/git/repositories/R/pullRequests/7/workitems?api-version=7.1');
  const categories = new Map();
  const items = await adoWorkItems({ base, pat: 'secret', ids: [11, 12, 13], categories, fetchFn });
  assert.equal(asked[1], 'https://dev.azure.com/example/_apis/wit/workitems?ids=11,12,13&fields=System.Title,System.State,System.WorkItemType,System.TeamProject,System.CommentCount&errorPolicy=omit&api-version=7.1');
  assert.deepEqual(items, [
    { kind: 'ado', key: 'AB#11', id: 11, url: 'https://dev.azure.com/example/P%20Q/_workitems/edit/11', summary: 'Fix login', type: 'Bug', status: 'Doing', project: 'P Q', comments: 2, category: 'indeterminate' },
    { kind: 'ado', key: 'AB#13', id: 13, url: 'https://dev.azure.com/example/P%20Q/_workitems/edit/13', summary: 'Ship it', type: 'Bug', status: 'Closed', project: 'P Q', comments: 0, category: 'done' }]);
  assert.equal(asked.filter((u) => u.includes('/states')).length, 1); // each type asked once
  await adoWorkItems({ base, pat: 'secret', ids: [11], categories, fetchFn });
  assert.equal(asked.filter((u) => u.includes('/states')).length, 1); // and remembered
});

test('a folder\'s remote names its GitHub repo; other hosts name none', () => {
  assert.equal(githubRepo('https://github.com/pat/docket.git\n'), 'pat/docket');
  assert.equal(githubRepo('https://x-access-token:abc@github.com/Org/my.repo'), 'Org/my.repo');
  assert.equal(githubRepo('git@github.com:Org/app.git'), 'Org/app');
  assert.equal(githubRepo('ssh://git@github.com/Org/app'), 'Org/app');
  assert.equal(githubRepo('https://dev.azure.com/example/P/_git/app'), '');
  assert.equal(githubRepo(''), '');
});

test('GitHub is asked by head branch in one query, and its answer maps per branch', () => {
  const pairs = [{ repo: 'Org/app', branch: 'fix-1' }, { repo: 'Org/gone', branch: 'x"y' }];
  const q = ghBranchQuery(pairs);
  assert.match(q, /b0: repository\(owner: "Org", name: "app"\) \{ pullRequests\(headRefName: "fix-1"/);
  assert.match(q, /b1: repository\(owner: "Org", name: "gone"\) \{ pullRequests\(headRefName: "x\\"y"/);
  const data = { b0: { pullRequests: { nodes: [
    { number: 7, url: 'https://github.com/Org/app/pull/7', state: 'OPEN', isDraft: true, mergeable: 'MERGEABLE', title: 'T', headRefName: 'fix-1' },
    { number: 5, url: 'https://github.com/Org/app/pull/5', state: 'CLOSED', title: 'Old', headRefName: 'fix-1' }] } }, b1: null };
  const [found, missing] = ghBranchAnswer(pairs, data);
  assert.deepEqual(found.map((p) => [p.number, p.status, p.draft, p.branch, p.repo, p.kind]), [[7, 'open', true, 'fix-1', 'Org/app', 'github'], [5, 'closed', false, 'fix-1', 'Org/app', 'github']]);
  assert.equal(missing, null);
  assert.deepEqual(ghBranchAnswer(pairs, null), [null, null]); // GitHub could not be asked
  assert.deepEqual(ghBranchAnswer([pairs[0]], { b0: { pullRequests: { nodes: [] } } }), [[]]);
  assert.equal(ghStatus({ state: 'OPEN', mergeable: 'CONFLICTING' }), 'conflict');
  assert.equal(ghStatus({ state: 'MERGED' }), 'merged');
  assert.equal(ghStatus(undefined), 'unknown');
});

test('the same query says which issues each pull request fixes', () => {
  const pairs = [{ repo: 'Org/app', branch: 'fix-1' }];
  assert.match(ghBranchQuery(pairs), /closingIssuesReferences\(first: 10\) \{ nodes \{ number repository \{ nameWithOwner \} \} \}/);
  const refs = { nodes: [{ number: 12, repository: { nameWithOwner: 'Org/app' } }, { number: 3, repository: { nameWithOwner: 'Org/other' } }, null] };
  const [[pr]] = ghBranchAnswer(pairs, { b0: { pullRequests: { nodes: [{ number: 7, url: 'https://github.com/Org/app/pull/7', state: 'MERGED', headRefName: 'fix-1', closingIssuesReferences: refs }] } } });
  assert.deepEqual(pr.closes.map((i) => i.url), ['https://github.com/Org/app/issues/12', 'https://github.com/Org/other/issues/3']);
  assert.deepEqual(closesOf({ state: 'OPEN' }), []);
});

test('a repo the active gh account cannot read is asked as the account named like its owner, then the others', () => {
  const status = `github.com
  ✓ Logged in to github.com account workacct (keyring)
  - Active account: true
  - Token: gho_****
  ✓ Logged in to github.com account other (keyring)
  - Active account: false
  ✓ Logged in to github.com account Owner (keyring)
  - Active account: false

ghe.example.com
  ✓ Logged in to ghe.example.com account elsewhere (keyring)
  - Active account: true`;
  const accounts = ghAccounts(status);
  assert.deepEqual(accounts, [{ login: 'workacct', active: true }, { login: 'other', active: false }, { login: 'Owner', active: false }]);
  assert.deepEqual(ghAccountOrder('owner', accounts), ['Owner', 'other']); // the active one was already asked
  assert.deepEqual(ghAccountOrder('someorg', accounts), ['other', 'Owner']);
  assert.deepEqual(ghAccounts('  ✓ Logged in to github.com as olduser (oauth_token)'), [{ login: 'olduser', active: false }]); // older gh
  assert.deepEqual(ghAccountOrder('x', []), []);
  // only an error on the repository itself means it could not be read; a missing pull request or issue number does not
  const notFound = { data: { a: null, b: { name: 'x' } }, errors: [{ type: 'NOT_FOUND', path: ['a'], message: "Could not resolve to a Repository with the name 'owner/app'." }] };
  assert.equal(ghUnreadable(notFound), 1);
  assert.equal(ghUnreadable({ data: { p0: { pullRequest: null } }, errors: [{ type: 'NOT_FOUND', path: ['p0', 'pullRequest'] }] }), 0);
  assert.equal(ghUnreadable({ data: { a: null }, errors: [{ type: 'FORBIDDEN', path: ['a'] }] }), 1);
  assert.equal(ghUnreadable({ data: { a: { name: 'x' } } }), 0);
  assert.equal(ghUnreadable(null), 0);
});

test('the gh account a session runs as: repo owner, then group memory, then company default, then none', () => {
  const accounts = [{ login: 'workacct', active: true }, { login: 'Owner', active: false }, { login: 'groupacct', active: false }];
  const all = { owner: 'owner', accounts, groupLast: 'groupacct', companyDefault: 'workacct' };
  assert.deepEqual(ghPick(all), { login: 'Owner', why: 'repo owner owner' }); // owner wins, case ignored, even over memory
  assert.equal(ghPick({ ...all, owner: 'elsewhere' }).login, 'groupacct'); // no owner match: the group's last
  assert.equal(ghPick({ ...all, owner: '', groupLast: undefined }).login, 'workacct'); // none yet: the company default
  assert.equal(ghPick({ ...all, owner: 'elsewhere', groupLast: 'gone' }).login, 'workacct'); // remembered but no longer signed in
  assert.equal(ghPick({ owner: 'x', accounts, groupLast: 'gone', companyDefault: 'gone' }).login, ''); // nothing: active account stays
  assert.equal(ghPick({ owner: 'x', accounts: [] }).login, '');
});

test('the gh account note shows only in a folder whose origin is on GitHub', () => {
  const pick = { login: 'groupacct', why: 'the account this group used last' };
  assert.equal(ghNote({ owner: 'owner', ...pick }), 'GitHub account for gh: groupacct (the account this group used last).');
  assert.equal(ghNote({ owner: '', ...pick }), ''); // not a git repo, or origin on Azure DevOps
  assert.equal(ghNote({ owner: githubRepo('https://dev.azure.com/org/proj/_git/repo').split('/')[0], ...pick }), '');
  assert.equal(ghNote({ owner: 'owner', login: '', why: 'no match, so the active account' }), ''); // no pick
});

test('the company default is worked out from its sign-ins when ghDefault is not set', () => {
  const one = [{ login: 'workacct', active: true }, { login: 'other', active: false }];
  const two = [...one, { login: 'third', active: false }];
  const none = [{ login: 'workacct', active: true }];
  assert.equal(ghDerivedDefault(one), 'other');
  assert.equal(ghDerivedDefault(two), '');
  assert.equal(ghDerivedDefault(none), '');
  assert.equal(ghDerivedDefault([]), '');
  const pick = (accounts, companyDefault) => ghPick({ owner: 'x', accounts, companyDefault });
  assert.deepEqual(pick(one), { login: 'other', why: "the desk's default account (worked out: its only other sign-in)" });
  assert.equal(pick(two).login, ''); // two others: no default, the active account stays
  assert.equal(pick(none).login, '');
  assert.match(pick(two, 'third').why, /set in its settings/); // explicit still works with several
  assert.deepEqual(pick(one, 'workacct'), { login: 'workacct', why: "the desk's default account (set in its settings)" }); // explicit wins over derived
  assert.equal(ghPick({ owner: 'x', accounts: one, groupLast: 'workacct' }).login, 'workacct'); // the order is unchanged
});

// #807: the merge tag is only for a pull request the session made or pushed to.
const shell = (gitBranch, cwd, cmd) => JSON.stringify({ type: 'assistant', cwd, gitBranch, message: { content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: cmd } }] } });
test('a session that only reviews someone else\'s branch lists it but does not own it', () => {
  const b = 'feature/COSCRYPTO-1143-review-me', cwd = '/r/review';
  const scan = scanLinkText(newLinkScan(), [shell(b, cwd, 'git fetch origin'), shell(b, cwd, `git checkout ${b}`),
    shell(b, cwd, 'git diff origin/master...HEAD && git log --oneline -5'), shell(b, cwd, 'az repos pr show --id 111724')].join('\n') + '\n');
  assert.deepEqual([...scan.branches], [b]); // still shown in Details
  assert.deepEqual([...scan.own], []);
  sessionBranches(scan, new Map([[cwd, b]]));
  assert.deepEqual([...scan.own], [], 'a folder it only sits on adds no own branch');
  const pr = { kind: 'ado', url: 'https://dev.azure.com/o/P/_git/R/pullrequest/111724', branch: b, status: 'open', author: 'colleague-id' };
  assert.equal(sessionMadePr(pr, { own: scan.own, me: ['my-id'] }), false);
  assert.equal(sessionMadePr({ ...pr, author: '' }, { own: scan.own }), false, 'no author known: still not its own');
});

test('branches a session made, pushed, committed on or opened a pull request from are its own', () => {
  assert.deepEqual(branchesInCommand('git worktree add -b fix-9 ../w/fix-9 origin/master && git checkout other-1', true), ['fix-9']);
  assert.deepEqual(branchesInCommand('git push -u origin fix-10', true), ['fix-10']);
  assert.deepEqual(branchesInCommand('gh pr create --head fix-11 --fill', true), ['fix-11']);
  assert.deepEqual(branchesInCommand('az repos pr create --source-branch feature/X-12 --target-branch master', true), ['feature/X-12']);
  assert.deepEqual(branchesInCommand('git checkout feature/a-1; git switch fix-2', true), []);
  assert.deepEqual(foldersInCommand('cd /r/b && git checkout x && git commit -m y', '/r/a', true).folders, ['/r/b']);
  assert.deepEqual(foldersInCommand('git -C /r/c checkout feature/y && git worktree add ../w', '/r/a', true).folders, []);
  assert.deepEqual(foldersInCommand('az repos pr create --title t', '/r/a', true).folders, ['/r/a']);
  // a commit in its own folder: the branch it ran on; in another folder: that folder's branch once asked
  const scan = scanLinkText(newLinkScan(), [shell('PROJ-5-mine', '/r/app', 'git add -A && git commit -m "x"'),
    shell('PROJ-5-mine', '/r/app', 'cd /r/other && git commit -am y'), shell('PROJ-5-mine', '/r/app', 'git checkout -b PROJ-6 && git commit -m z')].join('\n') + '\n');
  assert.deepEqual([...scan.own].sort(), ['PROJ-5-mine', 'PROJ-6']); // PROJ-6 made by the command itself
  sessionBranches(scan, new Map([['/r/other', 'PROJ-7-other']]));
  assert.deepEqual([...scan.own].sort(), ['PROJ-5-mine', 'PROJ-6', 'PROJ-7-other']);
  // a branch it switched to in its own folder before committing does not make the old gitBranch its own
  const moved = scanLinkText(newLinkScan(), shell('their-branch', '/r/app', 'git switch mine-1 && git commit -m x') + '\n');
  assert.deepEqual([...moved.own], []);
});

test('whose pull request it is: linked or from an own branch, and not written by someone else', () => {
  const pr = { kind: 'github', url: 'https://github.com/o/r/pull/3', branch: 'Fix-1', author: 'Me' };
  assert.equal(sessionMadePr(pr, { own: new Set(['fix-1']), me: ['me', 'work-me'] }), true);
  assert.equal(sessionMadePr(pr, { own: new Set(['fix-1']) }), true, 'no logins known');
  assert.equal(sessionMadePr({ ...pr, author: 'colleague' }, { own: new Set(['fix-1']), me: ['me'] }), false, 'pushed to someone else\'s pull request');
  assert.equal(sessionMadePr(pr, { linked: new Set(['https://github.com/O/R/pull/3']) }), true, 'opened or linked by it');
  assert.equal(sessionMadePr(pr, {}), false);
  // authors come with the pull requests
  assert.equal(adoPR('https://dev.azure.com/o', 'P', { pullRequestId: 1, createdBy: { id: 'abc' }, repository: { name: 'R' } }).author, 'abc');
  assert.match(ghBranchQuery([{ repo: 'o/r', branch: 'b' }]), /author \{ login \}/);
  assert.equal(ghBranchAnswer([{ repo: 'o/r', branch: 'b' }], { b0: { pullRequests: { nodes: [{ number: 1, url: 'u', state: 'OPEN', author: { login: 'me' } }] } } })[0][0].author, 'me');
});

test('the row says merge only for an open pull request of its own', () => {
  const page = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
  const line = page.split(/\r?\n/).find((l) => l.startsWith('const openPR = '));
  const prState = (p) => p.status === 'open' && p.draft ? 'draft' : p.status;
  const S = { prs: { review: [{ status: 'open', mine: false }], own: [{ status: 'open', mine: false }, { status: 'conflict', mine: true }], done: [{ status: 'merged', mine: true }] } };
  const openPR = new Function('S', 'prState', line + '\nreturn openPR;')(S, prState);
  assert.equal(openPR('review'), false);
  assert.equal(openPR('own'), true);
  assert.equal(openPR('done'), false);
  assert.equal(openPR('none'), false);
});
