// Tests for recall.mjs: reading a compacted transcript back, and when the save-before-compact turn is due. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readEntries, searchEntries, lastUserMessages, readEntry, saveDue, cleanSaveShare, saveShare, breakCompactDue, COMPACT_AT_BREAK } from '../recall.mjs';

const docketBlock = /^(\(From Docket:|\(From the session portal:|<session-report>|\(Sent by the session|<task-notification>)/;
const sessionBlock = /^(\(Sent by the session|\(From Docket: This session was started by the session|\(From Docket: this session continues the work)/;
const at = (m) => `2026-10-27T10:${String(m).padStart(2, '0')}:00.000Z`;
const user = (m, content, extra = {}) => ({ type: 'user', timestamp: at(m), message: { role: 'user', content }, ...extra });
const asst = (m, content) => ({ type: 'assistant', timestamp: at(m), message: { role: 'assistant', content } });

async function fixture() {
  const lines = [
    user(1, [{ type: 'text', text: 'Merge it when the review is clean.' }, { type: 'text', text: '(From Docket: this session\'s title is "x".)' }]),
    asst(2, [{ type: 'text', text: 'Merging now.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'gh pr merge 42 --squash' } }]),
    user(3, [{ type: 'tool_result', tool_use_id: 't1', content: 'Merged pull request #42 as abc1234def' }]),
    { type: 'api-request-blob', blob: 'x'.repeat(1000) },
    asst(3, [{ type: 'text', text: 'side chatter abc1234def' }]),
    { type: 'system', subtype: 'compact_boundary', timestamp: at(4) },
    user(4, 'This session is being continued from a previous conversation. Summary: merged a PR.', { isCompactSummary: true }),
    user(5, [{ type: 'text', text: '<system-reminder>noise</system-reminder>' }]),
    user(6, [{ type: 'text', text: '(From Docket: this conversation is at about 86%...)' }]),
    user(7, [{ type: 'text', text: 'what was the merge SHA?' }]),
  ];
  lines[4].isSidechain = true;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'recall-')), 's.jsonl');
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return readEntries(file, { docketBlock, sessionBlock });
}

test('reads a transcript into numbered entries, with the compact count, skipping summaries, side chains and noise', async () => {
  const r = await fixture();
  assert.equal(r.compacts, 1);
  assert.deepEqual(r.entries.map((e) => [e.kind, e.seg]), [['person', 0], ['reply', 0], ['tool', 0], ['result', 0], ['docket', 1], ['person', 1]]);
  assert.equal(r.entries[0].text, 'Merge it when the review is clean.'); // Docket's block left out of what the person typed
  assert.equal(r.entries[3].name, 'Bash');
});

test('search finds a SHA from before the compact, newest first, labelled', async () => {
  const r = await fixture();
  const out = searchEntries(r, 'ABC1234DEF');
  assert.match(out, /^1 entry match/);
  assert.match(out, /#4 · 2026-10-27 10:03 UTC · before compact 1 · tool result Bash\n.*Merged pull request #42 as abc1234def/);
  assert.match(searchEntries(r, 'merge'), /^4 entries[\s\S]*\n#6 [\s\S]*\n#4 [\s\S]*\n#3 [\s\S]*\n#1 /); // newest first
  assert.match(searchEntries(r, 'nothing here'), /^Nothing in this conversation/);
  assert.match(searchEntries(r, 'merge', { kinds: ['person'] }), /^2 entries match/);
});

test('last user messages are verbatim and oldest first; one entry reads whole', async () => {
  const r = await fixture();
  const out = lastUserMessages(r, 2);
  assert.ok(out.indexOf('Merge it when the review is clean.') < out.indexOf('what was the merge SHA?'));
  assert.match(out, /since the last compact · the user wrote\nwhat was the merge SHA\?/);
  assert.match(readEntry(r, 3), /gh pr merge 42/);
  assert.match(readEntry(r, 99), /^No entry #99/);
});

test('the save turn is due once per cycle, at the share, and comes back only after the context falls well below it', () => {
  const base = { compactAt: 100000, share: 85 };
  assert.equal(saveDue({ ...base, tokens: 84000 }), null);
  assert.equal(saveDue({ ...base, tokens: 85000 }), 'send');
  assert.equal(saveDue({ ...base, tokens: 95000, prompted: 1 }), null);
  assert.equal(saveDue({ ...base, tokens: 60000, prompted: 1 }), 'rearm');
  assert.equal(saveDue({ ...base, tokens: 95000, share: 0 }), null);
  assert.equal(saveDue({ ...base, tokens: 95000, compactAt: null }), null);
});

test('a company\'s share: empty is the default, 0 or off turns it off, 50 to 99 otherwise', () => {
  assert.equal(cleanSaveShare(''), undefined);
  assert.equal(cleanSaveShare('0'), 0);
  assert.equal(cleanSaveShare('off'), 0);
  assert.equal(cleanSaveShare('90%'), 90);
  assert.ok(cleanSaveShare('40').error);
  assert.ok(cleanSaveShare('abc').error);
  assert.equal(saveShare({}), 85);
  assert.equal(saveShare({ saveBeforeCompact: 0 }), 0);
  assert.equal(saveShare({ saveBeforeCompact: 92 }), 92);
});

test('compact at a break, when turned on: above the share, idle a few minutes, cache still warm, once per compact cycle, after the save turn (#747)', () => {
  const MIN = 60000, now = 1e12;
  const cfg = { ...COMPACT_AT_BREAK, share: 80 }; // off by default; the logic as it runs when turned on
  const b = { tokens: 140000, compactAt: 167000, lastReplyAt: now - 5 * MIN, cacheTtl: 3600, now, cfg };
  assert.equal(COMPACT_AT_BREAK.share, 0);
  assert.equal(breakCompactDue({ ...b, cfg: COMPACT_AT_BREAK }), false);
  assert.equal(breakCompactDue(b), true);
  assert.equal(breakCompactDue({ ...b, tokens: 120000 }), false); // under 80%
  assert.equal(breakCompactDue({ ...b, lastReplyAt: now - 2 * MIN }), false); // not idle long enough
  assert.equal(breakCompactDue({ ...b, lastReplyAt: now - 61 * MIN }), false); // cache gone: auto-compact will do
  assert.equal(breakCompactDue({ ...b, saved: false }), false); // the save turn goes first
  assert.equal(breakCompactDue({ ...b, sentAt: now - 3 * MIN }), false); // sent this cycle
  assert.equal(breakCompactDue({ ...b, sentAt: now - 90 * MIN, compactedAt: now - 80 * MIN }), true); // a new cycle
  assert.equal(breakCompactDue({ ...b, compactedAt: now - MIN }), false); // its last reply is from before the compact
  assert.equal(breakCompactDue({ ...b, compactAt: null }), false);
    // a 5-minute cache: after half of it, and before it runs out
  assert.equal(breakCompactDue({ ...b, cacheTtl: 300, lastReplyAt: now - 3 * MIN }), true);
  assert.equal(breakCompactDue({ ...b, cacheTtl: 300, lastReplyAt: now - 2 * MIN }), false);
  assert.equal(breakCompactDue({ ...b, cacheTtl: 300, lastReplyAt: now - 5 * MIN }), false);
});
