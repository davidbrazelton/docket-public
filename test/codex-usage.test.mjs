// The Codex usage reader: a made-up Codex home with a main session, its approval
// reviewer sub-agent, a compaction, and an old-style file with only token_count lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { codexSessions, codexRows, codexAccount, readCodexSession } from '../codex-usage.mjs';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const PRICING = path.join(ROOT, 'pricing.json');
const u = (input, cached, output, reasoning = 0) => ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output });
const line = (timestamp, type, payload) => JSON.stringify({ timestamp, type, payload });

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
  const day = path.join(dir, 'sessions', '2026', '10', '20');
  fs.mkdirSync(day, { recursive: true });
  const main = [
    line('2026-10-20T15:00:00Z', 'session_meta', { session_id: 'S1', id: 'S1', cwd: 'C:\\Acme\\billing', source: 'vscode' }),
    line('2026-10-20T15:00:01Z', 'turn_context', { turn_id: 'T1', model: 'gpt-6-sol' }),
    line('2026-10-20T15:00:02Z', 'response_item', { type: 'custom_tool_call', call_id: 'c1' }),
    line('2026-10-20T15:00:03Z', 'token_usage_record', { response_id: 'r1', turn_id: 'T1', usage: u(100000, 80000, 1000, 200) }),
    line('2026-10-20T15:00:03Z', 'event_msg', { type: 'token_count', info: { last_token_usage: u(100000, 80000, 1000, 200), total_token_usage: u(100000, 80000, 1000, 200) } }),
    line('2026-10-20T15:01:00Z', 'token_usage_record', { response_id: 'r2', turn_id: 'T1', usage: u(300000, 200000, 5000) }), // the compaction call
    line('2026-10-20T15:01:01Z', 'compacted', { compaction_response_id: 'r2' }),
    line('2026-10-20T15:01:02Z', 'event_msg', { type: 'token_count', info: { last_token_usage: u(0, 0, 0), total_token_usage: u(100000, 80000, 1000, 200) } }),
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(day, 'rollout-2026-10-20T10-00-00-S1.jsonl.zst'), zlib.zstdCompressSync(Buffer.from(main)));
  const reviewer = [
    line('2026-10-20T15:02:00Z', 'session_meta', { session_id: 'S1', id: 'S1-guard', parent_thread_id: 'S1', cwd: 'C:\\Acme\\billing', source: { subagent: { other: 'guardian' } } }),
    line('2026-10-20T15:02:00Z', 'response_item', { type: 'compaction' }),
    line('2026-10-20T15:02:01Z', 'turn_context', { turn_id: 'G1', model: 'codex-auto-review' }),
    line('2026-10-20T15:02:02Z', 'token_usage_record', { response_id: 'g1', turn_id: 'G1', usage: u(20000, 10000, 100) }),
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(day, 'rollout-2026-10-20T10-02-00-S1-guard.jsonl'), reviewer);
  const old = [
    line('2026-10-20T16:00:00Z', 'session_meta', { id: 'S2', cwd: 'C:\\Elsewhere' }),
    line('2026-10-20T16:00:01Z', 'turn_context', { model: 'gpt-5.4' }),
    line('2026-10-20T16:00:02Z', 'event_msg', { type: 'token_count', info: null }),
    line('2026-10-20T16:00:03Z', 'event_msg', { type: 'token_count', info: { last_token_usage: u(10000, 0, 500), total_token_usage: u(10000, 0, 500) } }),
    line('2026-10-20T16:00:03Z', 'event_msg', { type: 'token_count', info: { last_token_usage: u(10000, 0, 500), total_token_usage: u(10000, 0, 500) } }),
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(day, 'rollout-2026-10-20T11-00-00-S2.jsonl.zst'), zlib.zstdCompressSync(Buffer.from(old)));
  fs.writeFileSync(path.join(dir, 'session_index.jsonl'), JSON.stringify({ id: 'S1', thread_name: 'Fix the price sheet' }) + '\n');
  const claims = Buffer.from(JSON.stringify({ email: 'pat@example.com' })).toString('base64url');
  fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: `x.${claims}.y` } }));
  return dir;
}

test('groups a session with its sub-agents, by session id, with the title and account', () => {
  const dir = home();
  const s = codexSessions(dir);
  assert.deepEqual([...s.keys()].sort(), ['S1', 'S2']);
  assert.equal(s.get('S1').files.length, 2);
  assert.match(s.get('S1').files[0], /S1\.jsonl\.zst$/); // its own file first, then the reviewer
  assert.equal(s.get('S1').title, 'Fix the price sheet');
  assert.equal(s.get('S1').cwd, 'C:\\Acme\\billing');
  assert.equal(codexAccount(dir), 'chatgpt:pat@example.com');
});

test('counts each call once, splits cached input out, and marks the compaction call', () => {
  const s = codexSessions(home()).get('S1');
  const { replies, compactions } = readCodexSession(s.files);
  assert.equal(replies.length, 3);
  assert.deepEqual(replies[0].usage, { input_tokens: 20000, output_tokens: 1000, cache_read_input_tokens: 80000, cache_creation_input_tokens: 0, reasoning_output_tokens: 200 });
  assert.equal(replies[0].tools.size, 1);
  assert.equal(replies[1].compaction, true);
  assert.equal(replies[2].subagent, true);
  assert.equal(replies[2].model, 'codex-auto-review');
  assert.equal(compactions.length, 1);
});

test('rows carry Brand codex and OpenAI prices, long context over 272K', () => {
  const s = codexSessions(home()).get('S1');
  const rows = codexRows('acme', s, PRICING, '', 'chatgpt:pat@example.com');
  assert.ok(rows.every((r) => r.Brand === 'codex' && r.BilledProfile === 'chatgpt:pat@example.com'));
  const by = Object.fromEntries(rows.map((r) => [r.Source, r]));
  // gpt-6-sol: 20,000 in at $2, 80,000 cached at $0.20, 1,000 out at $10
  assert.equal(by.main.Cost, 0.066);
  // the compaction call reads 300K, so long-context rates: 100,000 in at $4, 200,000 cached at $0.40, 5,000 out at $15
  assert.equal(by.compact.Cost, 0.555);
  assert.equal(by.compact.HypotheticalCost, by.compact.Cost); // no Opus comparison for another brand
  assert.equal(by.agent.Model, 'codex-auto-review');
  assert.equal(rows.reduce((a, r) => a + r.Compacting, 0), 1);
});

test('an old file with only token_count lines counts each call once', () => {
  const s = codexSessions(home()).get('S2');
  const rows = codexRows('acme', s, PRICING, '', 'x');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Turns, 1);
  assert.equal(rows[0].Model, 'gpt-5.4');
  assert.equal(rows[0].Cost, 0.0325); // 10,000 in at $2.50, 500 out at $15
});
