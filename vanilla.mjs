// The Vanilla desk (#1210): one clean desk whose sessions run as the bare program, as if typed in a terminal, to tell
// whether Docket's setup is what makes something misbehave. Its sessions get none of Docket's instructions or tools,
// no profile, memory, hooks, plugins, skills, MCP servers or claude.ai connectors, and none of the folder's own
// config (CLAUDE.md, .claude settings, AGENTS.md). Each brand signs in with a copy of another desk's sign-in, kept
// in step both ways (syncSignIn), so its use is billed to that desk's account. Kept apart from server.mjs so the
// tests can try it on made-up homes.
import fs from 'node:fs';
import path from 'node:path';

export const VANILLA_ID = 'vanilla';
export const VANILLA_NAME = 'Vanilla';
export const BRANDS = ['claude', 'grok', 'codex'];
export const isVanilla = (client) => !!client?.vanilla;

// Its home folders, under the root new desks' homes go in (home-roots.mjs), never inside Docket's own folder.
export function vanillaHomes(root) {
  const dir = path.join(root, 'Vanilla-desk');
  return { home: path.join(dir, 'claude-home'), grokHome: path.join(dir, 'grok-home'), codexHome: path.join(dir, 'codex-home') };
}
const HOME_KEY = { claude: 'home', grok: 'grokHome', codex: 'codexHome' };

// Grok also reads Claude's and Cursor's rules, skills, agents, MCP servers and hooks from the user's own folders
// (~/.claude, ~/.claude.json, ~/.cursor) unless told not to; this keeps every one of them out (keys checked with
// `grok inspect`, Grok 1.0.70, 2026-11-23). A project's AGENTS.md is read only in a trusted project, and a clean home
// trusts none. Its memory is off too: an explicit false wins over the account's remote settings, which turn it on.
export const GROK_CONFIG = `# Made by Docket for the Vanilla desk: Grok on its own, without Claude's or Cursor's setup or a memory.
${['claude', 'cursor'].map((h) => `[compat.${h}]\n${['skills', 'rules', 'agents', 'mcps', 'hooks', 'sessions'].map((k) => `${k} = false`).join('\n')}\n`).join('\n')}
[memory]
enabled = false

[memory_v2]
enabled = false
`;

// Makes the empty homes, and gives Grok's its config.toml, which is Docket's and written again whenever it differs.
// Returns the folders it made, for the desk's madeFolders.
export function makeVanillaHomes(homes) {
  const made = [];
  for (const dir of Object.values(homes)) if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); made.push(dir); }
  const cfg = path.join(homes.grokHome, 'config.toml');
  let now = null; try { now = fs.readFileSync(cfg, 'utf8'); } catch {}
  if (now !== GROK_CONFIG) fs.writeFileSync(cfg, GROK_CONFIG);
  return made;
}

// The desks a brand's sign-in can be borrowed from: this computer's own desks that use the brand on their own sign-in
// (not the Vanilla desk, not a remote desk, not one whose Claude goes through a LiteLLM gateway).
// uses(client, brand): whether the desk has the brand ticked (brandsOf in server.mjs).
export function lenders(clients, brand, uses) {
  return clients.filter((c) => !isVanilla(c) && !c.remote && uses(c, brand) && !(brand === 'claude' && c.gateway));
}
// The lender per brand as saved: a desk that can still lend it, else the first one that can, else none (the brand is
// then off on the Vanilla desk). asked: { brand: desk id or '' }; '' turns the brand off, and stays ''.
export function cleanBorrow(asked = {}, clients, uses) {
  const out = {};
  for (const brand of BRANDS) {
    const can = lenders(clients, brand, uses);
    if (asked[brand] === '') { out[brand] = ''; continue; } // turned off: kept, so it is not picked again
    const pick = can.find((c) => c.id === asked[brand]) || (asked[brand] === undefined ? can[0] : null);
    if (pick) out[brand] = pick.id;
  }
  return out;
}

// The desk list entry. folder: where new sessions start unless another is picked.
export function vanillaEntry({ homes, folder, borrow, made = [] }) {
  return {
    id: VANILLA_ID, name: VANILLA_NAME, ...homes, folder, vanilla: true, borrow,
    brandsOff: BRANDS.filter((b) => !borrow[b]),
    // Only the user layer, which is its own clean home: the folder's .claude settings and CLAUDE.md stay out.
    settingSources: ['user'],
    // Docket never asks its sessions to save their state before compacting.
    saveBeforeCompact: 0,
    ...(made.length ? { madeFolders: made } : {}),
  };
}

// ---------- the borrowed sign-in ----------
// The sign-in file in each brand's home. Claude's is the file on Windows and Linux; on a Mac it is in the keychain
// (platform.mjs claudeSignInStore), handled by the store the caller passes.
export const SIGNIN_FILE = { claude: '.credentials.json', grok: 'auth.json', codex: 'auth.json' };
export const signInFile = (client, brand) => path.join(client[HOME_KEY[brand]], SIGNIN_FILE[brand]);

// How new a sign-in is, to tell which copy was refreshed last: Claude's and Grok's token expiry, Codex's last refresh,
// else (text that says none of these) the time the file was written. A refresh token is replaced each time it is used, so the
// older copy no longer works once the newer one has refreshed.
export function stampOf(brand, text, mtime = 0) {
  try {
    const j = JSON.parse(text);
    if (brand === 'claude' && Number.isFinite(j?.claudeAiOauth?.expiresAt)) return j.claudeAiOauth.expiresAt;
    if (brand === 'codex' && j?.last_refresh && Number.isFinite(Date.parse(j.last_refresh))) return Date.parse(j.last_refresh);
    // Grok keeps one entry per sign-in, each with its expiry.
    const grok = brand === 'grok' && j && typeof j === 'object' ? Object.values(j).map((x) => Date.parse(x?.expires_at)).filter(Number.isFinite) : [];
    if (grok.length) return Math.max(...grok);
  } catch {}
  return mtime || 0;
}

// A sign-in kept in a file: { read: () => { text, mtime } or null, write(text) }.
export function fileStore(file) {
  return {
    read() { try { return { text: fs.readFileSync(file, 'utf8'), mtime: fs.statSync(file).mtimeMs }; } catch { return null; } },
    write(text) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, text, { mode: 0o600 });
      fs.renameSync(tmp, file);
    },
  };
}

// Brings the two copies of one sign-in into step: whichever was refreshed last is written over the other, so the
// lending desk keeps working after a Vanilla session refreshed the token, and the other way round.
// Returns 'to-vanilla', 'to-desk', 'same', or 'none' (the lending desk is not signed in).
export function syncSignIn(brand, desk, vanilla) {
  const a = desk.read(), b = vanilla.read();
  if (!a?.text) return 'none';
  if (b?.text === a.text) return 'same';
  if (b?.text && stampOf(brand, b.text, b.mtime) > stampOf(brand, a.text, a.mtime)) { desk.write(b.text); return 'to-desk'; }
  vanilla.write(a.text);
  return 'to-vanilla';
}

// Claude Code reads who it is signed in as from .claude.json (oauthAccount), and Docket reads it there to say who a
// desk is billed to: the Vanilla home's .claude.json gets the lending desk's account, and nothing else of that file.
export function withAccount(vanillaText, deskText) {
  let mine = {}, theirs = {};
  try { mine = JSON.parse(vanillaText) || {}; } catch {}
  try { theirs = JSON.parse(deskText) || {}; } catch {}
  const out = { ...mine };
  if (theirs.oauthAccount) out.oauthAccount = theirs.oauthAccount; else delete out.oauthAccount;
  if (theirs.userID) out.userID = theirs.userID;
  return JSON.stringify(out, null, 2);
}

// ---------- what a session sees ----------
// What Docket adds to a message a Vanilla session gets: nothing. Docket's own messages (reports, notes, wake-ups) are
// not sent to it at all, and the person's message goes as typed, with only its attachments.
export const bareMessage = ({ system, from }) => !system && !from;

// The variables a Vanilla Claude session runs with, on top of its home's: no claude.ai connectors and no automatic
// memory. (A lender on Amazon Bedrock lends its AWS profile, which the desk entry takes: lentConnection.)
export const CLAUDE_ENV = { ENABLE_CLAUDEAI_MCP_SERVERS: 'false', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
// What the desk entry takes from its Claude lender besides the sign-in: the AWS profile and region of one on Bedrock.
export const lentConnection = (lender) => lender?.awsProfile ? { awsProfile: lender.awsProfile, ...(lender.awsRegion ? { awsRegion: lender.awsRegion } : {}) } : {};
// Codex's settings for a Vanilla conversation: none of the folder's AGENTS.md (it reads up to project_doc_max_bytes),
// no ChatGPT apps (its connectors) and no plugins. Its memories are off by default (Codex 0.163, 2026-11-23).
export const CODEX_CONFIG = { project_doc_max_bytes: 0, features: { apps: false, plugins: false, remote_plugin: false } };
