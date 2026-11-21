// Open in Google Sheets (#1017): the sign-in app's file, Google's sign-in address, the token swaps, the upload that turns a
// file into a Sheet, and what each refusal says. Google is stood in for by a fake fetch. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SHEET_FILE, SHEET_MIME, readClientFile, pkce, authUrl, emailFromIdToken, googleError, exchangeCode, refreshAccess, uploadAsSheet, sourceMime, sheetName, sheetUrl } from '../google-sheets.mjs';
import { urlOpenCommand } from '../platform.mjs';
import crypto from 'node:crypto';

const ID = '123-abc.apps.googleusercontent.com';
const reply = (status, body, headers = {}) => ({ ok: status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => typeof body === 'string' ? body : JSON.stringify(body) });
function fakeFetch(answers) {
  const calls = [];
  const f = async (url, opts = {}) => { calls.push({ url, ...opts }); return answers.shift()(url, opts); };
  return Object.assign(f, { calls });
}

test('the spreadsheets it offers: Excel workbooks and CSV, not other files', () => {
  for (const f of ['a.xlsx', 'B.XLSX', 'c.xls', 'd.xlsm', 'e.csv']) assert.ok(SHEET_FILE.test(f), f);
  for (const f of ['a.tsv', 'a.docx', 'xlsx', 'a.xlsx.txt']) assert.ok(!SHEET_FILE.test(f), f);
  assert.equal(sourceMime('C:\\x\\Budget.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(sourceMime('/x/data.CSV'), 'text/csv');
  assert.equal(sheetName('C:\\x\\Q3 budget.v2.xlsx'), 'Q3 budget.v2');
});

test('the sign-in app file: a Desktop app client is taken, anything else says what to choose', () => {
  assert.deepEqual(readClientFile(JSON.stringify({ installed: { client_id: ID, client_secret: 'shh' } })), { clientId: ID, clientSecret: 'shh' });
  assert.deepEqual(readClientFile({ client_id: ID, client_secret: 'shh' }), { clientId: ID, clientSecret: 'shh' }, 'as Docket saves it back');
  assert.match(readClientFile(JSON.stringify({ web: { client_id: ID, client_secret: 'x' } })).error, /Desktop app/);
  assert.match(readClientFile('not json').error, /not a JSON file/);
  assert.match(readClientFile('{"installed":{"client_id":"x"}}').error, /no OAuth client/);
});

test('the Google sign-in address asks for Drive files Docket makes only, with PKCE and a lasting sign-in', () => {
  const { verifier, challenge } = pkce();
  assert.equal(challenge, crypto.createHash('sha256').update(verifier).digest('base64url'));
  const u = new URL(authUrl({ clientId: ID, redirectUri: 'http://127.0.0.1:4400/google/callback', state: 's1', challenge, email: 'pat@example.com' }));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const q = Object.fromEntries(u.searchParams);
  assert.equal(q.scope, 'https://www.googleapis.com/auth/drive.file openid email');
  assert.equal(q.code_challenge_method, 'S256');
  assert.equal(q.access_type, 'offline');
  assert.equal(q.redirect_uri, 'http://127.0.0.1:4400/google/callback');
  assert.equal(q.state, 's1');
  assert.equal(q.login_hint, 'pat@example.com');
  assert.ok(!new URL(authUrl({ clientId: ID, redirectUri: 'x', state: 's', challenge })).searchParams.has('login_hint'));
});

test('signing in swaps the code for a lasting sign-in and reads who it is', async () => {
  const idToken = ['h', Buffer.from(JSON.stringify({ email: 'pat@example.com' })).toString('base64url'), 's'].join('.');
  assert.equal(emailFromIdToken(idToken), 'pat@example.com');
  assert.equal(emailFromIdToken('junk'), '');
  const fetch = fakeFetch([() => reply(200, { access_token: 'at', refresh_token: 'rt', expires_in: 3599, id_token: idToken })]);
  const t = await exchangeCode({ clientId: ID, clientSecret: 'shh', code: 'c', verifier: 'v', redirectUri: 'r', fetch, now: 1000 });
  assert.deepEqual(t, { refreshToken: 'rt', accessToken: 'at', expires: 1000 + 3599000, email: 'pat@example.com' });
  const sent = Object.fromEntries(fetch.calls[0].body);
  assert.deepEqual([sent.grant_type, sent.code, sent.code_verifier], ['authorization_code', 'c', 'v']);
  // No refresh token (Google gives none when it thinks it already did): an error, not a sign-in that dies in an hour.
  await assert.rejects(exchangeCode({ clientId: ID, clientSecret: 's', code: 'c', verifier: 'v', redirectUri: 'r', fetch: fakeFetch([() => reply(200, { access_token: 'at' })]) }), /no lasting sign-in/);
});

test('a sign-in taken back at Google says to sign in again, and is marked so Docket forgets it', async () => {
  const fetch = fakeFetch([() => reply(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })]);
  const e = await refreshAccess({ clientId: ID, clientSecret: 's', refreshToken: 'rt', fetch }).catch((x) => x);
  assert.equal(e.signin, true);
  assert.match(e.message, /Sign in to Google again/);
  const bad = await refreshAccess({ clientId: ID, clientSecret: 's', refreshToken: 'rt', fetch: fakeFetch([() => reply(401, { error: 'invalid_client' })]) }).catch((x) => x);
  assert.equal(bad.setup, true, 'a deleted sign-in app sends the person back to set it up');
  const ok = await refreshAccess({ clientId: ID, clientSecret: 's', refreshToken: 'rt', now: 0, fetch: fakeFetch([() => reply(200, { access_token: 'new', expires_in: 60 })]) });
  assert.deepEqual(ok, { accessToken: 'new', expires: 60000 });
});

test('the upload asks Google to make a Sheet, sends the bytes, and answers the Sheet', async () => {
  const data = Buffer.from('a,b\n1,2\n');
  const fetch = fakeFetch([
    () => reply(200, '', { location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=u1' }),
    () => reply(200, { id: 'sheet1', webViewLink: 'https://docs.google.com/spreadsheets/d/sheet1/edit?usp=drivesdk' }),
  ]);
  const r = await uploadAsSheet({ accessToken: 'at', name: 'data', mime: 'text/csv', data, fetch });
  assert.deepEqual(r, { id: 'sheet1', url: 'https://docs.google.com/spreadsheets/d/sheet1/edit?usp=drivesdk' });
  const [start, put] = fetch.calls;
  assert.match(start.url, /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?uploadType=resumable/);
  assert.equal(start.headers.authorization, 'Bearer at');
  assert.deepEqual(JSON.parse(start.body), { name: 'data', mimeType: SHEET_MIME });
  assert.equal(start.headers['x-upload-content-type'], 'text/csv');
  assert.equal(start.headers['x-upload-content-length'], String(data.length));
  assert.equal(put.method, 'PUT');
  assert.equal(put.body, data);
  // No link in the answer: the Sheet's own address
  const bare = await uploadAsSheet({ accessToken: 'at', name: 'x', mime: 'text/csv', data, fetch: fakeFetch([() => reply(200, '', { location: 'L' }), () => reply(200, { id: 'z9' })]) });
  assert.equal(bare.url, 'https://docs.google.com/spreadsheets/d/z9/edit');
  assert.equal(sheetUrl(r.url, 'pat@example.com'), 'https://docs.google.com/spreadsheets/d/sheet1/edit?usp=drivesdk&authuser=pat%40example.com');
  assert.equal(sheetUrl('https://x/edit', ''), 'https://x/edit');
});

test('each refusal from Drive says what happened in plain words', async () => {
  const upload = (status, body) => uploadAsSheet({ accessToken: 'at', name: 'x', mime: 'text/csv', data: Buffer.from('a'), fetch: fakeFetch([() => reply(status, body)]) }).catch((e) => e);
  const expired = await upload(401, { error: { code: 401, message: 'Invalid Credentials' } });
  assert.equal(expired.signin, true);
  assert.match((await upload(403, { error: { errors: [{ reason: 'storageQuotaExceeded' }], message: 'The user\'s Drive storage quota has been exceeded.' } })).message, /Drive is full/);
  assert.match((await upload(413, 'Request Entity Too Large')).message, /too large/);
  const off = await upload(403, { error: { errors: [{ reason: 'accessNotConfigured' }], message: 'Google Drive API has not been used in project 1' } });
  assert.equal(off.setup, true);
  assert.match(off.message, /Turn on Google Drive API/);
  assert.match((await upload(500, { error: { message: 'Backend Error' } })).message, /Google refused the upload: Backend Error/);
  assert.match(googleError(400, { error: { message: 'Unable to convert the file' } }).message, /could not turn this file into a Google Sheet/);
  assert.match(googleError(403, { error: { message: 'The domain administrator has disabled Drive apps.' } }).message, /Workspace does not allow/);
});

test('a web address opens in the default browser on each platform, & and all', () => {
  const u = 'https://docs.google.com/spreadsheets/d/x/edit?usp=drivesdk&authuser=a%40b.com';
  assert.deepEqual(urlOpenCommand(u, 'win32'), { cmd: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', u], opts: {} });
  assert.deepEqual(urlOpenCommand(u, 'darwin'), { cmd: 'open', args: [u], opts: {} });
  assert.deepEqual(urlOpenCommand(u, 'linux'), { cmd: 'xdg-open', args: [u], opts: {} });
});

test('the page offers Open in Google Sheets on spreadsheets only, and not on a desk that turned it off or a remote desk', () => {
  const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const s = page.indexOf('const SHEET_FILE'), e = page.indexOf('\n', page.indexOf('const sheetsOn', s));
  const S = { client: 'a', clients: [{ id: 'a' }, { id: 'b', googleSheets: 'off' }, { id: 'r', remote: true }] };
  const sheetsOn = new Function('S', page.slice(s, e) + '\nreturn sheetsOn;')(S);
  assert.ok(sheetsOn('C:\\x\\Budget.xlsx'));
  assert.ok(!sheetsOn('C:\\x\\notes.md'));
  S.client = 'b'; assert.ok(!sheetsOn('C:\\x\\Budget.xlsx'), 'turned off for the desk');
  S.client = 'r'; assert.ok(!sheetsOn('C:\\x\\Budget.xlsx'), 'a remote desk');
  assert.match(page, /<button id="pvSheets" data-tip="pv-sheets" hidden>Open in Google Sheets<\/button>/);
  assert.match(page, /item\('sheets', 'sheets', 'Open in Google Sheets'/);
});
