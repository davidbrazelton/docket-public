// Whether a home folder the setup wizard suggests already holds a setup, and the free folder it offers instead.
// Every folder here is made up, in a temp folder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { homeInUse, freeHome } from '../home-in-use.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-320-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const put = (rel, text = '{}') => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const jwt = (claims) => ['x', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'y'].join('.');

test('a Claude home in use: signed in as whom, and how many saved sessions', () => {
  put('Claude/Acme/claude-home/.credentials.json');
  put('Claude/Acme/claude-home/.claude.json', JSON.stringify({ oauthAccount: { emailAddress: 'pat@acme.com' } }));
  for (const [proj, n] of [['C--Work-a', 3], ['C--Work-b', 2]]) for (let i = 0; i < n; i++) put(`Claude/Acme/claude-home/projects/${proj}/s${i}.jsonl`, '');
  put('Claude/Acme/claude-home/projects/C--Work-a/memory/MEMORY.md', '');
  assert.deepEqual(homeInUse(path.join(tmp, 'Claude/Acme/claude-home'), 'claude'), { signedIn: true, email: 'pat@acme.com', sessions: 5 });
});

test('a missing, empty or unrelated folder holds no setup', () => {
  assert.equal(homeInUse(path.join(tmp, 'nowhere'), 'claude'), null);
  fs.mkdirSync(path.join(tmp, 'empty'));
  assert.equal(homeInUse(path.join(tmp, 'empty'), 'claude'), null);
  put('notes/readme.txt', 'hi');
  for (const e of ['claude', 'grok', 'codex']) assert.equal(homeInUse(path.join(tmp, 'notes'), e), null);
});

test('a Claude home with sessions but no sign-in still counts, as not signed in', () => {
  put('Claude/Old/claude-home/projects/C--x/a.jsonl', '');
  assert.deepEqual(homeInUse(path.join(tmp, 'Claude/Old/claude-home'), 'claude'), { signedIn: false, email: '', sessions: 1 });
});

test('Codex and Grok homes: sign-in file, email when it says, sessions counted', () => {
  put('codex_home/Acme/auth.json', JSON.stringify({ tokens: { id_token: jwt({ email: 'pat@acme.com' }) } }));
  put('codex_home/Acme/sessions/2026/10/28/rollout-1.jsonl', '');
  put('codex_home/Acme/sessions/2026/10/27/rollout-2.jsonl', '');
  put('codex_home/Acme/archived_sessions/rollout-0.jsonl', '');
  assert.deepEqual(homeInUse(path.join(tmp, 'codex_home/Acme'), 'codex'), { signedIn: true, email: 'pat@acme.com', sessions: 3 });
  put('grok_home/Acme/auth.json', JSON.stringify({ 'https://auth.x.ai::1': { email: 'pat@acme.com' } }));
  for (const id of ['s1', 's2']) put(`grok_home/Acme/sessions/C%3A%5CWork/${id}/events.jsonl`, '');
  assert.deepEqual(homeInUse(path.join(tmp, 'grok_home/Acme'), 'grok'), { signedIn: true, email: 'pat@acme.com', sessions: 2 });
});

test('the free folder beside one in use: the company folder takes the number, skipping ones that exist or are taken', () => {
  const r = (p) => path.resolve(p);
  const exists = (p) => [r('C:/Work/Claude/Acme-2')].includes(r(p));
  assert.equal(freeHome('C:/Work/Claude/Acme/claude-home', [], exists), r('C:/Work/Claude/Acme-3/claude-home'));
  assert.equal(freeHome('C:/Work/Claude/Acme/claude-home', [r('C:/Work/Claude/Acme-3/claude-home').toLowerCase()], exists), r('C:/Work/Claude/Acme-4/claude-home'));
  assert.equal(freeHome('C:/Work/Claude/grok_home/Acme', [], () => false), r('C:/Work/Claude/grok_home/Acme-2'));
  // One already numbered counts on from its own name, not Acme-2-2.
  assert.equal(freeHome('C:/Work/Claude/Acme-2/claude-home', [], (p) => r(p) === r('C:/Work/Claude/Acme-2')), r('C:/Work/Claude/Acme-3/claude-home'));
});
