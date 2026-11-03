// Sessions Claude Desktop ran show the orange "needs you" dot (needs-you.mjs: desktopTurn, desktopWaiting), and how
// that rule meets Bring in, which copies conversation files into a desk's Claude home. Run with: npm test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { desktopTurn, desktopWaiting } from '../needs-you.mjs';
import { sourceHomes, findGroups, planRun, copyRun } from '../bring-in.mjs';

const T = (m) => `2026-10-01T10:${String(m).padStart(2, '0')}:00.000Z`;
const at = (m) => Date.parse(T(m));
const ask = (m, entrypoint = 'claude-desktop') => ({ type: 'user', entrypoint, timestamp: T(m), message: { role: 'user', content: 'Work through the apps' } });
const reply = (m, extra = {}, entrypoint = 'claude-desktop') => ({ type: 'assistant', entrypoint, timestamp: T(m),
  message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done. Three questions for you.' }] }, ...extra });
const tool = (m, name = 'Bash') => ({ type: 'assistant', entrypoint: 'claude-desktop', timestamp: T(m),
  message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name, input: {} }] } });
// What Claude Code writes after a reply: none of it is a turn.
const tail = [{ type: 'system', subtype: 'stop_hook_summary', entrypoint: 'claude-desktop', timestamp: T(59) }, { type: 'last-prompt' }, { type: 'cost-state' }];

test('a finished Desktop reply waits on the person; the bookkeeping lines after it do not count', () => {
  assert.deepEqual(desktopTurn([ask(1), reply(2), ...tail]), { at: at(2), waiting: true, why: 'reply' });
});

test('a question, a plan to approve, or an error waits too; a tool still running does not', () => {
  assert.equal(desktopTurn([ask(1), tool(2, 'AskUserQuestion')]).why, 'question');
  assert.equal(desktopTurn([ask(1), tool(2, 'ExitPlanMode')]).waiting, true);
  assert.deepEqual(desktopTurn([ask(1), reply(2, { isApiErrorMessage: true })]), { at: at(2), waiting: true, why: 'error' });
  assert.deepEqual(desktopTurn([ask(1), tool(2)]), { at: at(2), waiting: false, why: 'working' });
});

test('the person writing last, or a tool result last, is not waiting', () => {
  assert.equal(desktopTurn([ask(1), reply(2), ask(3)]), null);
  assert.equal(desktopTurn([ask(1), tool(2), { type: 'user', timestamp: T(3), message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } }]), null);
});

test('Docket\'s own replies and terminal ones are left to Docket\'s own rules', () => {
  assert.equal(desktopTurn([ask(1, 'sdk-ts'), reply(2, {}, 'sdk-ts')]), null);
  assert.equal(desktopTurn([ask(1, 'cli'), reply(2, {}, 'cli')]), null);
  // Started in Desktop, continued in Docket: Docket wrote the last turn.
  assert.equal(desktopTurn([ask(1), reply(2), ask(3, 'sdk-ts'), reply(4, {}, 'sdk-ts')]), null);
  // Started in Docket, continued in Desktop: Desktop wrote the last turn.
  assert.equal(desktopTurn([ask(1, 'sdk-ts'), reply(2, {}, 'sdk-ts'), ask(3), reply(4)]).at, at(4));
  // Side work (subagents) and meta lines are skipped.
  assert.equal(desktopTurn([ask(1), reply(2), { ...ask(3), isMeta: true }, { ...ask(4), isSidechain: true }]).at, at(2));
});

test('orange until opened in Docket, with no time limit; a newer Desktop reply turns it orange again', () => {
  const turn = desktopTurn([ask(1), reply(2)]);
  assert.equal(desktopWaiting({ turn, seenAt: undefined }), true, 'never opened in Docket');
  assert.equal(desktopWaiting({ turn: { ...turn, at: Date.parse('2025-01-01') }, seenAt: undefined }), true, 'a very old reply still counts');
  assert.equal(desktopWaiting({ turn, seenAt: at(3) }), false, 'opened after the reply');
  const newer = desktopTurn([ask(1), reply(2), ask(4), reply(5)]);
  assert.equal(desktopWaiting({ turn: newer, seenAt: at(3) }), true, 'a newer reply after opening');
  assert.equal(desktopWaiting({ turn: desktopTurn([ask(1), tool(2)]), seenAt: undefined }), false, 'still working');
  assert.equal(desktopWaiting({ turn: null, seenAt: undefined }), false, 'not a Desktop turn');
});

// ---------- Bring in ----------
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'docket-desktop-')));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const parse = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
function desk() {
  const root = fs.mkdtempSync(path.join(tmp, 'pc-'));
  const user = path.join(root, 'Users', 'pat'), own = path.join(user, '.claude'), target = path.join(root, 'Docket', 'Evan', 'claude-home');
  fs.mkdirSync(path.join(target, 'projects'), { recursive: true });
  const f = path.join(own, 'projects', 'C--Work', 'd1.jsonl');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, [ask(1), reply(2), ...tail].map((x) => JSON.stringify(x)).join('\n') + '\n');
  return { user, target, f };
}
const bringIn = async ({ user, target }) => {
  const groups = findGroups({ homes: sourceHomes({ userHome: user, target }).homes, target });
  return copyRun(planRun({ groups, picked: groups.map((g) => g.key), target, client: 'evan' }));
};

test('a Desktop session just brought in shows orange at once when its finished reply was never opened in Docket', async () => {
  const d = desk();
  const run = await bringIn(d);
  assert.deepEqual(run.items.map((i) => i.status), ['copied']);
  assert.equal(desktopWaiting({ turn: desktopTurn(parse(run.items[0].to)), seenAt: undefined }), true);
});

test('the copy\'s new modified time does not make an old reply look new: the reply\'s own time is what counts', async () => {
  const d = desk();
  const run = await bringIn(d);
  const copy = run.items[0].to;
  fs.utimesSync(copy, new Date(), new Date()); // as on a computer where copying gives the file today's time
  assert.equal(desktopTurn(parse(copy)).at, at(2));
  assert.equal(desktopWaiting({ turn: desktopTurn(parse(copy)), seenAt: at(3) }), false, 'opened in Docket after that reply');
});

test('bringing in writes no Docket record: the copy keeps any seen time already saved for that session', async () => {
  const d = desk();
  const state = { sessions: { d1: { client: 'evan', seenAt: at(3) } } };
  const before = JSON.stringify(state);
  const run = await bringIn(d); // copyRun is given no state, so it cannot create or overwrite a record
  assert.equal(JSON.stringify(state), before);
  assert.equal(desktopWaiting({ turn: desktopTurn(parse(run.items[0].to)), seenAt: state.sessions.d1.seenAt }), false);
});

test('a session brought in twice is skipped the second time, and its dot does not change', async () => {
  const d = desk();
  const first = await bringIn(d);
  const copy = first.items[0].to, stat = fs.statSync(copy);
  const turn = desktopTurn(parse(copy));
  const groups = findGroups({ homes: sourceHomes({ userHome: d.user, target: d.target }).homes, target: d.target });
  assert.deepEqual(groups.flatMap((g) => g.sessions.map((s) => s.status)), ['here']);
  const again = planRun({ groups, picked: groups.map((g) => g.key), target: d.target, client: 'evan' });
  assert.equal(again.items.length, 0, 'nothing to bring in');
  assert.equal(fs.statSync(copy).mtimeMs, stat.mtimeMs, 'the copy is not touched');
  assert.deepEqual(desktopTurn(parse(copy)), turn);
});
