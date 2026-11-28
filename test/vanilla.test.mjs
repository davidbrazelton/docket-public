// Tests for vanilla.mjs, the Vanilla desk (#1210), and its keychain lines in platform.mjs. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { vanillaHomes, makeVanillaHomes, GROK_CONFIG, lenders, cleanBorrow, vanillaEntry, stampOf, fileStore, syncSignIn, withAccount,
  bareMessage, lentConnection, isVanilla, signInFile } from '../vanilla.mjs';
import { claudeSignInStore, keychainReadCommand, keychainWriteCommand } from '../platform.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vanilla-'));
const brands = { a: ['claude', 'codex'], b: ['claude', 'grok'], g: ['claude'], v: ['claude', 'grok', 'codex'] };
const desks = [
  { id: 'a', name: 'Acme' }, { id: 'b', name: 'Beta' }, { id: 'g', name: 'Gated', gateway: { url: 'https://gw.example.com' } },
  { id: 'r', name: 'Far', remote: { name: 'laptop' } }, { id: 'v', name: 'Vanilla', vanilla: true },
];
const uses = (d, e) => (brands[d.id] || ['claude']).includes(e);

test('its homes sit together under the root, and Grok\'s config keeps Claude\'s and Cursor\'s setup out', () => {
  const root = tmp(), homes = vanillaHomes(root);
  assert.deepEqual(Object.keys(homes), ['home', 'grokHome', 'codexHome']);
  for (const h of Object.values(homes)) assert.equal(path.dirname(h), path.join(root, 'Vanilla-desk'));
  assert.equal(makeVanillaHomes(homes).length, 3);
  assert.equal(makeVanillaHomes(homes).length, 0, 'made once');
  const cfg = fs.readFileSync(path.join(homes.grokHome, 'config.toml'), 'utf8');
  assert.equal(cfg, GROK_CONFIG);
  for (const h of ['claude', 'cursor']) for (const k of ['skills', 'rules', 'agents', 'mcps', 'hooks', 'sessions'])
    assert.match(cfg, new RegExp(`\\[compat\\.${h}\\][^[]*\\b${k} = false`));
});

test('a sign-in is borrowed only from this computer\'s own desks on their own sign-in', () => {
  assert.deepEqual(lenders(desks, 'claude', uses).map((d) => d.id), ['a', 'b'], 'not the gateway desk, the remote one or Vanilla itself');
  assert.deepEqual(lenders(desks, 'grok', uses).map((d) => d.id), ['b']);
  assert.deepEqual(cleanBorrow({}, desks, uses), { claude: 'a', grok: 'b', codex: 'a' }, 'the first lender by default');
  assert.deepEqual(cleanBorrow({ claude: 'b', grok: '' }, desks, uses), { claude: 'b', grok: '', codex: 'a' }, 'a brand turned off stays off');
  assert.deepEqual(cleanBorrow({ claude: 'gone', codex: 'b' }, desks, uses), { grok: 'b' }, 'a lender that cannot lend is dropped');
});

test('the desk entry loads only its own clean settings and turns off the brands with no lender', () => {
  const e = vanillaEntry({ homes: { home: '/h/c', grokHome: '/h/g', codexHome: '/h/x' }, folder: '/w', borrow: { claude: 'a', grok: '' } });
  assert.equal(isVanilla(e), true);
  assert.deepEqual(e.settingSources, ['user']);
  assert.deepEqual(e.brandsOff, ['grok', 'codex']);
  assert.equal(e.saveBeforeCompact, 0);
  assert.equal(signInFile(e, 'codex'), path.join('/h/x', 'auth.json'));
  assert.deepEqual(lentConnection({ awsProfile: 'dev', awsRegion: 'us-east-1' }), { awsProfile: 'dev', awsRegion: 'us-east-1' });
  assert.deepEqual(lentConnection({}), {});
});

test('the copy refreshed last wins, both ways', () => {
  const dir = tmp(), desk = fileStore(path.join(dir, 'desk', '.credentials.json')), mine = fileStore(path.join(dir, 'v', '.credentials.json'));
  const cred = (at) => JSON.stringify({ claudeAiOauth: { accessToken: 'x' + at, refreshToken: 'r' + at, expiresAt: at } });
  assert.equal(syncSignIn('claude', desk, mine), 'none', 'the lender is not signed in');
  desk.write(cred(100));
  assert.equal(syncSignIn('claude', desk, mine), 'to-vanilla');
  assert.equal(mine.read().text, cred(100));
  assert.equal(syncSignIn('claude', desk, mine), 'same');
  mine.write(cred(200)); // a Vanilla session refreshed it
  assert.equal(syncSignIn('claude', desk, mine), 'to-desk');
  assert.equal(desk.read().text, cred(200));
  desk.write(cred(300)); // the desk refreshed it since
  assert.equal(syncSignIn('claude', desk, mine), 'to-vanilla');
  assert.equal(mine.read().text, cred(300));
});

test('how new a sign-in is: Claude\'s and Grok\'s expiry, Codex\'s last refresh, else the file time', () => {
  assert.equal(stampOf('claude', '{"claudeAiOauth":{"expiresAt":5}}', 9), 5);
  assert.equal(stampOf('codex', '{"last_refresh":"2026-11-23T10:00:00Z"}', 9), Date.parse('2026-11-23T10:00:00Z'));
  assert.equal(stampOf('grok', '{"a":{"expires_at":"2026-11-23T21:40:00Z"},"b":{"expires_at":"2026-11-23T19:00:00Z"}}', 9), Date.parse('2026-11-23T21:40:00Z'));
  assert.equal(stampOf('grok', '{"x":{}}', 9), 9);
  assert.equal(stampOf('claude', 'not json', 7), 7);
});

test('its .claude.json takes the lender\'s account and nothing else of it', () => {
  const out = JSON.parse(withAccount('{"numStartups":3,"oauthAccount":{"emailAddress":"old@example.com"}}',
    '{"oauthAccount":{"emailAddress":"t1@example.com"},"userID":"u1","mcpServers":{"x":{}},"projects":{"/w":{}}}'));
  assert.deepEqual(out, { numStartups: 3, oauthAccount: { emailAddress: 't1@example.com' }, userID: 'u1' });
  assert.equal(JSON.parse(withAccount('{"oauthAccount":{"emailAddress":"old@example.com"}}', '')).oauthAccount, undefined, 'a lender with no account leaves none');
});

test('only the person\'s own messages reach a Vanilla session', () => {
  assert.equal(bareMessage({}), true);
  assert.equal(bareMessage({ system: true }), false);
  assert.equal(bareMessage({ from: 'session' }), false);
  assert.equal(bareMessage({ from: 'brief' }), false);
});

test('Claude\'s sign-in is a file on Windows and Linux and a keychain entry on a Mac', () => {
  assert.deepEqual(claudeSignInStore({ home: 'C:\\x\\claude-home', platform: 'win32' }), { kind: 'file', file: path.join('C:\\x\\claude-home', '.credentials.json') });
  assert.equal(claudeSignInStore({ home: '/h/claude-home', platform: 'linux' }).kind, 'file');
  const mac = claudeSignInStore({ home: '/Users/t1/Docket/V/claude-home', platform: 'darwin', user: 't1' });
  assert.deepEqual(mac, { kind: 'keychain', service: 'Claude Code-credentials-' + createHash('sha256').update('/Users/t1/Docket/V/claude-home').digest('hex').slice(0, 8), account: 't1' });
  assert.equal(claudeSignInStore({ home: '/Users/t1/.claude', standard: true, platform: 'darwin' }).service, 'Claude Code-credentials');
  assert.deepEqual(keychainReadCommand(mac), { cmd: 'security', args: ['find-generic-password', '-s', mac.service, '-w'] });
  assert.deepEqual(keychainWriteCommand(mac, 'S'), { cmd: 'security', args: ['add-generic-password', '-U', '-a', 't1', '-s', mac.service, '-w', 'S'] });
});
