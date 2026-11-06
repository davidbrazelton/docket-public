import test from 'node:test';
import assert from 'node:assert/strict';
import { shareableServers, httpArgs, entryKey, sessionServers } from '../shared-mcp.mjs';

const jira = { command: 'C:\\Users\\me\\Scripts\\mcp-atlassian.exe', args: ['--transport', 'stdio', '--enabled-tools', 'jira_get_issue'], env: { JIRA_URL: 'https://example.atlassian.net', JIRA_API_TOKEN: 't' } };

test('only stdio mcp-atlassian entries at user level are shared', () => {
  const got = shareableServers({
    mcpServers: {
      jira,
      confluence: { ...jira, type: 'stdio', command: '/usr/local/bin/mcp-atlassian' },
      remote: { type: 'http', url: 'http://x/mcp' },
      other: { command: 'npx', args: ['some-server'] },
      broken: null,
    },
    projects: { 'C:/work': { mcpServers: { jira2: jira } } },
  });
  assert.deepEqual(Object.keys(got), ['jira', 'confluence']);
  assert.deepEqual(shareableServers(null), {});
});

test('httpArgs swaps the transport and keeps the rest', () => {
  assert.deepEqual(httpArgs(jira.args, 5000),
    ['--enabled-tools', 'jira_get_issue', '--transport', 'streamable-http', '--stateless', '--host', '127.0.0.1', '--port', '5000', '--path', '/mcp']);
  assert.deepEqual(httpArgs(['--transport=stdio', '--port', '1', '--host', 'h', '--path', '/p', '--stateless', '-v'], 7),
    ['-v', '--transport', 'streamable-http', '--stateless', '--host', '127.0.0.1', '--port', '7', '--path', '/mcp']);
  assert.deepEqual(httpArgs(undefined, 7).slice(0, 2), ['--transport', 'streamable-http']);
});

test('entryKey changes with command, args or env and holds no secret', () => {
  const k = entryKey(jira);
  assert.equal(k, entryKey({ ...jira }));
  assert.notEqual(k, entryKey({ ...jira, env: { ...jira.env, JIRA_API_TOKEN: 'u' } }));
  assert.notEqual(k, entryKey({ ...jira, args: [] }));
  assert.notEqual(k, entryKey({ ...jira, command: 'mcp-atlassian' }));
  assert.match(k, /^[0-9a-f]{16}$/);
});

test('a session gets http entries except names its folder has its own entry for', () => {
  const urls = { jira: 'http://127.0.0.1:1/mcp', confluence: 'http://127.0.0.1:2/mcp' };
  const j = { projects: { 'C:/Work/Acme': { mcpServers: { jira: jira } }, 'C:/Other': { mcpServers: { confluence: jira } } } };
  assert.deepEqual(sessionServers(urls, j, 'C:\\work\\acme\\'), { confluence: { type: 'http', url: urls.confluence } });
  assert.deepEqual(sessionServers(urls, j, 'D:/x'), { jira: { type: 'http', url: urls.jira }, confluence: { type: 'http', url: urls.confluence } });
  assert.deepEqual(sessionServers(urls, null, undefined), sessionServers(urls, {}, ''));
});
