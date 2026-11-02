// A LiteLLM gateway as a company's connection: the config, what a Claude session gets on each route, the gears
// and model names, reading lite's output (with the stand-in in fixtures/fake-lite.mjs), a stand-in gateway that takes
// or refuses a key, and cost rows billed to the gateway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  cleanUrl, gatewayHost, cleanGateway, gatewayFor, claudeRouteOf, visibleGears, usableGear, modelFor, gearModelMap,
  printTokenCommand, liteArgs, liteCommand, gatewayTags, claudeGateway, loginLink, loginDone, pkceUnsupported,
  whoamiUser, tokenFrom, gatewayRefused,
} from '../gateway.mjs';
import { findLite } from '../platform.mjs';
import { findGear } from '../gears.mjs';
import { dayRows } from '../costs.mjs';
import { connectionOf } from '../connection.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(HERE, 'fixtures', 'fake-lite.mjs');
const GW = 'https://gateway.example.com';
const company = (gateway) => ({ id: 'acme', gateway });

test('gateway addresses: https, or http for this computer only', () => {
  assert.equal(cleanUrl('https://gw.example.com/'), 'https://gw.example.com');
  assert.equal(cleanUrl('http://localhost:4000'), 'http://localhost:4000');
  assert.equal(cleanUrl('http://127.0.0.1:4000//'), 'http://127.0.0.1:4000');
  assert.equal(cleanUrl('http://gw.example.com'), null);
  assert.equal(cleanUrl('not a url'), null);
  assert.equal(cleanUrl('  '), '');
  assert.equal(gatewayHost('https://gw.example.com:8443/x'), 'gw.example.com:8443');
});

test('cleanGateway keeps a sound block and drops the defaults', () => {
  assert.deepEqual(cleanGateway({}), {});
  assert.deepEqual(cleanGateway({ gateway: { url: '' } }), {});
  assert.deepEqual(cleanGateway({ gateway: { url: GW + '/' } }), { gateway: { url: GW, brands: ['claude'] } });
  const full = cleanGateway({ gateway: { url: GW, brands: ['claude', 'grok'], claudeRoute: 'bedrock', login: 'device', lite: 'C:/x/lite.exe', models: { claude: { opus: ' gw-opus ', haiku: '' } } } });
  assert.deepEqual(full, { gateway: { url: GW, brands: ['claude'], claudeRoute: 'bedrock', login: 'device', lite: 'C:/x/lite.exe', models: { claude: { opus: 'gw-opus' } } } });
});

test('cleanGateway refuses what cannot work', () => {
  assert.match(cleanGateway({ gateway: { url: 'http://gw.example.com' } }).error, /https/);
  assert.match(cleanGateway({ gateway: { url: GW, brands: ['grok'] } }).error, /which brands/);
  assert.match(cleanGateway({ gateway: { url: GW } }, { name: 'Acme', aws: true }).error, /^Acme: .*AWS profile.*not both/);
  assert.match(cleanGateway({ gateway: { url: GW, claudeRoute: 'vertex' } }).error, /messages or bedrock/);
  assert.match(cleanGateway({ gateway: { url: GW, login: 'password' } }).error, /pkce, device or key/);
  assert.match(cleanGateway({ gateway: { url: GW, lite: 'lite.exe' } }, { isAbsolute: path.isAbsolute }).error, /full path/);
});

test('cleanGateway reads the Companies screen\'s flat fields', () => {
  const flat = { gatewayUrl: GW, gatewayClaudeRoute: '', gatewayLogin: 'key', gatewayLite: '', gatewayModel_claude_sonnet: 'gw-sonnet', gatewayModels: ['ignored'] };
  assert.deepEqual(cleanGateway(flat), { gateway: { url: GW, brands: ['claude'], login: 'key', models: { claude: { sonnet: 'gw-sonnet' } } } });
  assert.deepEqual(cleanGateway({ gatewayUrl: '', gateway: { url: GW } }), {}, 'an emptied URL field clears the gateway');
  assert.deepEqual(cleanGateway({ gatewayModels: ['x'], gateway: { url: GW } }), { gateway: { url: GW, brands: ['claude'] } }, 'the model list alone is not the flat form');
});

test('the Claude route follows this computer\'s policy unless set', () => {
  assert.equal(claudeRouteOf({ url: GW }, 'Amazon Bedrock'), 'bedrock');
  assert.equal(claudeRouteOf({ url: GW }, null), 'messages');
  assert.equal(claudeRouteOf({ url: GW, claudeRoute: 'messages' }, 'Amazon Bedrock'), 'bedrock', 'the messages route would skip the gateway there');
  assert.equal(claudeRouteOf({ url: GW, claudeRoute: 'bedrock' }, null), 'bedrock');
  assert.equal(gatewayFor(company({ url: GW, brands: ['claude'] }), 'codex'), null);
  assert.equal(gatewayFor({ id: 'x' }), null);
});

test('a Claude session on the bedrock route gets the gateway, the key helper and the tags', () => {
  const gw = { url: GW, models: { claude: { haiku: 'gw-haiku', opus: 'gw-opus' } } };
  const { env, unset, settings } = claudeGateway(gw, { route: 'bedrock', lite: 'C:\\Users\\pat\\.litellm-cli\\Scripts\\lite.exe', companyId: 'acme', sessionId: 's1' });
  assert.equal(env.CLAUDE_CODE_USE_BEDROCK, '1');
  assert.equal(env.ANTHROPIC_BEDROCK_BASE_URL, GW + '/bedrock');
  assert.equal(env.CLAUDE_CODE_SKIP_BEDROCK_AUTH, '1');
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'gw-haiku');
  assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'gw-opus');
  assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, undefined);
  assert.equal(env.ANTHROPIC_CUSTOM_HEADERS, 'x-litellm-tags: docket,company:acme,session:s1');
  assert.equal(env.CLAUDE_CODE_API_KEY_HELPER_TTL_MS, '300000');
  assert.equal(settings.apiKeyHelper, `"C:/Users/pat/.litellm-cli/Scripts/lite.exe" --base-url ${GW} auth print-token`);
  assert.deepEqual(settings.modelOverrides, { 'claude-haiku-5-5': 'gw-haiku', 'claude-opus-5-5': 'gw-opus' });
  assert.deepEqual(unset.sort(), ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'AWS_BEARER_TOKEN_BEDROCK', 'AWS_PROFILE']);
});

test('a Claude session on the messages route, and one signed in with a key', () => {
  const m = claudeGateway({ url: GW }, { route: 'messages', lite: '/home/pat/.local/bin/lite', companyId: 'acme' });
  assert.equal(m.env.ANTHROPIC_BASE_URL, GW);
  assert.equal(m.env.CLAUDE_CODE_USE_BEDROCK, undefined);
  assert.ok(m.unset.includes('CLAUDE_CODE_USE_BEDROCK'));
  assert.equal(m.env.ANTHROPIC_CUSTOM_HEADERS, 'x-litellm-tags: docket,company:acme');
  assert.equal(m.settings.modelOverrides, undefined);
  const k = claudeGateway({ url: GW, login: 'key' }, { route: 'messages', companyId: 'acme', key: 'sk-virtual' });
  assert.equal(k.env.ANTHROPIC_AUTH_TOKEN, 'sk-virtual');
  assert.equal(k.settings.apiKeyHelper, undefined);
  assert.ok(!k.unset.includes('ANTHROPIC_AUTH_TOKEN'));
});

test('gears and model names through a gateway', () => {
  const none = company({ url: GW, brands: ['claude'] });
  assert.deepEqual(visibleGears(none, 'claude').map((g) => g.key), ['haiku', 'sonnet', 'opus']);
  assert.equal(modelFor(none, 'claude', 'claude-opus-5-5'), 'claude-opus-5-5');
  const some = company({ url: GW, brands: ['claude'], models: { claude: { sonnet: 'gw-sonnet', opus: 'gw-opus' } } });
  assert.deepEqual(visibleGears(some, 'claude').map((g) => g.key), ['sonnet', 'opus']);
  assert.equal(usableGear(some, 'claude', findGear('claude', 'haiku')).key, 'sonnet', 'a gear with no name moves up');
  assert.equal(usableGear(some, 'claude', findGear('claude', 'opus')).key, 'opus');
  assert.equal(modelFor(some, 'claude', 'opus'), 'gw-opus');
  assert.equal(modelFor(some, 'claude', 'claude-haiku-5-5'), 'gw-sonnet');
  assert.equal(modelFor(some, 'claude', 'some-typed-model'), 'some-typed-model');
  assert.equal(modelFor(some, 'claude', undefined), undefined);
  assert.equal(modelFor({ id: 'x' }, 'claude', 'opus'), 'opus', 'no gateway: unchanged');
  assert.deepEqual(gearModelMap(some), { 'gw-sonnet': 'claude-sonnet-5-5', 'gw-opus': 'claude-opus-5-5' });
});

test('reading lite\'s output', () => {
  assert.deepEqual(loginLink('\x1b[1mOpening browser to: https://gw/sso/cli/authorize?state=x\x1b[0m\nWaiting...'), { url: 'https://gw/sso/cli/authorize?state=x', code: null });
  assert.deepEqual(loginLink('Visit https://gw/sso/cli. and enter the code: ABCD-1234'), { url: 'https://gw/sso/cli', code: 'ABCD-1234' });
  assert.equal(loginLink('Starting...'), null);
  assert.ok(loginDone('...\nLogin successful!\n'));
  assert.ok(!loginDone('Waiting for approval'));
  assert.ok(pkceUnsupported('Error: https://gw does not support /.well-known/litellm-cli-auth'));
  assert.ok(pkceUnsupported("Error: No such option: --pkce"));
  assert.ok(!pkceUnsupported('Opening browser to: https://gw/x'));
  assert.equal(whoamiUser('User ID: u-1\nEmail: pat@example.com'), 'pat@example.com');
  assert.equal(whoamiUser('User ID: u-1'), 'u-1');
  assert.equal(tokenFrom(0, 'sk-abc\n'), 'sk-abc');
  assert.equal(tokenFrom(1, 'sk-abc'), '');
  assert.equal(tokenFrom(0, 'Not logged in. Run lite login.'), '');
  assert.equal(gatewayTags('acme'), 'docket,company:acme');
});

test('errors that mean the gateway refused the sign-in', () => {
  for (const t of ['API Error: 401 {"error":{"message":"Authentication Error, Invalid proxy server token passed"}}', 'apiKeyHelper failed: exit 1',
    'Error: token expired', 'lite: Not logged in. Run lite login.', 'authentication_error'])
    assert.ok(gatewayRefused(t), t);
  for (const t of ['API Error: 529 overloaded', 'Rate limit reached', 'context window exceeded', ''])
    assert.ok(!gatewayRefused(t), t);
});

test('finding lite on each platform', () => {
  const has = (set) => (f) => set.includes(f);
  assert.equal(findLite({ platform: 'win32', home: 'C:\\Users\\pat', env: {}, exists: has(['C:\\Users\\pat\\.litellm-cli\\Scripts\\lite.exe']) }), 'C:\\Users\\pat\\.litellm-cli\\Scripts\\lite.exe');
  assert.equal(findLite({ platform: 'win32', home: 'C:\\Users\\pat', env: {}, exists: () => false }), 'lite.exe');
  assert.equal(findLite({ platform: 'darwin', home: '/Users/pat', env: {}, exists: has(['/Users/pat/.local/bin/lite']) }), '/Users/pat/.local/bin/lite');
  assert.equal(findLite({ platform: 'darwin', home: '/Users/pat', env: {}, exists: has(['/opt/homebrew/bin/lite']) }), '/opt/homebrew/bin/lite');
  assert.equal(findLite({ platform: 'darwin', home: '/Users/pat', env: {}, exists: () => false }), 'lite');
  assert.equal(findLite({ platform: 'darwin', home: '/Users/pat', env: { PORTAL_LITE_EXE: '/t/fake-lite.mjs' }, exists: () => false }), '/t/fake-lite.mjs');
});

// The stand-in lite, run the way Docket runs it (liteCommand) and the way Claude Code runs the key helper (a shell).
test('the stand-in lite: sign in, print the key, sign out', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-399-'));
  const env = { ...process.env, FAKE_LITE_STATE: path.join(tmp, 'lite.json'), FAKE_LITE_DELAY: '10' };
  const run = (...args) => { const [cmd, a] = liteCommand(FAKE, liteArgs(GW, ...args)); return spawnSync(cmd, a, { env, encoding: 'utf8' }); };
  let r = run('auth', 'print-token');
  assert.equal(tokenFrom(r.status, r.stdout), '');
  assert.ok(gatewayRefused('lite: ' + r.stderr));
  r = run('login', '--pkce');
  assert.equal(loginLink(r.stdout).url, GW + '/sso/cli/authorize?state=abc123');
  assert.ok(loginDone(r.stdout));
  r = run('auth', 'print-token');
  assert.equal(tokenFrom(r.status, r.stdout), 'sk-fake-token');
  assert.equal(whoamiUser(run('whoami').stdout), 'pat@example.com');
  // The key helper is one shell command line.
  assert.equal(execSync(printTokenCommand(FAKE, GW), { env, encoding: 'utf8' }).trim(), 'sk-fake-token');
  fs.writeFileSync(env.FAKE_LITE_STATE, JSON.stringify({ noPkce: true }));
  r = run('login', '--pkce');
  assert.ok(pkceUnsupported(r.stderr));
  r = run('login');
  assert.deepEqual(loginLink(r.stdout), { url: GW + '/sso/cli', code: 'ABCD-1234' });
});

// A stand-in gateway: /v1/models answers 200 with the good key and 401 otherwise, as LiteLLM does.
test('a stand-in gateway takes the key lite prints and refuses a stale one', async () => {
  const server = http.createServer((req, res) => {
    const ok = req.headers.authorization === 'Bearer sk-fake-token';
    if (req.url === '/v1/models' && ok) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'gw-sonnet' }, { id: 'gw-opus' }] })); return; }
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Authentication Error, Invalid proxy server token passed', type: 'auth_error', code: '401' } }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = cleanUrl(`http://127.0.0.1:${server.address().port}/`);
  try {
    const get = (key) => fetch(url + '/v1/models', { headers: { authorization: `Bearer ${key}` } });
    const good = await get('sk-fake-token');
    assert.equal(good.status, 200);
    assert.deepEqual((await good.json()).data.map((m) => m.id), ['gw-sonnet', 'gw-opus']);
    const bad = await get('sk-stale');
    assert.equal(bad.status, 401);
    assert.ok(gatewayRefused(`API Error: ${bad.status} ${await bad.text()}`));
  } finally { server.close(); }
});

// The gateway is both connections (connection.mjs), so a reply is the gateway's whatever its id looks like.
test('cost rows of a gateway session name the gateway as the payer', () => {
  const reply = (model, extra = {}) => ({ at: Date.parse('2026-10-30T12:00:00Z'), model, tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, tools: new Map(), cost: 0.01, listCost: 0.01, ...extra });
  const conn = { ...connectionOf({ client: { id: 'acme', gateway: { url: GW, user: 'pat@example.com' } } }), recorded: true };
  assert.equal(conn.kind, 'gateway');
  const billed = { connection: conn, bedrockConnection: conn, subscription: 'pat@claude', bedrock: 'claude-code' };
  const rows = dayRows('acme', 's1', 'T', [reply('claude-opus-5-5'), reply('claude-opus-5-5', { bedrock: true })], [], 0, {}, billed);
  for (const r of rows) {
    assert.equal(r.BilledProfile, 'gateway gateway.example.com (pat@example.com)');
    assert.equal(r.ProfileInferred, 0);
    assert.equal(r.Connection, conn.key);
  }
  assert.equal(rows.reduce((n, r) => n + r.Turns, 0), 2);
  const own = dayRows('acme', 's1', 'T', [reply('claude-opus-5-5')], [], 0, {}, { subscription: 'pat@claude' });
  assert.equal(own[0].BilledProfile, 'pat@claude');
});
