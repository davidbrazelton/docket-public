// Tests for runner-watch.mjs, deciding whether the session runner is gone (#1124). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { probeVerdict, probeOnce, decideRunner, PROBE_TIMEOUT_MS, LATE_SLACK_MS } from '../runner-watch.mjs';
import { freePorts } from './free-port.mjs';

const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
const timedOut = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

test('an answer is up; a refused connection is a real miss however long it took', () => {
  assert.equal(probeVerdict({ ok: true, elapsedMs: 15_000 }), 'up');
  assert.equal(probeVerdict({ ok: false, error: refused, elapsedMs: 5 }), 'down');
  assert.equal(probeVerdict({ ok: false, error: refused, elapsedMs: 15_000 }), 'down');
});

test('a timeout counts only when its timer fired on time; a late one means the app stalled', () => {
  assert.equal(probeVerdict({ ok: false, error: timedOut, elapsedMs: PROBE_TIMEOUT_MS + 20 }), 'down');
  assert.equal(probeVerdict({ ok: false, error: timedOut, elapsedMs: PROBE_TIMEOUT_MS + LATE_SLACK_MS }), 'down');
  assert.equal(probeVerdict({ ok: false, error: timedOut, elapsedMs: PROBE_TIMEOUT_MS + LATE_SLACK_MS + 1 }), 'unsure');
  assert.equal(probeVerdict({ ok: false, error: timedOut, elapsedMs: 17_000 }), 'unsure');
});

const seq = (...verdicts) => { let i = 0; return async () => ({ verdict: verdicts[Math.min(i++, verdicts.length - 1)], body: { ok: true, pid: 7 } }); };
const noSleep = async () => {};

test('gone only after three real misses in a row', async () => {
  assert.deepEqual(await decideRunner(seq('down', 'down', 'down'), { sleep: noSleep }), { state: 'down', probes: 3, unsure: 0 });
  const r = await decideRunner(seq('down', 'down', 'up'), { sleep: noSleep });
  assert.equal(r.state, 'up');
  assert.deepEqual(r.body, { ok: true, pid: 7 });
});

test('checks spoilt by the app stalling neither count nor start anything', async () => {
  assert.deepEqual(await decideRunner(seq('unsure'), { sleep: noSleep }), { state: 'unsure', probes: 12, unsure: 12 });
  assert.equal((await decideRunner(seq('down', 'unsure', 'unsure', 'up'), { sleep: noSleep })).state, 'up');
  assert.deepEqual(await decideRunner(seq('down', 'unsure', 'down', 'unsure', 'down'), { sleep: noSleep }), { state: 'down', probes: 5, unsure: 2 });
});

test('a real runner answering while the app blocks its own loop past the timeout is not a miss', async () => {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true,"pid":1}'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/health`;
  try {
    assert.equal((await probeOnce(url, { timeoutMs: 300, slackMs: 300 })).verdict, 'up');
    const p = probeOnce(url, { timeoutMs: 300, slackMs: 300 });
    const until = Date.now() + 1500; while (Date.now() < until); // the app stalls, as on battery
    const r = await p;
    assert.equal(r.verdict, 'unsure', `took ${r.elapsedMs} ms`);
  } finally { srv.close(); }
});

test('nothing listening on the port is a quick real miss', async () => {
  const [port] = await freePorts(1);
  const r = await probeOnce(`http://127.0.0.1:${port}/health`);
  assert.equal(r.verdict, 'down');
  assert.ok(r.elapsedMs < PROBE_TIMEOUT_MS);
});
