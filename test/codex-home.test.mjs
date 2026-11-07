// Finding the codex program and reading what it says about a sign-in. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findCodexExe, codexSignedIn, codexDeviceLink, codexCommand, codexAccount } from '../codex-home.mjs';

test('the codex program is found in the desktop app folder, the newest copy first', () => {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-exe-'));
  const name = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const bin = path.join(local, 'OpenAI', 'Codex', 'bin');
  for (const [hash, t] of [['old111', 1000], ['new222', 2000]]) {
    fs.mkdirSync(path.join(bin, hash), { recursive: true });
    const f = path.join(bin, hash, name);
    fs.writeFileSync(f, '');
    fs.utimesSync(f, t, t);
  }
  assert.equal(findCodexExe({ LOCALAPPDATA: local }), path.join(bin, 'new222', name));
  assert.equal(findCodexExe({ LOCALAPPDATA: local, PORTAL_CODEX_EXE: 'C:/x/fake.mjs' }), 'C:/x/fake.mjs');
});

test('a stand-in written in JavaScript runs with node', () => {
  assert.deepEqual(codexCommand('C:/t/fake-codex.mjs', ['login', 'status']), [process.execPath, ['C:/t/fake-codex.mjs', 'login', 'status']]);
  assert.deepEqual(codexCommand('C:/c/codex.exe', ['app-server']), ['C:/c/codex.exe', ['app-server']]);
});

test('signed in is the exit code of `codex login status`', () => {
  assert.equal(codexSignedIn(0, ''), true); // it writes "Logged in using ChatGPT" on its error output
  assert.equal(codexSignedIn(1, ''), false);
  assert.equal(codexSignedIn(0, 'Not logged in'), false);
});

test('the device sign-in link and its separate code are read from what codex prints', () => {
  const out = 'Welcome to Codex [v\x1b[90m0.163.0-alpha.10.2\x1b[0m]\n\n1. Open this link in your browser and sign in to your account\n   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\n\n2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m\n   \x1b[94mLO11-IXSZG\x1b[0m\n';
  assert.deepEqual(codexDeviceLink(out), { url: 'https://auth.openai.com/codex/device', code: 'LO11-IXSZG' });
  assert.equal(codexDeviceLink('Welcome to Codex\n1. Open this link\n   https://auth.openai.com/codex/device\n'), null, 'no code yet');
});

test('who a Codex home is signed in as: the email and ChatGPT plan from its id token, or an API key', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-acct-'));
  const claims = { email: 'a@example.com', 'https://api.openai.com/auth': { chatgpt_plan_type: 'team' } };
  const token = `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
  fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: { id_token: token } }));
  assert.deepEqual(codexAccount(home), { email: 'a@example.com', plan: 'ChatGPT Team' });
  fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-test' }));
  assert.deepEqual(codexAccount(home), { email: 'an OpenAI API key', plan: null });
  assert.deepEqual(codexAccount(path.join(home, 'none')), { email: null, plan: null });
});
