// Tests for which file a session's Artifact call published, and to which page (artifacts.mjs, #608). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ARTIFACT_URL, artifactPublished } from '../artifacts.mjs';

const file = 'C:/Work/report/monthly.html';
const code = 'https://claude.ai/code/artifact/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const short = 'https://claude.ai/artifact/AbCdEfGhJk23MnPqRsTuVw';
// Results as the Artifact tool wrote them in real transcripts.
const ok = `Published C:\\Work\\report\\monthly.html at ${short} (Version 8, version id 1793668264-e233)\n\nLive subscription: arming in the background`;
const okCode = `Published C:\\Work\\monthly.html at ${code}\n\nLive subscription: arming in the background`;
const refused = "You hadn't viewed the live version of this artifact, so the publish was refused. Its full source (89.1KB) is saved at C:\\x\\artifact-0a1b2c3d-1790778533-bf50.html";

test('both link forms are artifact links', () => {
  assert.equal(code.match(ARTIFACT_URL)?.[0], code);
  assert.equal(short.match(ARTIFACT_URL)?.[0], short);
  assert.equal('https://claude.ai/chat/abc'.match(ARTIFACT_URL), null);
});

test('a publish to a page keeps the link the result names', () => {
  assert.deepEqual(artifactPublished({ action: 'publish', file_path: file, url: code }, ok, false), { path: file, url: short });
  assert.deepEqual(artifactPublished({ file_path: file, url: code }, okCode, false), { path: file, url: code }, 'action left out means publish');
});

test('a publish whose result names no link keeps the url it was sent to', () => {
  assert.deepEqual(artifactPublished({ file_path: file, url: code }, 'Published C:\\Work\\report\\monthly.html', false), { path: file, url: code });
  assert.equal(artifactPublished({ file_path: file }, 'Published C:\\Work\\report\\monthly.html', false), null);
});

test('a refused publish keeps nothing', () => {
  assert.equal(artifactPublished({ file_path: file, url: code }, refused, true), null);
  assert.equal(artifactPublished({ file_path: file, url: code }, refused, false), null, 'refused without the error mark');
  assert.equal(artifactPublished({ file_path: file, url: code }, ok, true), null, 'marked as an error');
  assert.equal(artifactPublished({ file_path: file, url: code }, undefined, false), null, 'still running');
});

test('reads, deletes, asset uploads and new pages from a type are not a file published', () => {
  assert.equal(artifactPublished({ action: 'read', url: code }, ok, false), null);
  assert.equal(artifactPublished({ action: 'delete', url: code }, ok, false), null);
  assert.equal(artifactPublished({ file_path: 'C:/x/logo.png', url: code, asset: true }, ok, false), null);
  assert.equal(artifactPublished({ file_path: 'C:/x/data.json', type_url: 'https://claude.ai/x' }, ok, false), null);
  assert.equal(artifactPublished(null, ok, false), null);
});

test('the server keeps a session publish as the file link and uses the rule for its Files list', () => {
  const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const apply = server.slice(server.indexOf('function applyToolResult'), server.indexOf('function handleSdkMessage'));
  assert.match(apply, /artifactPublished\(tev\.input, ev\.text, ev\.error\)/);
  assert.match(apply, /keepArtifactLink\(client, pub\.path, pub\.url\)/);
  const files = server.slice(server.indexOf('async function sessionFiles'), server.indexOf('// ---------- publishing a file as an artifact'));
  assert.match(files, /artifactPublished\(inp, e\.result, e\.status === 'error'\)/);
  assert.doesNotMatch(server, /const ARTIFACT_URL =/, 'one link pattern, from artifacts.mjs');
});
