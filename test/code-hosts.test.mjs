// Tests for a desk's code hosts (#1270): parsing its folders' remotes, deciding what needs setting up, the borrowed
// Azure DevOps sign-in, and where each platform keeps the token. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adoRemote, adoOrgName, adoTokenPage, githubRepo, codeHosts, adoNeeds, githubNeeds, adoCheck, adoAuth, adoPRsForBranch,
  gitCredentialSecret, azToken, jwtExpires, borrowedAuth } from '../links.mjs';
import { adoPatSaveCommand, adoPatReadCommand, parseAdoPatRead, adoSignInCommands, ADO_RESOURCE, macLaunchAgent } from '../platform.mjs';
import { hostFindings } from '../desk-check.mjs';

test('Azure DevOps remotes: dev.azure.com with or without a user, visualstudio.com, and ssh', () => {
  const want = { org: 'contoso', project: 'Web App', repo: 'site' };
  assert.deepEqual(adoRemote('https://dev.azure.com/contoso/Web%20App/_git/site'), want);
  assert.deepEqual(adoRemote('https://contoso@dev.azure.com/contoso/Web%20App/_git/site\n'), want);
  assert.deepEqual(adoRemote('https://contoso.visualstudio.com/Web%20App/_git/site'), want);
  assert.deepEqual(adoRemote('https://contoso.visualstudio.com/DefaultCollection/Web%20App/_git/site'), want);
  assert.deepEqual(adoRemote('git@ssh.dev.azure.com:v3/contoso/Web%20App/site'), want);
  assert.deepEqual(adoRemote('ssh://git@ssh.dev.azure.com:22/v3/contoso/Web%20App/site'), want);
  assert.deepEqual(adoRemote('contoso@vs-ssh.visualstudio.com:v3/contoso/Web%20App/site'), want);
  for (const r of ['https://github.com/contoso/site.git', 'git@github.com:contoso/site.git', 'https://dev.azure.com/contoso/_git', '', 'https://example.com/contoso/Web/_git/site'])
    assert.equal(adoRemote(r), null, r);
});

test('GitHub remotes are still owner/name, and never read as Azure DevOps', () => {
  assert.equal(githubRepo('https://github.com/contoso/site.git'), 'contoso/site');
  assert.equal(githubRepo('git@github.com:contoso/site.git'), 'contoso/site');
  assert.equal(githubRepo('https://dev.azure.com/contoso/Web/_git/site'), '');
});

test('the organization is found from its name or either address, and its token page from that', () => {
  for (const o of ['contoso', 'https://dev.azure.com/Contoso', 'https://contoso.visualstudio.com/']) assert.equal(adoOrgName(o), 'contoso', o);
  assert.equal(adoOrgName(''), '');
  assert.equal(adoTokenPage('https://dev.azure.com/contoso'), 'https://dev.azure.com/contoso/_usersSettings/tokens');
});

test('codeHosts: the projects most used first, pull request addresses as a weaker sign, GitHub repos apart', () => {
  const h = codeHosts([
    'https://dev.azure.com/contoso/Web/_git/site', 'git@ssh.dev.azure.com:v3/contoso/Web/api', 'https://contoso.visualstudio.com/Tools/_git/build',
    'https://dev.azure.com/contoso/Web/_git/site', 'https://github.com/fabrikam/app.git', undefined, '',
  ], ['https://dev.azure.com/contoso/Data/_git/etl/pullrequest/4', 'https://github.com/fabrikam/app/pull/2']);
  assert.deepEqual(h.ado.map((x) => [x.org, x.project, x.folders, x.prs, x.repos]), [
    ['contoso', 'Web', 3, 0, ['site', 'api']], ['contoso', 'Tools', 1, 0, ['build']], ['contoso', 'Data', 0, 1, ['etl']]]);
  assert.deepEqual(h.github, ['fabrikam/app']);
  assert.deepEqual(codeHosts([]), { ado: [], github: [] });
});

test('adoNeeds: setup without an organization and project, token without a working sign-in, else ok', () => {
  const found = [{ org: 'contoso', project: 'Web', folders: 2, prs: 0, repos: ['site'] }, { org: 'contoso', project: 'Tools', folders: 1, prs: 0, repos: [] }];
  assert.equal(adoNeeds({ found: [], cfg: undefined, auth: null }), null); // not used
  assert.deepEqual(adoNeeds({ found, cfg: undefined, auth: null }), { state: 'setup', suggest: found[0] });
  assert.deepEqual(adoNeeds({ found, cfg: { org: 'contoso' }, auth: null }), { state: 'setup', suggest: found[0] }); // half set
  assert.deepEqual(adoNeeds({ found, cfg: { org: 'contoso', project: 'Web' }, auth: null }), { state: 'token' });
  assert.deepEqual(adoNeeds({ found, cfg: { org: 'contoso', project: 'Web' }, auth: { ok: false, error: 'no' } }), { state: 'token', error: 'no' });
  const ok = adoNeeds({ found, cfg: { org: 'https://dev.azure.com/Contoso', project: 'web' }, auth: { ok: true, repos: 5, via: 'token' } });
  assert.equal(ok.state, 'ok');
  assert.equal(ok.repos, 5);
  assert.deepEqual(ok.other.map((f) => f.project), ['Tools']);
  // set by hand with no remotes found: still checked
  assert.equal(adoNeeds({ found: [], cfg: { org: 'contoso', project: 'Web' }, auth: null }).state, 'token');
});

test('githubNeeds: no repos is nothing; no gh sign-in, unreadable repos, or ok', () => {
  assert.equal(githubNeeds({ repos: [], accounts: [] }), null);
  assert.deepEqual(githubNeeds({ repos: ['fabrikam/app'], accounts: [] }), { state: 'signin' });
  assert.deepEqual(githubNeeds({ repos: ['fabrikam/app', 'fabrikam/web'], accounts: [{ login: 'sam' }], unreadable: ['fabrikam/web'] }), { state: 'access', repos: ['fabrikam/web'] });
  assert.deepEqual(githubNeeds({ repos: ['fabrikam/app'], accounts: [{ login: 'sam' }], unreadable: [] }), { state: 'ok' });
});

test('adoCheck lists the project\'s repos, and names 401 (and the 203 sign-in page), 403 and 404', async () => {
  const reply = (status, body) => async (url, opts) => ({ ok: status < 300, status, url, opts, json: async () => body });
  let asked;
  const ok = await adoCheck({ base: 'https://dev.azure.com/contoso', project: 'Web App', pat: 'secret', fetchFn: async (url, opts) => { asked = { url, auth: opts.headers.Authorization }; return reply(200, { value: [{}, {}, {}] })(); } });
  assert.deepEqual(ok, { ok: true, repos: 3 });
  assert.equal(asked.url, 'https://dev.azure.com/contoso/Web%20App/_apis/git/repositories?api-version=7.1');
  assert.equal(asked.auth, 'Basic ' + Buffer.from(':secret').toString('base64'));
  for (const [status, words] of [[401, /401/], [203, /401/], [403, /Code \(Read\)/], [404, /no project Web App/], [500, /500/]]) {
    const r = await adoCheck({ base: 'https://dev.azure.com/contoso', project: 'Web App', pat: 'x', fetchFn: reply(status, {}) });
    assert.equal(r.ok, false); assert.match(r.error, words, String(status));
    assert.doesNotMatch(r.error, /\bx\b.*token/); // never the token itself
  }
});

test('a borrowed sign-in goes as Bearer on the same calls; a PAT as Basic', async () => {
  assert.equal(adoAuth('Bearer abc'), 'Bearer abc');
  assert.equal(adoAuth('pat'), 'Basic ' + Buffer.from(':pat').toString('base64'));
  let auth;
  await adoPRsForBranch({ base: 'https://dev.azure.com/contoso', project: 'Web', pat: 'Bearer eyJx', branch: 'b', fetchFn: async (u, o) => { auth = o.headers.Authorization; return { ok: true, status: 200, json: async () => ({ value: [] }) }; } });
  assert.equal(auth, 'Bearer eyJx');
});

test('git credential fill and az answers: the secret, Bearer for an Entra token, and when it runs out', () => {
  const exp = 1900000000;
  const jwt = 'eyJhbGciOiJub25lIn0.' + Buffer.from(JSON.stringify({ exp })).toString('base64url') + '.sig';
  assert.equal(gitCredentialSecret(`protocol=https\nhost=dev.azure.com\nusername=sam\npassword=${jwt}\n`), jwt);
  assert.equal(gitCredentialSecret('protocol=https\nhost=dev.azure.com\n'), '');
  assert.equal(jwtExpires(jwt), exp * 1000);
  assert.equal(jwtExpires('plainpat'), 0);
  assert.equal(borrowedAuth(jwt), `Bearer ${jwt}`);
  assert.equal(borrowedAuth('plainpat'), 'plainpat'); // a PAT Git Credential Manager holds goes as Basic (adoAuth)
  assert.deepEqual(azToken(JSON.stringify({ accessToken: 'tok', expiresOn: '2030-01-01 10:00:00.000000', expires_on: exp })), { token: 'tok', expires: exp * 1000 });
  assert.equal(azToken('ERROR: Please run az login'), null);
});

test('the borrowed sign-in commands never prompt, and az runs through cmd.exe on Windows', () => {
  for (const platform of ['win32', 'darwin']) {
    const [git, az] = adoSignInCommands('contoso', platform);
    assert.deepEqual([git.cmd, ...git.args], ['git', 'credential', 'fill']);
    assert.equal(git.input, 'protocol=https\nhost=dev.azure.com\npath=contoso\n\n');
    assert.equal(git.env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(git.env.GCM_INTERACTIVE, 'never');
    assert.ok(az.args.includes(ADO_RESOURCE));
    assert.equal(az.cmd, platform === 'win32' ? 'cmd.exe' : 'az');
  }
  assert.equal(ADO_RESOURCE, '499b84ac-1321-427f-aa17-267ca6aa798d');
});

test('the token is kept as the user variable on Windows and in the LaunchAgent on a Mac, never on Windows\' command line', () => {
  const win = adoPatSaveCommand({ platform: 'win32', home: 'C:\\Users\\sam' });
  assert.equal(win.cmd, 'powershell.exe');
  assert.match(win.args.at(-1), /SetEnvironmentVariable\('AZURE_DEVOPS_EXT_PAT', \$env:DOCKET_ADO_PAT, 'User'\)/);
  assert.equal(win.secretVar, 'DOCKET_ADO_PAT');
  const mac = adoPatSaveCommand({ platform: 'darwin', home: '/Users/sam' });
  assert.equal(mac.needs, '/Users/sam/Library/LaunchAgents/local.docket.plist');
  assert.equal(mac.needs, macLaunchAgent('/Users/sam'));
  assert.match(mac.args[1], /plutil -replace EnvironmentVariables\.AZURE_DEVOPS_EXT_PAT -string "\$DOCKET_ADO_PAT" "\$1"/);
  assert.equal(adoPatSaveCommand({ platform: 'linux', home: '/home/sam' }), null);
  assert.deepEqual(adoPatReadCommand({ platform: 'win32' }).args, ['query', 'HKCU\\Environment', '/v', 'AZURE_DEVOPS_EXT_PAT']);
  assert.equal(adoPatReadCommand({ platform: 'darwin', home: '/Users/sam' }).args.at(-1), '/Users/sam/Library/LaunchAgents/local.docket.plist');
  assert.equal(parseAdoPatRead('\r\nHKEY_CURRENT_USER\\Environment\r\n    AZURE_DEVOPS_EXT_PAT    REG_SZ    abc123\r\n', 'win32'), 'abc123');
  assert.equal(parseAdoPatRead('', 'win32'), '');
  assert.equal(parseAdoPatRead('abc123\n', 'darwin'), 'abc123');
});

test('Desk check: a finding with Set up for Azure DevOps, and one for GitHub without a sign-in', () => {
  const f = hostFindings({ ado: { state: 'setup', suggest: { org: 'contoso', project: 'Web' } }, github: { state: 'signin', found: ['fabrikam/app'] } });
  assert.deepEqual(f.map((x) => x.key), ['ado-setup', 'github-signin']);
  assert.match(f[0].means, /contoso\/Web/);
  assert.deepEqual(f[0].action, { kind: 'ado-setup', label: 'Set up…' });
  assert.deepEqual(hostFindings({ ado: { state: 'token', org: 'contoso', project: 'Web' }, github: { state: 'access', repos: ['a/b'], found: ['a/b'] } }).map((x) => x.key), ['ado-token', 'github-access']);
  assert.deepEqual(hostFindings({ ado: { state: 'ok' }, github: { state: 'ok', found: ['a/b'] } }), []);
  assert.deepEqual(hostFindings(null), []);
});
