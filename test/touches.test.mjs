// Tests for filling in touch times from the saved conversations (#617): which messages the person typed (in the
// shapes real Claude transcripts and Docket's kept chats write them), the merge with recorded touches, and that
// each desk is filled in only once. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { typedByUser, lastTyped, mergeTouches, messageFrom, DOCKET_BLOCK, SESSION_BLOCK } from '../touches.mjs';

const user = (content, more = {}) => ({ type: 'user', message: { role: 'user', content }, ...more });
const text = (t) => ({ type: 'text', text: t });

test('a message the person typed counts, with Docket\'s notes beside it', () => {
  assert.ok(typedByUser(user('Fix the list bar')));
  assert.ok(typedByUser(user([text('Fix the list bar'), text('(From Docket: this session\'s title is "x", one the user chose.)')])));
  assert.ok(typedByUser(user([text('Build it'), text('(From Docket: The user started this session from the portal, under the session "p" (id 1).)')])), 'a session the person started under another');
  assert.ok(typedByUser(user('/wrap')), 'a command typed into the page');
  assert.ok(typedByUser(user('<command-message>wrap</command-message>\n<command-name>/wrap</command-name>')), 'a command typed in a terminal');
  assert.ok(typedByUser(user([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x' } }, text('(Image also saved at C:/u/a.png)')])), 'only a picture');
});

test('tool results, side chains, Claude Code\'s own lines and compact summaries do not count', () => {
  assert.ok(!typedByUser(user([{ type: 'tool_result', tool_use_id: 't', content: 'ok' }], { toolUseResult: {} })));
  assert.ok(!typedByUser(user('Look in src', { isSidechain: true })), 'a subagent\'s prompt');
  assert.ok(!typedByUser(user('Base directory for this skill: C:/x', { isMeta: true })));
  assert.ok(!typedByUser(user('This session is being continued from a previous conversation', { isCompactSummary: true, isVisibleInTranscriptOnly: true })));
  assert.ok(!typedByUser(user('<local-command-stdout>Set model to Opus</local-command-stdout>')));
  assert.ok(!typedByUser(user([text('[Request interrupted by user for tool use]')])));
  assert.ok(!typedByUser(user('<system-reminder>x</system-reminder>')));
  assert.ok(!typedByUser({ type: 'assistant', message: { content: [text('Done')] } }));
  assert.ok(!typedByUser(user([text('  ')])));
});

test('messages from other sessions and from Docket do not count', () => {
  assert.ok(!typedByUser(user([text('Build #617'), text('(From Docket: This session was started by the session "p" (id 1) and is listed under it. When you finish a turn, that session gets a short report of your reply.)')])));
  assert.ok(!typedByUser(user([text('Added scope'), text('(Sent by the session "p" in the portal, id 1.)')])));
  assert.ok(!typedByUser(user([text('The brief'), text('(From Docket: this session continues the work of the session "p" (id 1), handed off to a fresh session.)')])));
  assert.ok(!typedByUser(user([text('The brief'), text('(From Docket: this work was handed over from the desk "Acme" and the user pressed Start in B\'s list.)')])), 'work from another desk');
  assert.ok(!typedByUser(user([text('<session-report>\n- "child" (id 2) finished a turn\n</session-report>')])));
  assert.ok(!typedByUser(user([text('<task-notification>done</task-notification>')])));
  assert.ok(!typedByUser(user([text('(From Docket: Docket restarted this session while it was working.)')])));
  assert.ok(!typedByUser(user([text('(From Docket: this conversation is at about 90% of the point where it compacts automatically.)')])));
  assert.ok(!typedByUser(user([text('(From the session portal: this session was switched to Shift mode.)')])));
});

test('the last typed message\'s time, from a Claude transcript and from a kept chat; a scheduled run\'s prompt is skipped', () => {
  const line = (o, at) => JSON.stringify({ ...o, timestamp: new Date(at).toISOString() });
  const claude = [
    line(user('first'), 1000), line(user([text('x'), text('(Sent by the session "p" in the portal, id 1.)')]), 5000),
    line(user('second'), 3000), line({ type: 'assistant', message: { content: [text('ok')] } }, 4000),
    line(user([{ type: 'tool_result', tool_use_id: 't', content: 'r' }]), 6000), 'not json "user"', '',
  ];
  assert.equal(lastTyped(claude), 3000);
  assert.equal(lastTyped([line(user('the schedule\'s prompt'), 1000)], { scheduled: true }), 0);
  assert.equal(lastTyped([line(user('the schedule\'s prompt'), 1000), line(user('a reply'), 2000)], { scheduled: true }), 2000);
  const kept = [JSON.stringify({ seq: null, at: 7000, msg: user([text('hello Grok')]) }), JSON.stringify({ seq: 3, at: 8000, msg: { type: 'assistant', message: { content: [text('hi')] } } })];
  assert.equal(lastTyped(kept), 7000);
  assert.equal(lastTyped([]), 0);
});

test('merging keeps the later time per session and lets go of touches older than the limit', () => {
  const day = 864e5, now = 100 * day;
  const got = mergeTouches({ a: now - day, b: now - 3 * day, old: now - 61 * day }, { a: now - 2 * day, b: now - day, c: now - 5 * day, gone: now - 70 * day, zero: 0 }, now, 60);
  assert.deepEqual(got, { a: now - day, b: now - day, c: now - 5 * day });
  assert.deepEqual(mergeTouches(undefined, { c: now }, now, 60), { c: now });
});

test('the chat still reads who wrote a message the same way (moved from server.mjs)', () => {
  assert.equal(messageFrom(['hi', '(From Docket: title)'], 0), '');
  assert.equal(messageFrom(['(From Docket: title)'], 0), 'docket');
  assert.equal(messageFrom(['x', '(Sent by the session "p", id 1.)'], 0), 'session');
  assert.ok(DOCKET_BLOCK.test('<session-report>') && SESSION_BLOCK.test('(Sent by the session'));
});

test('briefs Docket wrote or brought in read back as a brief, not typed (#867)', () => {
  const notes = [
    '(From Docket: this work was handed over from the desk "Acme" and the user pressed Start in B\'s list. It runs on B\'s own sign-in.)',
    '(From Docket: this session runs the scheduled task "Morning check" (id daily-1). The message above is the task\'s prompt, which the user wrote in the schedule.)',
    '(From Docket: the user chose to convert this desk\'s plans before switching its plan system.)',
    '(From Docket: the user started this session from Docket\'s setup check card for this desk.)',
  ];
  for (const n of notes) {
    assert.equal(messageFrom(['The long brief', n, '(From Docket: this session\'s title is "x", one the user chose.)'], 0), 'brief', n);
    assert.ok(DOCKET_BLOCK.test(n) && !SESSION_BLOCK.test(n));
    assert.ok(!typedByUser(user([text('The long brief'), text(n)])), n);
  }
  assert.equal(messageFrom(['x', '(From Docket: This session was started by the session "p" (id 1).)'], 0), 'session', 'another session still reads as one');
  assert.equal(messageFrom(['Fix it', '(From Docket: the user wants this done today.)'], 0), '', 'a note that only looks alike');
});

test('a scheduled run with Docket\'s note: the prompt is skipped and the person\'s first reply still counts', () => {
  const line = (o, at) => JSON.stringify({ ...o, timestamp: new Date(at).toISOString() });
  const prompt = user([text('Check the inbox'), text('(From Docket: this session runs the scheduled task "Inbox" (id s1). The message above is the task\'s prompt, which the user wrote in the schedule.)')]);
  assert.equal(lastTyped([line(prompt, 1000)], { scheduled: true }), 0);
  assert.equal(lastTyped([line(prompt, 1000), line(user('a reply'), 2000)], { scheduled: true }), 2000);
  assert.equal(lastTyped([line(prompt, 1000), line(user('a reply'), 2000)]), 2000, 'the note marks it even when the session lost its schedule');
});

// The server's part: runs fillTouches / fillAllTouches with pretend files and state.
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = server.indexOf('// ---------- filling in touch times');
const end = server.indexOf('// end of filling in touch times');
assert.ok(start > 0 && end > start, 'the touch filling part of server.mjs has moved or lost its markers');

function load({ files, archived = [], sessions = {} }) {
  const now = Date.now();
  const reads = [];
  const state = { touched: {}, sessions };
  const env = { saves: 0 };
  const fsStub = { promises: {
    stat: async (f) => ({ mtimeMs: files[f].mtime ?? now }),
    readFile: async (f) => { reads.push(f); return files[f].text; },
  } };
  const CLIENTS = [{ id: 'a' }, { id: 'b' }];
  const fn = new Function('state', 'fs', 'CLIENTS', 'TOUCH_DAYS', 'transcriptFiles', 'keptChatFiles', 'wasDeleted', 'isArchived', 'lastTyped', 'mergeTouches', 'logEvent', 'keepChanged',
    server.slice(start, end) + '\nreturn { fillTouches, fillAllTouches };');
  const own = (c) => new Map(Object.keys(files).filter((f) => f.startsWith(c.id + '/')).map((f) => [f.split('/')[1], f]));
  const api = fn(state, fsStub, CLIENTS, 60, own, () => new Map(), () => false, (c, id) => archived.includes(id), lastTyped, mergeTouches, () => {}, () => { env.saves++; });
  return { ...api, state, reads, env, now };
}

test('each desk is filled in once: archived sessions and old files are skipped, recorded touches merged', async () => {
  const now = Date.now(), day = 864e5;
  const t = (at, msg = 'hi') => JSON.stringify({ ...user(msg), timestamp: new Date(at).toISOString() });
  const { fillAllTouches, state, reads, env } = load({
    files: {
      'a/s1': { text: t(now - day) }, 'a/s2': { text: t(now - 2 * day) }, 'a/arch': { text: t(now) },
      'a/old': { text: t(now - 90 * day), mtime: now - 90 * day }, 'b/s3': { text: t(now - 3 * day) },
    },
    archived: ['arch'],
  });
  state.touched.a = { s2: now - 60000 }; // touched since 1.123.0: the later one stays
  await fillAllTouches();
  assert.deepEqual(state.touched.a, { s1: now - day, s2: now - 60000 });
  assert.deepEqual(state.touched.b, { s3: now - 3 * day });
  assert.deepEqual(state.touchesFilled, { a: true, b: true });
  assert.deepEqual(reads.sort(), ['a/s1', 'a/s2', 'b/s3']);
  assert.equal(env.saves, 2);
  await fillAllTouches();
  assert.equal(reads.length, 3, 'never read again');
  assert.equal(env.saves, 2);
});

test('the server fills them in the background after starting, and the chat uses the moved functions', () => {
  assert.match(server, /setTimeout\(\(\) => fillAllTouches\(\), \d+\)/);
  assert.match(server, /import \{ DOCKET_BLOCK, SESSION_BLOCK, messageFrom, lastTyped, mergeTouches \} from '\.\/touches\.mjs';/);
  assert.doesNotMatch(server, /^const DOCKET_BLOCK =/m);
});
