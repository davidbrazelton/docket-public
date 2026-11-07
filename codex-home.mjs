// Codex: where the codex program is, and how Docket reads what it says about a company's sign-in. A company's
// Codex home folder (CODEX_HOME, "codexHome" in its entry) holds its sign-in (auth.json), settings and sessions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The codex program. It comes with the Codex desktop app, not on the PATH, in a folder named by a hash that changes
// when the app updates (%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe, checked 2026-10-27), so it is looked up
// each time, the newest copy first. PORTAL_CODEX_EXE names another (the tests' stand-in); else `codex` on the PATH.
export function findCodexExe(env = process.env) {
  if (env.PORTAL_CODEX_EXE) return env.PORTAL_CODEX_EXE;
  const name = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const roots = [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin'), path.join(os.homedir(), '.codex', 'bin')].filter(Boolean);
  const found = [];
  for (const root of roots) {
    let dirs = []; try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const d of dirs) {
      const f = d.isDirectory() ? path.join(root, d.name, name) : d.name === name ? path.join(root, name) : null;
      try { if (f) found.push({ f, t: fs.statSync(f).mtimeMs }); } catch {}
    }
  }
  return found.sort((a, b) => b.t - a.t)[0]?.f || 'codex';
}
// A stand-in written in JavaScript (the tests' fixtures/fake-codex.mjs) is run with node.
export const codexCommand = (exe, args) => /\.m?js$/i.test(exe) ? [process.execPath, [exe, ...args]] : [exe, args];

// A new Codex home is just a folder: Codex fills it in when it signs in. An existing one is left alone.
export function makeCodexHome(home) {
  fs.mkdirSync(home, { recursive: true });
}

const plain = (out) => String(out).replace(/\x1b\[[0-9;]*m/g, '');
// `codex login status` says "Logged in using ChatGPT" (or "using an API key") and exits 0, or "Not logged in" and exits
// 1. It writes that on its error output (Codex 0.163), so the exit code decides; the words only ever say no.
export const codexSignedIn = (code, out = '') => code === 0 && !/not logged in/i.test(plain(out));

// Who a Codex home is signed in as, from its auth.json: { email, plan } (null where it doesn't say). A ChatGPT sign-in
// keeps an id token whose claims carry the email and the ChatGPT plan ("plus", "team"...; checked 2026-11-07);
// an API key sign-in has no account. The token is only read, never checked: `codex login status` says whether it works.
export function codexAccount(home) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8'));
    if (!j.tokens?.id_token) return { email: j.OPENAI_API_KEY ? 'an OpenAI API key' : null, plan: null };
    const claims = JSON.parse(Buffer.from(j.tokens.id_token.split('.')[1], 'base64url').toString('utf8'));
    const plan = claims['https://api.openai.com/auth']?.chatgpt_plan_type;
    return { email: claims.email || null, plan: plan ? `ChatGPT ${plan[0].toUpperCase()}${plan.slice(1)}` : null };
  } catch { return { email: null, plan: null }; }
}

// `codex login --device-auth` prints a link (https://auth.openai.com/codex/device) and, separately, a one-time code
// such as LO11-IXSZG, then waits until the code is entered on that page. The link does not carry the code.
export function codexDeviceLink(out) {
  const text = plain(out);
  const url = text.match(/https:\/\/\S+\/device\b\S*/)?.[0];
  const code = text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/)?.[0];
  return url && code ? { url, code } : null;
}
