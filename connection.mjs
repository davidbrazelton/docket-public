// Who a desk's AI use is billed to: its billing connection, so the Usage page can add up desks that share one
// (two desks on one AWS account, a copy of a desk on the same Claude sign-in, one API key or gateway).
// Pure: the server reads the files and passes their contents in.
//
// connectionOf({ brand, bedrock, client, files }) -> { key, label, kind, detail, exact }
//  - key: what rows are grouped by, lower-cased. It never holds a secret: an API key is named by the first 8 hex of
//    its sha256 (a key helper by its command's) and the label shows its last 4 characters, nothing more.
//  - kind: bedrock | subscription | apikey | gateway | unknown.
//  - detail: secondary facts (region, profile, organization), shown beside the label, never part of the key.
//  - exact: the key names the payer (an AWS account, a sign-in, a key), not just a local name.
// files (each optional):
//  - claudeJson, settings: the Claude home's .claude.json (oauthAccount, primaryApiKey) and settings.json (apiKeyHelper, env).
//  - aws: the profiles from parseAwsConfig(~/.aws/config).
//  - codexAuth, codexConfig: the Codex home's auth.json (parsed) and config.toml (text).
//  - grokAuth: the Grok home's auth.json (parsed).
//  - env: the environment the session runs with (OPENAI_BASE_URL, a provider's env_key, XAI_API_KEY, GROK_MODELS_BASE_URL).
// client: { id, name, awsProfile, awsRegion, gateway: { url, user } } (gateway, when it is there).
import crypto from 'node:crypto';

export const fingerprint = (secret) => crypto.createHash('sha256').update(String(secret)).digest('hex').slice(0, 8);
const last4 = (secret) => String(secret).slice(-4);
const hostOf = (url, fallback) => { try { return new URL(String(url)).host.toLowerCase() || fallback; } catch { return fallback; } };
const make = (key, label, kind, detail, exact) => ({ key: key.toLowerCase(), label, kind, detail: detail || '', exact });

// The profiles in an AWS config file, with the account each names: sso_account_id, else the account in role_arn.
export function parseAwsConfig(text) {
  const out = []; let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const sec = line.match(/^\s*\[\s*(?:profile\s+)?([^\]]+?)\s*\]/);
    if (sec) { cur = /^(sso-session|services)\s/.test(sec[1]) ? null : { name: sec[1], region: '', sso: false, accountId: '', sourceProfile: '' }; if (cur) out.push(cur); continue; }
    const kv = cur && line.match(/^\s*([\w-]+)\s*=\s*(.*?)\s*$/);
    if (!kv) continue;
    if (kv[1] === 'region') cur.region = kv[2];
    if (/^sso_/.test(kv[1])) cur.sso = true;
    if (kv[1] === 'sso_account_id' && /^\d{12}$/.test(kv[2])) cur.accountId ||= kv[2];
    if (kv[1] === 'role_arn') { const m = kv[2].match(/^arn:aws[\w-]*:iam::(\d{12}):/); if (m) cur.accountId = m[1]; }
    if (kv[1] === 'source_profile') cur.sourceProfile = kv[2];
  }
  return out;
}
// A profile's AWS account, following source_profile to the profile it signs in through.
export function awsAccountOf(profiles, name) {
  const seen = new Set();
  for (let p = profiles.find((x) => x.name === name); p && !seen.has(p.name); p = profiles.find((x) => x.name === p.sourceProfile)) {
    seen.add(p.name);
    if (p.accountId) return p.accountId;
    if (!p.sourceProfile) break;
  }
  return '';
}

// The two settings a Codex config.toml names its provider by: model_provider at the top, and that provider's table.
export function codexProvider(toml) {
  let name = '', table = '';
  const tables = {};
  for (const line of String(toml || '').split(/\r?\n/)) {
    const sec = line.match(/^\s*\[\s*([^\]]+?)\s*\]/);
    if (sec) { table = sec[1]; continue; }
    const kv = line.match(/^\s*([\w-]+)\s*=\s*["']?(.*?)["']?\s*(#.*)?$/);
    if (!kv) continue;
    if (!table && kv[1] === 'model_provider') name = kv[2];
    const m = table.match(/^model_providers\.["']?([^"']+)["']?$/);
    if (m) (tables[m[1]] ||= {})[kv[1]] = kv[2];
  }
  return name ? { ...(tables[name] || {}), name } : null;
}

const unknown = (client, brand, label) => make(`unknown:${client?.id || 'desk'}:${brand}`, label, 'unknown', '', false);
// A key-paid connection: who it is paid to (the host), and the key named by its fingerprint and last 4 characters.
function keyed(prefix, host, defaultHost, vendor, secret, { helper = false, detail = '' } = {}) {
  const who = host === defaultHost ? vendor : host;
  return make(`${prefix}:${host}:${fingerprint(secret)}`, helper ? `${who} key helper (${fingerprint(secret)})` : `${who} key …${last4(secret)}`, 'apikey', detail, true);
}

export function connectionOf({ brand = 'claude', bedrock = false, client = {}, files = {} } = {}) {
  const env = files.env || {};
  if (client.gateway?.url) { // every brand through one gateway is paid by the gateway
    const host = hostOf(client.gateway.url, String(client.gateway.url));
    const user = String(client.gateway.user || '');
    return make(`gateway:${host}:${user}`, `gateway ${host}${user ? ` (${user})` : ''}`, 'gateway', '', true);
  }
  if (brand === 'claude' && bedrock) {
    const name = client.awsProfile || '';
    if (!name) return unknown(client, 'bedrock', 'aws (profile unknown)');
    const profiles = files.aws || [];
    const p = profiles.find((x) => x.name === name);
    const region = client.awsRegion || p?.region || '';
    const account = awsAccountOf(profiles, name);
    const detail = [`profile ${name}`, region].filter(Boolean).join(', ');
    return account ? make(`aws:${account}`, `AWS ${account}`, 'bedrock', detail, true) : make(`aws-profile:${name}`, `aws:${name}`, 'bedrock', region, false);
  }
  if (brand === 'claude') {
    // As Claude Code picks: a key or token in the settings' env or the desk's own variables, then a key helper,
    // then the sign-in, then a saved key. The settings' env is put over the variables, as Claude Code does.
    const s = files.settings || {}, sEnv = { ...env, ...(s.env || {}) }, account = files.claudeJson?.oauthAccount;
    const host = hostOf(sEnv.ANTHROPIC_BASE_URL, 'api.anthropic.com');
    const secret = sEnv.ANTHROPIC_AUTH_TOKEN || sEnv.ANTHROPIC_API_KEY;
    if (secret) return keyed('anthropic-key', host, 'api.anthropic.com', 'Anthropic API', secret);
    if (s.apiKeyHelper) return keyed('anthropic-key', host, 'api.anthropic.com', 'Anthropic API', s.apiKeyHelper, { helper: true });
    if (account?.emailAddress) return make(`claude:${account.emailAddress}`, account.emailAddress, 'subscription', account.organizationName || account.organizationUuid || '', true);
    if (files.claudeJson?.primaryApiKey) return keyed('anthropic-key', host, 'api.anthropic.com', 'Anthropic API', files.claudeJson.primaryApiKey);
    return unknown(client, 'claude', account?.organizationName || `${client.name || 'Desk'} sign-in`);
  }
  if (brand === 'codex') {
    const provider = codexProvider(files.codexConfig);
    if (provider && provider.name !== 'openai') {
      const host = hostOf(provider.base_url, provider.name.toLowerCase());
      const secret = provider.env_key && env[provider.env_key];
      return secret ? keyed('openai-key', host, '', '', secret, { detail: `provider ${provider.name}` })
        : make(`openai-key:${host}:${provider.env_key || 'nokey'}`, `${host} (${provider.name})`, 'apikey', provider.env_key ? `key in ${provider.env_key}, not set here` : '', false);
    }
    const a = files.codexAuth || {};
    let email = '';
    try { if (a.tokens?.id_token) email = JSON.parse(Buffer.from(a.tokens.id_token.split('.')[1], 'base64url').toString('utf8')).email || ''; } catch {}
    if (email && a.auth_mode !== 'apikey') return make(`chatgpt:${email}`, `chatgpt:${email}`, 'subscription', '', true);
    const host = hostOf(env.OPENAI_BASE_URL, 'api.openai.com');
    if (a.OPENAI_API_KEY) return keyed('openai-key', host, 'api.openai.com', 'OpenAI API', a.OPENAI_API_KEY);
    if (!email && env.OPENAI_API_KEY) return keyed('openai-key', host, 'api.openai.com', 'OpenAI API', env.OPENAI_API_KEY);
    if (email) return make(`chatgpt:${email}`, `chatgpt:${email}`, 'subscription', '', true);
    return unknown(client, 'codex', 'chatgpt (sign-in unknown)');
  }
  if (brand === 'grok') {
    const a = Object.values(files.grokAuth || {})[0] || {};
    if (a.email) return make(`grok:${a.email}`, a.email, 'subscription', '', true);
    const secret = a.api_key || env.XAI_API_KEY || env.GROK_API_KEY;
    if (secret) return keyed('xai-key', hostOf(env.GROK_MODELS_BASE_URL, 'api.x.ai'), 'api.x.ai', 'xAI API', secret);
    return unknown(client, 'grok', a.first_name ? `${a.first_name} (Grok)` : `${client.name || 'Desk'} Grok sign-in`);
  }
  return unknown(client, brand, `${client.name || 'Desk'} sign-in`);
}

// The kind a key was made as, for a key seen only in old rows (its desk's setup has changed since).
export const kindOfKey = (key) => ({ aws: 'bedrock', 'aws-profile': 'bedrock', claude: 'subscription', chatgpt: 'subscription', grok: 'subscription',
  'anthropic-key': 'apikey', 'openai-key': 'apikey', 'xai-key': 'apikey', gateway: 'gateway' })[String(key).split(':')[0]] || 'unknown';
