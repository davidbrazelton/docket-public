// Tests for first-start.mjs, a session whose first start never reached Claude Code (#759). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { freePorts } from './free-port.mjs';
import { cutOffNote, newCutOff } from '../cut-off.mjs';
import { netError, refused, netText, withRetries, noConversation, startMode, continueNudge, firstMessage, reportText, firstStore, START_RETRY_MS, CONTINUE_TEXT } from '../first-start.mjs';

const fetchFailed = (code) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });

test('a request that got no answer is a network error; one the runner answered is not', () => {
  assert.equal(netError(fetchFailed('ECONNREFUSED')), 'ECONNREFUSED');
  assert.equal(netError(fetchFailed('UND_ERR_SOCKET')), 'UND_ERR_SOCKET');
  assert.equal(netError(new TypeError('fetch failed')), 'fetch failed');
  assert.equal(netError(new Error('No such session in the runner')), '');
  assert.equal(netError(null), '');
  assert.equal(refused(fetchFailed('ECONNREFUSED')), true);
  assert.equal(refused(fetchFailed('ECONNRESET')), false, 'a reset may have got there: a message is not sent twice');
  assert.equal(netText(fetchFailed('ECONNREFUSED')), 'fetch failed (ECONNREFUSED)');
  assert.equal(netText(new Error('boom')), 'boom');
});

test('withRetries: tries again after each wait while the error is a network one, then gives up', async () => {
  const waits = [], tries = [];
  const sleep = async (ms) => { waits.push(ms); };
  let n = 0;
  const out = await withRetries(async (i) => { tries.push(i); if (++n < 3) throw fetchFailed('ECONNREFUSED'); return 'started'; }, { sleep, onRetry: (e, k, w) => tries.push(`retry ${k} in ${w}`) });
  assert.equal(out, 'started');
  assert.deepEqual(waits, START_RETRY_MS.slice(0, 2));
  assert.deepEqual(tries, [0, 'retry 1 in 1000', 1, 'retry 2 in 2000', 2]);

  waits.length = 0;
  await assert.rejects(withRetries(async () => { throw fetchFailed('ECONNREFUSED'); }, { sleep }), /fetch failed/);
  assert.deepEqual(waits, START_RETRY_MS, 'every wait, about a minute in all');
  assert.ok(START_RETRY_MS.reduce((a, b) => a + b) >= 55_000);

  waits.length = 0;
  await assert.rejects(withRetries(async () => { throw new Error('Unknown control'); }, { sleep }), /Unknown control/);
  assert.deepEqual(waits, [], 'an answer from the runner is not tried again');
});

test('withRetries reaches a server that comes up late (a runner restarting)', async () => {
  const [port] = await freePorts(1);
  const server = http.createServer((req, res) => res.end('{"ok":true}'));
  setTimeout(() => server.listen(port, '127.0.0.1'), 700);
  try {
    let failed = 0;
    const r = await withRetries(() => fetch(`http://127.0.0.1:${port}/health`).then((x) => x.json()), { delays: [300, 300, 300, 300, 300, 300], onRetry: () => failed++ });
    assert.deepEqual(r, { ok: true });
    assert.ok(failed >= 1, 'it failed first, with fetch failed');
  } finally { server.close(); }
});

test('the resume error Claude Code gives for an id it has no conversation for', () => {
  assert.equal(noConversation('Claude Code returned an error result: No conversation found with session ID: 45b285d0-579e-4932-9c8d-a68ae211bad0'), true);
  assert.equal(noConversation('No conversation found with session ID: x'), true);
  assert.equal(noConversation('API Error: 529 overloaded'), false);
  assert.equal(noConversation(undefined), false);
});

test('startMode: a known session with no transcript starts afresh; one with a transcript resumes; other brands keep theirs', () => {
  assert.equal(startMode({ resumeId: null }), 'new');
  assert.equal(startMode({ resumeId: 'a', hasTranscript: true }), 'resume');
  assert.equal(startMode({ resumeId: 'a', hasTranscript: false }), 'fresh', 'its first message never reached Claude Code');
  assert.equal(startMode({ resumeId: 'a', hasTranscript: true, fresh: true }), 'fresh', 'a resume that failed with No conversation found');
  assert.equal(startMode({ engine: 'grok', resumeId: 'a', hasTranscript: false }), 'resume');
  assert.equal(startMode({ engine: 'codex', resumeId: 'a', hasTranscript: false }), 'resume');
});

test('continueNudge: the Continue button and the automatic continue, not a real message', () => {
  assert.equal(continueNudge({ text: CONTINUE_TEXT + ' Your last reply was cut off before it finished, so check what state things are in first.' }), true);
  assert.equal(continueNudge({ text: '', system: true, context: cutOffNote(newCutOff('runner', null)) }), true);
  assert.equal(continueNudge({ text: 'Please continue with the tests' }), false);
  assert.equal(continueNudge({ text: '', system: true, context: '<session-report>…' }), false, 'a report is real work');
});

test('firstMessage: the kept one, else the first message the chat shows, else the last one sent', () => {
  const kept = { at: 1, message: { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'the brief' }, { type: 'image', source: {} }] }, parent_tool_use_id: null } };
  assert.equal(firstMessage({ kept, events: [{ k: 'user', text: 'other' }] }), kept.message, 'attachments and all');
  const fromChat = firstMessage({ events: [{ k: 'note', text: 'Started' }, { k: 'user', text: 'the brief from the chat' }, { k: 'user', text: 'later' }] });
  assert.deepEqual(fromChat, { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'the brief from the chat' }] }, parent_tool_use_id: null });
  const last = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'last' }] } };
  assert.equal(firstMessage({ events: [], last }), last);
  assert.equal(firstMessage({ events: [] }), null);
});

test('reportText: no empty report for a turn with no reply', () => {
  assert.equal(reportText('Done: PR #12'), 'Done: PR #12');
  assert.equal(reportText('', { error: 'error_during_execution' }), '(No reply: the turn ended with an error: error_during_execution)');
  assert.equal(reportText(''), '(No reply text)');
});

test('firstStore keeps the first message only, until it is dropped', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'docket-759-')), 'first-messages');
  const store = firstStore(dir);
  const id = '45b285d0-579e-4932-9c8d-a68ae211bad0';
  assert.equal(store.has(id), false);
  assert.equal(store.read(id), null);
  assert.equal(store.save(id, { n: 1 }), true);
  assert.equal(store.save(id, { n: 2 }), false, 'a later message does not replace it');
  assert.deepEqual(store.read(id).message, { n: 1 });
  assert.equal(store.drop(id), true);
  assert.equal(store.has(id), false);
  assert.equal(store.drop(id), false);
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});
