// Open in Google Sheets (#1017): a session's spreadsheet goes to the desk's Google Drive as a new Google Sheet, which
// then opens in the browser; the file on this computer is not changed. Google's own sign-in (OAuth for a desktop app,
// with PKCE) and the Drive API, with the drive.file scope only: Docket sees the files it made and nothing else in Drive.
// The sign-in app is the computer's (a Google Cloud "Desktop app" client, google-client.json in Docket's data folder);
// the sign-in is each desk's (google/<desk id>.json there), so desks can use different Google accounts.
// Everything that talks to Google takes `fetch`, so the tests can stand in for Google.
import crypto from 'node:crypto';
import path from 'node:path';

export const SHEET_FILE = /\.(xlsx|xls|xlsm|csv)$/i;
// Google converts files up to 100 MB to Sheets; a bigger one is refused before anything is sent.
export const MAX_BYTES = 100 * 1024 * 1024;
export const SCOPES = ['https://www.googleapis.com/auth/drive.file', 'openid', 'email'];
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink';
export const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
};
export const sourceMime = (file) => MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
// The Sheet's name in Drive: the file's name without its extension.
export const sheetName = (file) => path.basename(file).replace(/\.[^.]+$/, '') || 'Spreadsheet';

// The client file Google Cloud gives as "Download JSON" for an OAuth client. Only a Desktop app client works: a Web
// application client accepts only the exact addresses typed into it, and Docket's port can differ per computer.
export function readClientFile(text) {
  let j; try { j = typeof text === 'string' ? JSON.parse(text) : text; } catch { return { error: 'That is not a JSON file. Use Download JSON on the OAuth client in Google Cloud.' }; }
  if (j?.web) return { error: 'That client is a Web application. Make one of type Desktop app instead, and choose its JSON file.' };
  const c = j?.installed || j;
  if (typeof c?.client_id !== 'string' || !/\.apps\.googleusercontent\.com$/.test(c.client_id) || typeof c.client_secret !== 'string' || !c.client_secret)
    return { error: 'That file has no OAuth client in it. Use Download JSON on a Desktop app OAuth client in Google Cloud.' };
  return { clientId: c.client_id, clientSecret: c.client_secret };
}

export function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

// The Google sign-in page. login_hint picks the account the desk used before; prompt=consent makes Google give a
// refresh token every time, so a desk signed in again keeps working after the first hour.
export function authUrl({ clientId, redirectUri, state, challenge, email }) {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
    state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', ...(email ? { login_hint: email } : {}) });
  return `${AUTH}?${q}`;
}

// The email in an ID token's middle part. It came straight from Google over HTTPS, so it is read, not checked.
export function emailFromIdToken(idToken) {
  try { return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')).email || ''; } catch { return ''; }
}

// A failed Google answer as one plain sentence. kind: 'sign-in' (the token endpoint) or 'upload' (Drive).
export function googleError(status, body, kind = 'upload') {
  let j = body; if (typeof body === 'string') { try { j = JSON.parse(body); } catch { j = null; } }
  const reason = j?.error?.errors?.[0]?.reason || j?.error?.status || (typeof j?.error === 'string' ? j.error : '') || '';
  const said = j?.error?.message || j?.error_description || '';
  if (kind === 'sign-in') {
    if (reason === 'invalid_grant') return { signin: true, message: 'The Google sign-in for this desk has run out or was taken back. Sign in to Google again.' };
    if (reason === 'invalid_client' || reason === 'unauthorized_client') return { setup: true, message: 'Google does not accept Docket\'s Google sign-in app on this computer. Set it up again with a Desktop app client.' };
    return { message: `Google refused the sign-in${said ? `: ${said}` : ` (${status})`}.` };
  }
  if (status === 401) return { signin: true, message: 'Google no longer accepts this desk\'s sign-in. Sign in to Google again.' };
  if (reason === 'storageQuotaExceeded') return { message: 'Your Google Drive is full, so Google refused the file. Free up space in Drive and try again.' };
  if (status === 413 || reason === 'uploadTooLarge') return { message: 'Google refused the file as too large to turn into a Google Sheet.' };
  if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') return { setup: true, message: 'The Google Drive API is not turned on in the Google Cloud project of Docket\'s sign-in app. Turn on Google Drive API there and try again.' };
  if (status === 403 && /domain|policy|admin/i.test(said)) return { message: `Your Google Workspace does not allow this upload: ${said}` };
  if (status === 400 && /convert/i.test(said + reason)) return { message: 'Google could not turn this file into a Google Sheet. It may be damaged, password protected, or too big for Sheets (10 million cells).' };
  return { message: `Google refused the upload${said ? `: ${said}` : ` (${status})`}.` };
}

const fail = (g) => Object.assign(new Error(g.message), g.signin ? { signin: true } : {}, g.setup ? { setup: true } : {});
async function readJson(r) { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }

// Code -> tokens, at the end of the sign-in. Answers { refreshToken, accessToken, expires, email }.
export async function exchangeCode({ clientId, clientSecret, code, verifier, redirectUri, fetch = globalThis.fetch, now = Date.now() }) {
  const r = await fetch(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
  const j = await readJson(r);
  if (!r.ok) throw fail(googleError(r.status, j, 'sign-in'));
  if (!j.refresh_token) throw new Error('Google gave no lasting sign-in. Sign in to Google again.');
  return { refreshToken: j.refresh_token, accessToken: j.access_token, expires: now + (j.expires_in || 3600) * 1000, email: emailFromIdToken(j.id_token) };
}

// A fresh access token from the desk's refresh token. Answers { accessToken, expires }.
export async function refreshAccess({ clientId, clientSecret, refreshToken, fetch = globalThis.fetch, now = Date.now() }) {
  const r = await fetch(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }) });
  const j = await readJson(r);
  if (!r.ok) throw fail(googleError(r.status, j, 'sign-in'));
  return { accessToken: j.access_token, expires: now + (j.expires_in || 3600) * 1000 };
}

// Takes the desk's sign-in back at Google too, so Disconnect leaves nothing usable behind. Best effort.
export const revoke = ({ token, fetch = globalThis.fetch }) =>
  fetch(REVOKE, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) }).catch(() => {});

// Uploads the file's bytes as a new Google Sheet: a resumable upload (one request names it and asks Google to
// convert it, a second sends the bytes), which takes files of any size Sheets can hold. Answers { id, url }.
export async function uploadAsSheet({ accessToken, name, mime, data, fetch = globalThis.fetch }) {
  const start = await fetch(UPLOAD, { method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': mime, 'x-upload-content-length': String(data.length) },
    body: JSON.stringify({ name, mimeType: SHEET_MIME }) });
  if (!start.ok) throw fail(googleError(start.status, await readJson(start)));
  const at = start.headers.get('location');
  if (!at) throw new Error('Google did not start the upload. Try again.');
  const put = await fetch(at, { method: 'PUT', headers: { 'content-type': mime }, body: data });
  const j = await readJson(put);
  if (!put.ok) throw fail(googleError(put.status, j));
  if (!j?.id) throw new Error('Google took the file but did not say where the Sheet is. Look for it in Google Drive.');
  return { id: j.id, url: j.webViewLink || `https://docs.google.com/spreadsheets/d/${j.id}/edit` };
}

// The Sheet's address for the desk's account, so a browser signed in to several Google accounts opens it in the right one.
export const sheetUrl = (url, email) => email ? `${url}${url.includes('?') ? '&' : '?'}authuser=${encodeURIComponent(email)}` : url;
