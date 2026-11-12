// Tests for the Merge card under a plain merge ask (index.html, #853, #951) and mark_turn's check of the pull
// request before it marks "merge" (reports.mjs, #951). Run with: npm test
// The page is one file with no modules, so the part under test is read out of it between its markers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mergeAskRefusal } from '../reports.mjs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.indexOf('// ---------- merge ask');
const end = page.indexOf('// end of merge ask');
assert.ok(start > 0 && end > start, 'the merge ask part of index.html has moved or lost its markers');
const S = { prs: {} };
const prState = (p) => p.status === 'open' && p.draft ? 'draft' : p.status;
const { mergeAskOf, MERGE_FIX } = new Function('S', 'prState', 'document', page.slice(start, end) + '\nreturn { mergeAskOf, MERGE_FIX };')(S, prState, { addEventListener() {} });

const mine = (number, extra = {}) => ({ number, mine: true, status: 'open', draft: false, checks: '', url: `https://github.com/o/r/pull/${number}`, ...extra });
const markMerge = (pr) => ({ k: 'tool', id: 't1', name: 'mcp__portal__mark_turn', input: { label: 'merge', pr } });
const reply = (text) => ({ k: 'text', id: 'm1:0', text });
const done = { k: 'result' };

test('a marked merge ask with its pull request open gets the Merge card', () => {
  S.prs.a = [mine(940)];
  const m = mergeAskOf('a', [{ k: 'user' }, markMerge(940), reply('Say merge and I will merge pull request #940.'), done]);
  assert.equal(m.pr.number, 940);
  assert.equal(m.fix, undefined);
});

test('the asked pull request turned conflicting: the card stays and offers the fix (#951, the case of #940)', () => {
  S.prs.a = [mine(940, { status: 'conflict' })];
  const m = mergeAskOf('a', [markMerge(940), reply('Say merge and I will merge pull request #940.'), done]);
  assert.equal(m?.fix, 'conflict');
  assert.match(MERGE_FIX.conflict.say(940), /#940 now has a conflict/);
  S.prs.a = [mine(940, { checks: 'fail' })];
  assert.equal(mergeAskOf('a', [markMerge(940), done])?.fix, 'checks');
});

test('another open pull request of its own no longer hides the card (#951)', () => {
  S.prs.a = [mine(930), mine(940, { checks: 'pass' })];
  assert.equal(mergeAskOf('a', [markMerge(940), done])?.pr.number, 940);
});

test('a final reply ending on the plain ask gets the card without mark_turn (#951)', () => {
  S.prs.a = [mine(940)];
  const m = mergeAskOf('a', [{ k: 'user' }, reply('Pull request #940 is open.\n\nSay merge and I will merge pull request #940.'), done]);
  assert.equal(m?.pr.number, 940);
  assert.equal(m.ask.id, 'm1:0');
  // not when the turn marked something else, nor when the reply asks something more after it
  assert.equal(mergeAskOf('a', [{ k: 'tool', id: 't', name: 'mcp__portal__mark_turn', input: { label: 'reply' } }, reply('Say merge and I will merge pull request #940.'), done]), null);
  assert.equal(mergeAskOf('a', [reply('Say merge and I will merge pull request #940. Or should I wait?'), done]), null);
});

test('no card while the turn runs, after a message, for a merged, draft or someone else\'s pull request, or while checks run', () => {
  S.prs.a = [mine(940)];
  assert.equal(mergeAskOf('a', [markMerge(940)]), null, 'turn still running');
  assert.equal(mergeAskOf('a', [markMerge(940), done, { k: 'user' }]), null, 'answered');
  for (const p of [mine(940, { status: 'merged' }), mine(940, { draft: true }), mine(940, { mine: false }), mine(940, { checks: 'pending' }), mine(941)]) {
    S.prs.a = [p];
    assert.equal(mergeAskOf('a', [markMerge(940), done]), null, JSON.stringify(p));
  }
});

test('mark_turn "merge" is refused for a pull request that cannot merge now, with what to do (#951)', () => {
  assert.equal(mergeAskRefusal(null, 940), '', 'GitHub could not say: marked');
  assert.equal(mergeAskRefusal({ status: 'unknown' }, 940), '');
  assert.equal(mergeAskRefusal({ status: 'open', checks: 'pass' }, 940), '');
  assert.equal(mergeAskRefusal({ status: 'open', checks: 'pending' }, 940), '', 'the card shows once checks pass');
  const conflict = mergeAskRefusal({ status: 'conflict' }, 940);
  assert.match(conflict, /^Not marked: pull request #940 has a conflict/);
  assert.match(conflict, /package\.json/);
  assert.match(conflict, /mark_turn with label "merge" again/);
  assert.match(mergeAskRefusal({ status: 'open', draft: true }, 940), /is a draft/);
  assert.match(mergeAskRefusal({ status: 'open', checks: 'fail' }, 940), /failing checks/);
  assert.match(mergeAskRefusal({ status: 'merged' }, 940), /already merged/);
  assert.match(mergeAskRefusal({ status: 'closed' }, 940), /is closed/);
});

test('server.mjs checks the asked pull request before it marks "merge" (#951)', () => {
  const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const i = src.indexOf("tool('mark_turn',");
  const body = src.slice(i, src.indexOf("tool('set_parent',", i));
  assert.match(body, /mergeAskRefusal\(await askedPrNow\(parent, pr\), pr\)/);
  assert.ok(body.indexOf('mergeAskRefusal') < body.indexOf('parent.turnSaid = label'), 'checked before the label is kept');
});
