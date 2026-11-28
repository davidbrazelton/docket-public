// A LiteLLM gateway as a company's connection: every brand listed in its gateway block reaches its models
// through one proxy, signed in with LiteLLM's own `lite` program instead of the brand's own sign-in (and, for Claude,
// instead of an AWS profile). The pure parts live here, so the tests can try them without a gateway: cleaning the
// config, the environment and settings each Claude session gets, reading `lite` output, and matching errors.
//
// What `lite` does (docs.litellm.ai/docs/proxy/management_cli and /proxy/cli_sso, checked 2026-10-30):
//  - one sign-in per OS user: the key is in the OS keychain, the rest in ~/.litellm/token.json, matched to the exact
//    gateway URL, so Docket keys the sign-in by URL and every company on that URL shares it;
//  - `lite --base-url <url> login --pkce` prints "Opening browser to: https://…", waits for Approve, then prints
//    "Login successful!"; plain `lite login` (login: device) prints a link and a code to type;
//  - `lite --base-url <url> auth print-token` prints only the key (renewing a --pkce one about to expire) and exits 0;
//  - `lite whoami` names the user.
import { GEARS, gearsOf, findGear } from './gears.mjs';

// The brands that can go through a gateway so far. Codex comes next; Grok only if the gateway serves it.
export const GATEWAY_BRANDS = ['claude'];
export const CLAUDE_ROUTES = ['messages', 'bedrock'];
export const LOGINS = ['pkce', 'device', 'key'];

// A gateway address: https, or http for this computer only (a local test proxy). No trailing slash, so <url>/v1 reads right.
export function cleanUrl(u) {
  const s = String(u || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  let p; try { p = new URL(s); } catch { return null; }
  if (p.protocol === 'https:' || (p.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(p.hostname))) return s;
  return null;
}
export const gatewayHost = (url) => { try { return new URL(url).host; } catch { return String(url || ''); } };

// A company's gateway block as typed or saved: { gateway } (or {} for none), or { error }. name: the company's, for
// the error. aws: whether it also has an AWS profile, which can't go with a Claude gateway (it has to be clear who pays).
// Flat fields from the Companies screen (gatewayUrl, gatewayClaudeRoute, gatewayLogin, gatewayLite,
// gatewayModel_claude_<key>) win over a gateway object.
export function cleanGateway(c, { name = 'This company', aws = false, isAbsolute = () => true } = {}) {
  const flat = c?.gatewayUrl !== undefined;
  const g = flat ? {
    url: c.gatewayUrl, claudeRoute: c.gatewayClaudeRoute, login: c.gatewayLogin, lite: c.gatewayLite,
    brands: c.gatewayBrands || (String(c.gatewayUrl || '').trim() ? ['claude'] : []),
    models: Object.fromEntries(GATEWAY_BRANDS.map((b) => [b, Object.fromEntries(gearsOf(b).map((x) => [x.key, c[`gatewayModel_${b}_${x.key}`]]))])),
  } : c?.gateway;
  if (!g || typeof g !== 'object') return {};
  const url = cleanUrl(g.url);
  if (url === null) return { error: `${name}: the gateway address must start with https:// (or http://localhost for a test proxy)` };
  if (!url) return {};
  const brands = [...new Set((Array.isArray(g.brands) ? g.brands : ['claude']).filter((b) => GATEWAY_BRANDS.includes(b)))];
  if (!brands.length) return { error: `${name}: say which brands go through the gateway (so far: ${GATEWAY_BRANDS.join(', ')})` };
  if (aws && brands.includes('claude')) return { error: `${name}: Claude can go through the gateway or run on Bedrock with an AWS profile, not both. Clear one of them, so it is clear who pays.` };
  const route = String(g.claudeRoute || '').trim();
  if (route && !CLAUDE_ROUTES.includes(route)) return { error: `${name}: the gateway's Claude route is messages or bedrock (or empty to pick by this computer's policy)` };
  const login = String(g.login || '').trim() || 'pkce';
  if (!LOGINS.includes(login)) return { error: `${name}: the gateway sign-in is pkce, device or key` };
  const lite = String(g.lite || '').trim();
  if (lite && !isAbsolute(lite)) return { error: `${name}: the lite program must be a full path, or empty to find it` };
  const models = {};
  for (const b of GATEWAY_BRANDS) {
    const m = {};
    for (const x of GEARS[b]) { const v = String(g.models?.[b]?.[x.key] ?? '').trim(); if (v) m[x.key] = v.slice(0, 200); }
    if (Object.keys(m).length) models[b] = m;
  }
  return { gateway: { url, brands, ...(route ? { claudeRoute: route } : {}), ...(login !== 'pkce' ? { login } : {}), ...(lite ? { lite } : {}), ...(Object.keys(models).length ? { models } : {}) } };
}

// The gateway a brand of this company goes through, or null.
export const gatewayFor = (client, brand = 'claude') => client?.gateway?.url && (client.gateway.brands || ['claude']).includes(brand) ? client.gateway : null;
export const loginOf = (gw) => gw?.login || 'pkce';
// Claude's route: Bedrock whenever this computer's policy forces Bedrock on every Claude run, whatever is set (Claude
// Code reads the policy itself, so on the messages route it skips the gateway and goes to AWS with this computer's
// own credentials: tried 2026-10-30), else the one set, else messages, the preferred one.
export const claudeRouteOf = (gw, policy) => policy === 'Amazon Bedrock' ? 'bedrock' : gw.claudeRoute || 'messages';

// The gears a gateway brand can use: those the gateway has a name for. With no names at all, every gear, under its
// own model id. A gear with no name is hidden: Shift can't pick it, and a start gear falls back to the next one up.
export function visibleGears(client, brand) {
  const all = gearsOf(brand), names = gatewayFor(client, brand)?.models?.[brand];
  if (!names || !Object.keys(names).length) return all;
  const shown = all.filter((g) => names[g.key]);
  return shown.length ? shown : all;
}
// The gear actually used for a wanted one: itself if shown, else the next one up, else the highest shown.
export function usableGear(client, brand, gear) {
  const shown = visibleGears(client, brand), all = gearsOf(brand);
  if (!gear || shown.includes(gear)) return gear;
  return all.slice(all.indexOf(gear)).find((g) => shown.includes(g)) || shown[shown.length - 1];
}
// The model name an engine is sent for a model Docket picked (a gear id or key, or a name typed on the page): the
// gateway's name for that gear, else the name as given.
export function modelFor(client, brand, model) {
  const names = gatewayFor(client, brand)?.models?.[brand];
  if (!names || !model) return model;
  const g = usableGear(client, brand, findGear(brand, model));
  return (g && names[g.key]) || model;
}
// The other way, for costs: a gateway name back to its gear's model id, so pricing.json still matches.
export function gearModelMap(client, brand = 'claude') {
  const names = gatewayFor(client, brand)?.models?.[brand] || {};
  return Object.fromEntries(gearsOf(brand).filter((g) => names[g.key]).map((g) => [names[g.key], g.id]));
}

// The command that prints the key, as a Claude Code apiKeyHelper (run by a shell, so the path is quoted; forward
// slashes read the same in cmd and in Git Bash). Claude Code caches its answer for CLAUDE_CODE_API_KEY_HELPER_TTL_MS.
export function printTokenCommand(lite, url) {
  const exe = String(lite).replace(/\\/g, '/');
  // A stand-in written in JavaScript (the tests' test-fixtures/fake-lite.mjs) is run with node.
  const run = /\.m?js$/i.test(exe) ? `"${process.execPath.replace(/\\/g, '/')}" "${exe}"` : `"${exe}"`;
  return `${run} --base-url ${url} auth print-token`;
}
// lite's own arguments, with the gateway named first.
export const liteArgs = (url, ...args) => ['--base-url', url, ...args];
export const liteCommand = (exe, args) => /\.m?js$/i.test(exe) ? [process.execPath, [exe, ...args]] : [exe, args];

// The tags each request carries, so the gateway's spend logs can be split by company and session.
export const gatewayTags = (companyId, sessionId) => ['docket', `company:${companyId}`, ...(sessionId ? [`session:${sessionId}`] : [])].join(',');

// What a Claude session through the gateway gets. env: variables to set; unset: ones to remove (from what this
// process inherited); settings: the session's own settings layer (the SDK's settings option, kept in memory for that
// run, never written to the company's settings.json). key: the virtual key for login "key" (LITELLM_PROXY_API_KEY).
export function claudeGateway(gw, { route, lite, companyId, sessionId, key } = {}) {
  const env = {}, unset = ['AWS_PROFILE', 'AWS_BEARER_TOKEN_BEDROCK', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
  if (route === 'bedrock') {
    // Without skip-auth Claude Code signs Bedrock requests with AWS credentials and drops the Authorization header.
    Object.assign(env, { CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_BEDROCK_BASE_URL: `${gw.url}/bedrock`, CLAUDE_CODE_SKIP_BEDROCK_AUTH: '1' });
  } else {
    env.ANTHROPIC_BASE_URL = gw.url;
    unset.push('CLAUDE_CODE_USE_BEDROCK');
  }
  const names = gw.models?.claude || {};
  // A gear with no name drops any id this computer set for it (a Bedrock one would mean nothing to the gateway).
  for (const [k, v] of Object.entries({ haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL', opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL' })) if (names[k]) env[v] = names[k]; else unset.push(v);
  env.ANTHROPIC_CUSTOM_HEADERS = `x-litellm-tags: ${gatewayTags(companyId, sessionId)}`;
  const settings = {};
  if (loginOf(gw) === 'key') {
    if (key) env.ANTHROPIC_AUTH_TOKEN = key;
  } else {
    settings.apiKeyHelper = printTokenCommand(lite, gw.url);
    env.CLAUDE_CODE_API_KEY_HELPER_TTL_MS = '300000';
  }
  // A model id Claude Code reaches for by itself (a helper on a full id) still goes to the gateway's name for it.
  const overrides = Object.fromEntries(GEARS.claude.filter((g) => names[g.key]).map((g) => [g.id, names[g.key]]));
  if (Object.keys(overrides).length) settings.modelOverrides = overrides;
  return { env, unset: unset.filter((k) => !(k in env)), settings };
}

// ---------- reading lite's output ----------
const plain = (out) => String(out || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
// The link (and for login device, the code) a sign-in prints: { url, code } or null while there is none yet.
// --pkce prints "Opening browser to: https://…/authorize?…". Plain login prints a link and a code to type, which some
// proxies fill in on the page already (the link then carries it).
export function loginLink(out) {
  const t = plain(out);
  const pkce = t.match(/Opening browser to:\s*(https?:\/\/\S+)/i);
  if (pkce) return { url: pkce[1], code: null };
  const url = t.match(/https?:\/\/\S+/)?.[0];
  if (!url) return null;
  const code = t.match(/\bcode\b[^\n:]*:\s*([A-Z0-9]{3,}(?:-[A-Z0-9]{3,})*)/i)?.[1] || t.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/)?.[0] || null;
  return { url: url.replace(/[).,]+$/, ''), code };
}
export const loginDone = (out) => /login successful/i.test(plain(out));
// --pkce on a proxy that doesn't serve /.well-known/litellm-cli-auth: the sign-in falls back to login device.
export const pkceUnsupported = (out) => /(does ?n[o']t|not) support|no such option.*pkce|litellm-cli-auth|well-known/i.test(plain(out));
// `lite whoami`: the user's email when it shows one, else the user id.
export function whoamiUser(out) {
  const t = plain(out);
  return t.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0] || t.match(/user(?:[ _]?id)?\s*[:=]\s*(\S+)/i)?.[1] || null;
}
// `lite auth print-token`: the key on stdout (anything else goes to stderr). Signed out: a non-zero exit or nothing.
export const tokenFrom = (code, out) => code === 0 && /^\S+$/.test(String(out || '').trim()) ? String(out).trim() : '';

// A failed turn whose error means the gateway refused the sign-in: a 401, an authentication error, a bad or expired
// key, or the key helper (lite) failing.
const GATEWAY_REFUSED = /\b401\b|authentication.?error|invalid.{0,30}(token|key)|(token|key).{0,30}expired|expired.{0,30}(token|key)|apiKeyHelper.{0,80}(fail|error)|lite(llm)?[^\n]{0,60}(not logged in|login required|run .?lite login)/i;
export const gatewayRefused = (text) => GATEWAY_REFUSED.test(String(text || ''));
