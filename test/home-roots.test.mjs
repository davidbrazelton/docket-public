import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { homeRootsFor } from '../home-roots.mjs';

const user = path.resolve('C:/Users/pat');
const r = (p) => path.resolve(p);

test('a fresh install downloaded to C:/Temp suggests the user folder, not C:/Temp', () => {
  const roots = homeRootsFor([], r('C:/Temp/docket'), user, true);
  assert.equal(roots.claude, r('C:/Users/pat/Docket'));
  assert.equal(roots.grok, r('C:/Users/pat/Docket/grok_home'));
  assert.equal(roots.codex, r('C:/Users/pat/Docket/codex_home'));
  assert.equal(roots.docket, r('C:/Temp/docket'));
  assert.equal(roots.fresh, true, 'no company home to sit beside: the wizard puts new homes next to the working folder');
  assert.equal(homeRootsFor([{ name: 'A', home: 'C:/Work/A/claude-home' }], r('C:/Temp/docket'), user, true).fresh, false);
});

test('a fresh install cloned to <user>/Docket moves the homes aside, never inside Docket', () => {
  assert.equal(homeRootsFor([], r('C:/Users/pat/docket'), user, true).claude, r('C:/Users/pat/Docket desks'));
  // Docket in the user folder itself: neither user-folder root works, so the folder above Docket's.
  assert.equal(homeRootsFor([], user, user, true).claude, r('C:/Users'));
});

test('existing companies: new homes still go beside them', () => {
  const clients = [
    { name: 'Acme', home: 'C:/Work/Companies/Acme/claude-home', grokHome: 'C:/Work/grok_home/Acme', codexHome: 'D:/codex/Acme' },
  ];
  const roots = homeRootsFor(clients, r('C:/Temp/docket'), user, true);
  assert.equal(roots.claude, r('C:/Work/Companies'));
  assert.equal(roots.grok, r('C:/Work/grok_home'));
  assert.equal(roots.codex, r('D:/codex'));
  // Only a Claude home: Grok and Codex go under its root, as on a fresh install.
  const only = homeRootsFor([{ name: 'Acme', home: 'C:/Work/Companies/Acme/claude-home' }], r('C:/Temp/docket'), user, true);
  assert.equal(only.grok, r('C:/Work/Companies/grok_home'));
  assert.equal(only.codex, r('C:/Work/Companies/codex_home'));
});

test('a home not named claude-home, or one inside Docket, does not count as one to sit beside', () => {
  const clients = [
    { name: 'A', home: 'C:/Users/pat/.claude' },
    { name: 'B', home: 'C:/Temp/docket/B/claude-home' },
  ];
  assert.equal(homeRootsFor(clients, r('C:/Temp/docket'), user, true).claude, r('C:/Users/pat/Docket'));
});

test('a second company after a fresh first one gets the same Grok and Codex folders as the first', () => {
  const docket = r('C:/Temp/docket');
  const fresh = homeRootsFor([], docket, user, true);
  // The first company, Codex only, made with the fresh install's defaults.
  const first = { name: 'CodexTest', home: path.join(fresh.claude, 'CodexTest', 'claude-home'), codexHome: path.join(fresh.codex, 'CodexTest') };
  const next = homeRootsFor([first], docket, user, true);
  assert.equal(next.claude, fresh.claude);
  assert.equal(next.grok, fresh.grok);
  assert.equal(next.codex, fresh.codex);
  assert.equal(next.grok, r('C:/Users/pat/Docket/grok_home'));
  // Same when the first company has no Codex or Grok home at all.
  const claudeOnly = homeRootsFor([{ name: 'A', home: path.join(fresh.claude, 'A', 'claude-home') }], docket, user, true);
  assert.equal(claudeOnly.grok, fresh.grok);
  assert.equal(claudeOnly.codex, fresh.codex);
});
