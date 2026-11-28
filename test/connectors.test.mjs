// Tests for claude.ai connectors on and off per desk (#1189): connectors.mjs and the deny-list edit in switches.mjs.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serverKey, serverOf, hiddenOf, learnTools, connectorList, findConnector, findTool, switchDeny, changes, defaultDeny, hiddenRule } from '../connectors.mjs';
import { readDeny, setDeny, editDeny } from '../switches.mjs';
import { configFiles, readPrint, configChanges } from '../config-watch.mjs';

const S = (t) => `mcp__claude_ai_Slack__${t}`;

test('names: a connector\'s key, and the connector of a tool', () => {
  assert.equal(serverKey('claude.ai Google Drive'), 'Google_Drive');
  assert.equal(serverKey('Google Calendar'), 'Google_Calendar');
  assert.equal(serverOf(S('slack_send_message')), 'Slack');
  assert.equal(serverOf('mcp__claude_ai_Meetings'), 'Meetings');
  assert.equal(serverOf('mcp__portal__recall'), null);
});

test('a deny list hides whole connectors by prefix and single tools by name; other lines are not connectors', () => {
  const h = hiddenOf(['mcp__claude_ai_Google_Drive', 'mcp__claude_ai_Meetings__*', S('slack_send_message'), 'Bash(rm:*)', 'mcp__portal__x']);
  assert.deepEqual([...h.servers], ['Google_Drive', 'Meetings']);
  assert.deepEqual([...h.tools], [S('slack_send_message')]);
});

test('the list joins the catalog, the account\'s connectors and the deny lines', () => {
  const catalog = {};
  assert.deepEqual(learnTools(catalog, [S('slack_read_thread'), S('slack_send_message'), 'mcp__portal__x', 'Read']), [S('slack_read_thread'), S('slack_send_message')]);
  assert.deepEqual(learnTools(catalog, [S('slack_read_thread')]), []);
  const list = connectorList({ deny: ['mcp__claude_ai_Google_Drive', 'mcp__claude_ai_Gmail__send_message', S('slack_send_message')], catalog, connected: ['claude.ai Google Calendar'] });
  assert.deepEqual(list.map((c) => [c.key, c.on]), [['Gmail', true], ['Google_Calendar', true], ['Google_Drive', false], ['Slack', true]]);
  assert.deepEqual(list[0].tools.map((t) => [t.short, t.on]), [['send_message', false]]);
  assert.deepEqual(list[3].tools.map((t) => [t.short, t.on]), [['slack_read_thread', true], ['slack_send_message', false]]);
  const slack = findConnector(list, 'slack');
  assert.equal(findConnector(list, 'Google Calendar').key, 'Google_Calendar');
  assert.equal(findTool(slack, 'slack_send_message').name, S('slack_send_message'));
  assert.equal(findTool(slack, S('slack_read_thread')).short, 'slack_read_thread');
});

test('switches: a connector is its prefix line; one tool of a hidden connector brings it back with the others hidden', () => {
  const catalog = { Slack: [S('a_read'), S('b_send'), S('c_search')] };
  const at = (deny) => findConnector(connectorList({ deny, catalog }), 'Slack');
  let r = switchDeny(['x'], { conn: at(['x']), on: false });
  assert.deepEqual(r.deny, ['x', 'mcp__claude_ai_Slack']);
  assert.match(r.did, /Turned off Slack/);
  assert.equal(switchDeny(r.deny, { conn: at(r.deny), on: false }).did, '', 'already off: nothing to do');
  // tool lines under a hidden connector are kept for when it comes back
  r = switchDeny(['mcp__claude_ai_Slack', S('b_send')], { conn: at(['mcp__claude_ai_Slack', S('b_send')]), on: true });
  assert.deepEqual(r.deny, [S('b_send')]);
  assert.match(r.did, /1 of its tools stay hidden/);
  // one tool on while the connector is off
  const d = ['mcp__claude_ai_Slack__*'];
  r = switchDeny(d, { conn: at(d), tool: findTool(at(d), 'c_search'), on: true });
  assert.deepEqual(r.deny, [S('a_read'), S('b_send')]);
  // a tool off, and on again
  r = switchDeny([], { conn: at([]), tool: findTool(at([]), 'b_send'), on: false });
  assert.deepEqual(r.deny, [S('b_send')]);
  r = switchDeny(r.deny, { conn: at(r.deny), tool: findTool(at(r.deny), 'b_send'), on: true });
  assert.deepEqual(r.deny, []);
});

test('the new-desk default hides tools that send, change or delete, and any it is unsure of', () => {
  for (const n of ['slack_send_message', 'create_draft', 'update_label', 'trash_thread', 'untrash_message', 'forward', 'reply', 'label_message',
    'mark_thread_spam', 'slack_schedule_message', 'slack_complete_file_upload', 'slack_add_reaction', 'respond_to_event', 'share_file',
    'unlabel_thread', 'apply_sensitive_message_label', 'get_or_create_folder', 'something_odd', 'createEvent', 'certify_query', 'uncertify_query', 'create_draft']) assert.equal(changes(n), true, n);
  for (const n of ['slack_search_public', 'slack_read_channel', 'get_thread', 'list_labels', 'search_threads', 'slack_list_channel_members',
    'fetch_document', 'listEvents', 'slack_get_reactions', 'get_draft', 'list_drafts']) assert.equal(changes(n), false, n);
  const names = [S('slack_read_channel'), S('slack_send_message'), 'mcp__claude_ai_Gmail__send_message', 'mcp__claude_ai_Drive__create_file', 'mcp__portal__x'];
  assert.deepEqual(defaultDeny(['mcp__claude_ai_Drive', 'mcp__claude_ai_Gmail__send_message'], names), [S('slack_send_message')]);
});

test('the session-rules line names what is hidden, or is empty when nothing is', () => {
  assert.equal(hiddenRule(['Bash(rm:*)']), '');
  const line = hiddenRule(['mcp__claude_ai_Google_Drive', S('a_send'), S('b_send'), 'mcp__claude_ai_Gmail__send_message', 'mcp__claude_ai_Google_Drive__x']);
  assert.match(line, /Google Drive \(all of it\), 2 Slack tools, 1 Gmail tool\./);
  assert.match(line, /mcp__portal__connectors/);
});

test('the deny edit writes only the deny value and keeps every other line', () => {
  const text = '{\r\n  "model": "opus",\r\n  "permissions": {\r\n    "allow": ["Bash(ls)"],\r\n    "deny": [\r\n      "a",\r\n      "b"\r\n    ]\r\n  },\r\n  "zz": 1\r\n}\r\n';
  const out = setDeny(text, ['a', 'c']);
  assert.equal(out, '{\r\n  "model": "opus",\r\n  "permissions": {\r\n    "allow": ["Bash(ls)"],\r\n    "deny": [\r\n      "a",\r\n      "c"\r\n    ]\r\n  },\r\n  "zz": 1\r\n}\r\n');
  assert.deepEqual(readDeny(out), ['a', 'c']);
  assert.match(setDeny(text, []), /"deny": \[\]\r\n {2}\},/);
  // no deny yet, no permissions yet, an empty file
  assert.deepEqual(JSON.parse(setDeny('{\n  "permissions": {\n    "allow": []\n  }\n}\n', ['x'])), { permissions: { allow: [], deny: ['x'] } });
  const added = setDeny('{\n  "model": "opus"\n}\n', ['x']);
  assert.equal(added, '{\n  "model": "opus",\n  "permissions": {\n    "deny": [\n      "x"\n    ]\n  }\n}\n');
  assert.deepEqual(JSON.parse(setDeny('', ['x'])), { permissions: { deny: ['x'] } });
  assert.deepEqual(JSON.parse(setDeny('{}', ['x'])), { permissions: { deny: ['x'] } });
  assert.throws(() => setDeny('[1]', ['x']));
  assert.throws(() => setDeny('{"permissions": 3}', ['x']));
});

test('a deny change on disk is no reason to restart a session, and the file is never left half written', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-connectors-')), file = path.join(home, 'settings.json');
  fs.writeFileSync(file, '﻿{\n  "enabledPlugins": { "p@m": true },\n  "permissions": { "deny": [] }\n}\n');
  const files = configFiles({ home }), before = readPrint(files, new Map());
  const r = editDeny(file, (d) => [...d, 'mcp__claude_ai_Slack']);
  assert.deepEqual(r.after, ['mcp__claude_ai_Slack']);
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(text.charCodeAt(0), 0xFEFF, 'the byte order mark stays');
  assert.match(text, /"enabledPlugins": \{ "p@m": true \}/);
  assert.deepEqual(configChanges(before, readPrint(files, new Map())).reload, []);
  assert.deepEqual(fs.readdirSync(home), ['settings.json'], 'no temp file left');
  const m = fs.statSync(file).mtimeMs;
  editDeny(file, (d) => d); // nothing to change: not written
  assert.equal(fs.statSync(file).mtimeMs, m);
});

test('the profile page has a switch per connector, per tool under one with many, and says when the new-desk default was applied', async () => {
  const { buildProfile } = await import('../profile.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-connectors-')), folder = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-connectors-'));
  const catalog = { Slack: ['a_read', 'b_send', 'c_search', 'd_list'].map(S), Gmail: ['mcp__claude_ai_Gmail__get_thread'] };
  const deny = ['mcp__claude_ai_Gmail', S('b_send')];
  const pr = buildProfile({ id: 't', name: 'T', home, folder }, { isDefaultHome: false, connectors: connectorList({ deny, catalog }), connectorDefault: { at: Date.now(), hidden: 1 } });
  const g = pr.sections.find((s) => s.id === 'mcp').groups.find((x) => x.title === 'claude.ai connectors');
  assert.deepEqual(g.items.map((i) => [i.toggle.kind, i.toggle.key.replace(/^mcp__claude_ai_Slack__/, ''), i.toggle.on, !!i.toggle.disabled]),
    [['connector', 'Gmail', false, false], ['connector', 'Slack', true, false], ['connector-tool', 'a_read', true, false], ['connector-tool', 'b_send', false, false],
      ['connector-tool', 'c_search', true, false], ['connector-tool', 'd_list', true, false]]);
  assert.ok(g.items.every((i) => i.toggle.live));
  assert.match(g.note, /hid its 1 claude\.ai tools that send, change or delete/);
  assert.match(g.note, /Turn any back on with its switch here/);
  const plain = buildProfile({ id: 't', name: 'T', home, folder }, { isDefaultHome: false, connectors: [], connectorDefault: { existing: true } });
  assert.doesNotMatch(plain.sections.find((s) => s.id === 'mcp').groups.find((x) => x.title === 'claude.ai connectors').note, /When this desk was new/);
});
