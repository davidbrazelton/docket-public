// ☰ > Memory and disk: the breakdown by session, shared helpers, and test copies and leftovers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakdown, sharedServers, sessionOfCommand, docketProgram } from '../machine-use.mjs';

// A computer's list, as parseProcessList gives it with command lines, for Windows or a Mac: the live Docket in
// root, two sessions and one Grok it cannot match, the shared Jira server and the private browser, a test copy
// started from a session's command, its shared MCP server, and a runner left over from another folder.
function fixture(mac) {
  const sep = mac ? '/' : '\\';
  const j = (...p) => (mac ? '/Users/pat' : 'V:\\Repos') + sep + p.join(sep);
  const node = mac ? '/usr/local/bin/node' : '"C:\\Program Files\\nodejs\\node.exe"';
  const cfg = (id) => mac ? `{"mcpServers":{"portal":{"env":{"DOCKET_SESSION":"${id}"}}}}` : `"{\\"mcpServers\\":{\\"portal\\":{\\"env\\":{\\"DOCKET_SESSION\\":\\"${id}\\"}}}}"`;
  const claude = mac ? '/Users/pat/.local/bin/claude' : 'C:\\Docket\\claude.exe';
  const watch = (folder, parent) => mac ? `osascript -l JavaScript ${folder}/power-watch-mac.js ${parent}` : `powershell.exe -File ${folder}\\power-watch.ps1 -ParentPid ${parent}`;
  const C = (pid, ppid, name, mem, cmd, cpu = 0) => ({ pid, ppid, name, mem, cmd, cpu });
  const root = j('docket'), copy = j('docket-work', 'x'), other = j('other');
  const shell = mac ? 'osascript' : 'powershell';
  const list = [
    C(1, 0, mac ? 'launchd' : 'explorer', 999, ''),
    C(10, 1, 'node', 700, `${node} ${root}${sep}server.mjs`),
    C(11, 10, shell, 9, watch(root, 10)),
    C(12, 10, 'uvx', 30, 'uvx mcp-atlassian --transport streamable-http'), C(13, 12, 'python', 70, 'python -m mcp_atlassian'),
    C(20, 10, 'node', 100, `${node} ${root}${sep}runner.mjs`),
    C(21, 20, 'claude', 400, `${claude} --mcp-config ${cfg('s1')} --session-id=s1 --plugin-dir=${root}${sep}plugin ${root}${sep}tools-helper.mjs`, 2),
    C(22, 21, 'node', 50, `${node} ${root}${sep}tools-helper.mjs`),
    C(23, 21, 'node', 40, 'npx -y @acme/mcp-server'), C(24, 23, 'node', 5, 'node acme-mcp.js'),
    C(25, 21, mac ? 'zsh' : 'bash', 3, 'bash -c npm test'),
    C(26, 25, 'node', 200, 'node server.mjs'), // the test copy, typed in its folder
    C(27, 26, 'node', 80, `${node} ${copy}${sep}runner.mjs`), C(28, 27, 'claude', 300, `${claude} --session-id=t1`),
    C(29, 26, shell, 6, watch(copy, 26)),
    C(30, 20, 'claude', 350, `${claude} --mcp-config ${cfg('s2')} --resume abc`),
    C(31, 20, 'grok', 60, 'grok agent stdio'),
    C(40, 20, 'node', 90, `${node} cli.js --headless --port 4999`), C(41, 40, mac ? 'google chrome for testing helper (renderer)' : 'chrome', 120, 'chrome --type=renderer'),
    C(50, 1, 'node', 110, `${node} ${other}${sep}runner.mjs`),
    C(60, 1, 'uvx', 25, 'uvx mcp-atlassian'),
    C(70, 1, 'node', 500, `${node} ${mac ? '/opt/my-server.mjs' : 'C:\\Tools\\my-server.mjs'}`), // not Docket's
  ];
  return { list, root, copy, other };
}

for (const mac of [false, true]) test(`breakdown on ${mac ? 'a Mac' : 'Windows'}: sessions, what they share, test copies and leftovers`, () => {
  const { list, root, copy, other } = fixture(mac);
  const b = breakdown(list, { appPid: 10, runnerPid: 20, root,
    sessions: new Map([['s1', { title: 'Fix the login', desk: 'Acme' }], ['s2', { title: 'Write the report', desk: 'Home' }]]),
    helpers: [{ name: 'playwright-acme-1234', pid: 40, meta: { desk: 'acme', port: 4999 } }],
    shared: sharedServers({ servers: { k1: { pid: 12, port: 1 }, k9: { pid: 99, port: 2 } }, desks: { acme: { jira: 'k1' }, home: { jira: 'k1' } } }),
    copies: [{ folder: copy, servers: [{ pid: 60, name: 'jira', desks: ['acme'] }] }],
    before: { byPid: new Map(list.map((p) => [p.pid, 0])), at: 0 }, at: 10_000, cores: 2 });
  const parts = (x) => x.parts.map((p) => [p.label, p.count, p.mem]);
  assert.deepEqual(b.sessions.map((s) => [s.id, s.title, s.desk, s.count, s.mem]), [['s1', 'Fix the login', 'Acme', 5, 498], ['s2', 'Write the report', 'Home', 1, 350]]);
  assert.deepEqual(parts(b.sessions[0]), [['claude', 1, 400], ['tools-helper.mjs', 1, 50], ['Its own MCP servers', 2, 45], ['Other programs it started', 1, 3]]);
  assert.equal(b.sessions[0].cpu, 10); // 2 s of processor in 10 s on 2 cores
  assert.equal(b.sessions[1].cpu, 0);
  assert.deepEqual(parts(b.unmatched), [['grok', 1, 60]]);
  assert.deepEqual(b.shared.map((x) => [x.kind, x.name, x.desks, x.count, x.mem]), [['browser', 'playwright-acme-1234', ['acme'], 2, 210], ['mcp', 'jira', ['acme', 'home'], 2, 100]]);
  assert.deepEqual(b.leftovers.map((g) => [g.folder, g.mem]), [[copy, 200 + 80 + 300 + 6 + 25], [other, 110]]);
  assert.deepEqual(parts(b.leftovers[0]), [['Docket app (server.mjs)', 1, 200], ['Session runner (runner.mjs)', 2, 380], ['Power watch', 1, 6], ['Shared MCP servers', 1, 25]]);
  assert.deepEqual(parts(b.leftovers[1]), [['Session runner (runner.mjs)', 1, 110]]);
  // Nothing counted twice, and nothing of the live app's own (its power watch) or from outside Docket in a line.
  const counted = [...b.sessions, b.unmatched, ...b.shared, ...b.leftovers].reduce((a, x) => a + x.count, 0);
  assert.equal(counted, 5 + 1 + 1 + 4 + 5 + 1);
});

test('breakdown: no earlier list gives no CPU; no runner gives no sessions', () => {
  const { list, root } = fixture(false);
  const b = breakdown(list, { appPid: 10, runnerPid: undefined, root });
  assert.deepEqual(b.sessions, []);
  assert.equal(b.unmatched, null);
  assert.ok(b.leftovers.length && b.leftovers.every((g) => g.cpu === null));
});

test('sessionOfCommand: DOCKET_SESSION in the config, else --session-id', () => {
  assert.equal(sessionOfCommand('claude.exe --mcp-config "{\\"env\\":{\\"DOCKET_SESSION\\":\\"ab-12\\"}}" --resume zz'), 'ab-12');
  assert.equal(sessionOfCommand('claude --mcp-config {"env":{"DOCKET_SESSION":"ab-12"}}'), 'ab-12');
  assert.equal(sessionOfCommand('claude --session-id=cd-34'), 'cd-34');
  assert.equal(sessionOfCommand('grok agent stdio'), null);
});

test('docketProgram: node\'s own script, powershell\'s -File; not a file that only ends in the name', () => {
  assert.deepEqual(docketProgram({ name: 'node', cmd: '"C:\\Program Files\\nodejs\\node.exe" --inspect "C:\\My Work\\docket\\server.mjs"' }), { program: 'server.mjs', folder: 'C:\\My Work\\docket' });
  assert.deepEqual(docketProgram({ name: 'node', cmd: 'node server.mjs' }), { program: 'server.mjs', folder: '' });
  assert.deepEqual(docketProgram({ name: 'powershell', cmd: 'powershell.exe -NoProfile -File C:\\D\\power-watch.ps1 -ParentPid 3' }), { program: 'power-watch.ps1', folder: 'C:\\D' });
  assert.deepEqual(docketProgram({ name: 'osascript', cmd: 'osascript -l JavaScript /Users/pat/docket/power-watch-mac.js 10' }), { program: 'power-watch-mac.js', folder: '/Users/pat/docket' });
  assert.equal(docketProgram({ name: 'node', cmd: 'node C:\\Tools\\my-server.mjs' }), null);
  assert.equal(docketProgram({ name: 'node', cmd: 'node app.js C:\\D\\server.mjs' }), null);
  assert.equal(docketProgram({ name: 'claude', cmd: 'claude --mcp-config C:\\D\\tools-helper.mjs' }), null);
});

test('sharedServers: each copy once, with every desk that uses it', () => {
  assert.deepEqual(sharedServers({ servers: { a: { pid: 5 }, b: { pid: 6 } }, desks: { x: { jira: 'a', confluence: 'b' }, y: { jira: 'a' } } }),
    [{ pid: 5, name: 'jira', desks: ['x', 'y'] }, { pid: 6, name: 'confluence', desks: ['x'] }]);
  assert.deepEqual(sharedServers(null), []);
});
