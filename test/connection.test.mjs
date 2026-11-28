// Who a desk's use is billed to, one case per row of the issue's identity table. Every home here is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionOf, parseAwsConfig, awsAccountOf, codexProvider, fingerprint, kindOfKey } from '../connection.mjs';

const jwt = (claims) => ['x', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'y'].join('.');
const AWS = parseAwsConfig(`
[default]
region = us-east-1

[profile acme-dev]
sso_session = acme
sso_account_id = 111122223333
sso_role_name = Dev
region = us-east-1

[profile acme-ops]
sso_start_url = https://acme.awsapps.com/start
sso_account_id = 111122223333
region = us-west-2

[profile base]
aws_access_key_id = AKIAEXAMPLEEXAMPLE
aws_secret_access_key = secretsecretsecret

[profile assumed]
role_arn = arn:aws:iam::444455556666:role/Bedrock
source_profile = base

[profile chained]
source_profile = acme-dev

[profile plainkeys]
aws_access_key_id = AKIAEXAMPLE2
region = eu-west-1

[sso-session acme]
sso_region = us-east-1
`);
const desk = (id, extra = {}) => ({ id, name: id[0].toUpperCase() + id.slice(1), ...extra });
const noSecret = (c, ...secrets) => { for (const s of secrets) for (const v of Object.values(c)) assert.ok(!String(v).includes(s), `${s} shows in ${v}`); };

test('the AWS config gives each profile its account: sso_account_id, role_arn, source_profile', () => {
  const by = Object.fromEntries(AWS.map((p) => [p.name, p]));
  assert.equal(by['acme-dev'].accountId, '111122223333');
  assert.equal(by['acme-dev'].sso, true);
  assert.equal(by.assumed.accountId, '444455556666');
  assert.equal(by.assumed.sourceProfile, 'base');
  assert.equal(by.plainkeys.accountId, '');
  assert.ok(!by.acme, 'an sso-session section is not a profile');
  assert.equal(awsAccountOf(AWS, 'chained'), '111122223333');
  assert.equal(awsAccountOf(AWS, 'plainkeys'), '');
  assert.equal(awsAccountOf(AWS, 'nowhere'), '');
});

test('Bedrock: two profiles naming one AWS account are one connection, region in the detail only', () => {
  const a = connectionOf({ brand: 'claude', bedrock: true, client: desk('acme', { awsProfile: 'acme-dev', awsRegion: 'us-east-1' }), files: { aws: AWS } });
  const b = connectionOf({ brand: 'claude', bedrock: true, client: desk('acme2', { awsProfile: 'acme-ops' }), files: { aws: AWS } });
  assert.deepEqual(a, { key: 'aws:111122223333', label: 'AWS 111122223333', kind: 'bedrock', detail: 'profile acme-dev, us-east-1', exact: true });
  assert.equal(b.key, a.key);
  assert.equal(b.detail, 'profile acme-ops, us-west-2');
});

test('Bedrock: a role_arn through source_profile names the role account', () => {
  const c = connectionOf({ brand: 'claude', bedrock: true, client: desk('acme', { awsProfile: 'assumed', awsRegion: 'us-east-2' }), files: { aws: AWS } });
  assert.equal(c.key, 'aws:444455556666');
  assert.equal(c.exact, true);
});

test('Bedrock: a profile with plain keys is grouped by its name, not exact; no profile is per desk', () => {
  const c = connectionOf({ brand: 'claude', bedrock: true, client: desk('acme', { awsProfile: 'PlainKeys' }), files: { aws: AWS } });
  assert.deepEqual(c, { key: 'aws-profile:plainkeys', label: 'aws:PlainKeys', kind: 'bedrock', detail: '', exact: false });
  const none = connectionOf({ brand: 'claude', bedrock: true, client: desk('acme'), files: { aws: AWS } });
  assert.equal(none.key, 'unknown:acme:bedrock');
  assert.equal(none.kind, 'unknown');
});

test('Claude subscription: grouped by the signed-in email, the organization in the detail', () => {
  const claudeJson = { oauthAccount: { emailAddress: 'Pat@Acme.com', organizationUuid: 'org-1', organizationName: 'Acme' } };
  const a = connectionOf({ client: desk('acme'), files: { claudeJson } });
  const b = connectionOf({ client: desk('acme2'), files: { claudeJson } });
  assert.deepEqual(a, { key: 'claude:pat@acme.com', label: 'Pat@Acme.com', kind: 'subscription', detail: 'Acme', exact: true });
  assert.equal(b.key, a.key, 'a copy of a desk on the same sign-in adds up');
});

test('Claude API key vs a key helper: a fingerprint and the last 4, never the key', () => {
  const key = 'sk-ant-api03-EXAMPLEEXAMPLEEXAMPLE-wxyz';
  const k = connectionOf({ client: desk('acme'), files: { claudeJson: { primaryApiKey: key } } });
  assert.deepEqual(k, { key: `anthropic-key:api.anthropic.com:${fingerprint(key)}`, label: 'Anthropic API key …wxyz', kind: 'apikey', detail: '', exact: true });
  noSecret(k, key, 'EXAMPLEEXAMPLE');
  const h = connectionOf({ client: desk('acme'), files: { claudeJson: { primaryApiKey: key }, settings: { apiKeyHelper: 'vault read anthropic', env: { ANTHROPIC_BASE_URL: 'https://Proxy.example.com/v1' } } } });
  assert.equal(h.key, `anthropic-key:proxy.example.com:${fingerprint('vault read anthropic')}`);
  assert.equal(h.label, `proxy.example.com key helper (${fingerprint('vault read anthropic')})`);
  noSecret(h, 'vault read');
  const t = connectionOf({ client: desk('acme'), files: { settings: { env: { ANTHROPIC_API_KEY: 'sk-ant-other-1234' } }, claudeJson: { oauthAccount: { emailAddress: 'pat@acme.com' } } } });
  assert.equal(t.key, `anthropic-key:api.anthropic.com:${fingerprint('sk-ant-other-1234')}`, 'a key in the settings wins over the sign-in, as in Claude Code');
  assert.equal(fingerprint(key).length, 8);
});

test('Claude not readable: the desk\'s own line, never merged across desks', () => {
  assert.deepEqual(connectionOf({ client: desk('acme') }), { key: 'unknown:acme:claude', label: 'Acme sign-in', kind: 'unknown', detail: '', exact: false });
  assert.notEqual(connectionOf({ client: desk('acme') }).key, connectionOf({ client: desk('beta') }).key);
});

test('Codex: a ChatGPT sign-in by email; API keys split by fingerprint', () => {
  const chat = connectionOf({ brand: 'codex', client: desk('acme'), files: { codexAuth: { tokens: { id_token: jwt({ email: 'pat@acme.com' }) } } } });
  assert.deepEqual(chat, { key: 'chatgpt:pat@acme.com', label: 'chatgpt:pat@acme.com', kind: 'subscription', detail: '', exact: true });
  const k1 = connectionOf({ brand: 'codex', client: desk('acme'), files: { codexAuth: { OPENAI_API_KEY: 'sk-proj-one-aaaa' } } });
  const k2 = connectionOf({ brand: 'codex', client: desk('beta'), files: { codexAuth: { OPENAI_API_KEY: 'sk-proj-two-bbbb' } } });
  assert.equal(k1.label, 'OpenAI API key …aaaa');
  assert.equal(k1.kind, 'apikey');
  assert.notEqual(k1.key, k2.key, 'two keys are two connections, not one "openai (API key)"');
  noSecret(k1, 'sk-proj-one');
  const mode = connectionOf({ brand: 'codex', client: desk('acme'), files: { codexAuth: { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-one-aaaa', tokens: { id_token: jwt({ email: 'pat@acme.com' }) } } } });
  assert.equal(mode.key, k1.key, 'auth_mode apikey uses the key even with a sign-in saved');
  assert.equal(connectionOf({ brand: 'codex', client: desk('acme') }).key, 'unknown:acme:codex');
});

test('Codex: a config.toml provider with its own base_url is paid to that host', () => {
  const toml = `model = "gpt-5"\nmodel_provider = "azure"\n\n[model_providers.azure]\nname = "Azure"\nbase_url = "https://acme.openai.azure.com/openai"\nenv_key = "AZURE_OPENAI_API_KEY"\n`;
  assert.deepEqual(codexProvider(toml), { name: 'azure', base_url: 'https://acme.openai.azure.com/openai', env_key: 'AZURE_OPENAI_API_KEY' });
  const auth = { tokens: { id_token: jwt({ email: 'pat@acme.com' }) } };
  const c = connectionOf({ brand: 'codex', client: desk('acme'), files: { codexAuth: auth, codexConfig: toml, env: { AZURE_OPENAI_API_KEY: 'azkey-123456789' } } });
  assert.deepEqual(c, { key: `openai-key:acme.openai.azure.com:${fingerprint('azkey-123456789')}`, label: 'acme.openai.azure.com key …6789', kind: 'apikey', detail: 'provider azure', exact: true });
  const noKey = connectionOf({ brand: 'codex', client: desk('acme'), files: { codexAuth: auth, codexConfig: toml } });
  assert.equal(noKey.key, 'openai-key:acme.openai.azure.com:azure_openai_api_key');
  assert.equal(noKey.exact, false);
  assert.equal(codexProvider('model = "gpt-5"\n'), null);
});

test("a key in the desk's own variables is what it is billed to", () => {
  const cx = connectionOf({ brand: 'codex', client: desk('x'), files: { env: { OPENAI_API_KEY: 'sk-proj-desk-env-9999' } } });
  assert.equal(cx.label, 'OpenAI API key …9999');
  assert.equal(cx.key, `openai-key:api.openai.com:${fingerprint('sk-proj-desk-env-9999')}`);
  // A ChatGPT sign-in in auth.json is still what Codex uses over the variable.
  assert.equal(connectionOf({ brand: 'codex', client: desk('x'), files: { env: { OPENAI_API_KEY: 'k' }, codexAuth: { tokens: { id_token: jwt({ email: 'me@x.com' }) } } } }).key, 'chatgpt:me@x.com');
  const cl = connectionOf({ brand: 'claude', client: desk('c'), files: { env: { ANTHROPIC_API_KEY: 'sk-ant-desk-env-8888', ANTHROPIC_BASE_URL: 'https://llm.example.com' }, claudeJson: { oauthAccount: { emailAddress: 'me@x.com' } } } });
  assert.equal(cl.label, 'llm.example.com key …8888');
  // The settings' env is over the desk's variables.
  assert.match(connectionOf({ brand: 'claude', client: desk('c'), files: { env: { ANTHROPIC_API_KEY: 'a-1111' }, settings: { env: { ANTHROPIC_API_KEY: 'b-2222' } } } }).label, /…2222$/);
  noSecret(cx, 'sk-proj-desk-env'); noSecret(cl, 'sk-ant-desk-env');
});

test('Grok: by email with the brand in the key; an API key; no email is per desk', () => {
  const g = connectionOf({ brand: 'grok', client: desk('acme'), files: { grokAuth: { 'https://accounts.x.ai': { email: 'pat@acme.com', first_name: 'Pat' } } } });
  assert.deepEqual(g, { key: 'grok:pat@acme.com', label: 'pat@acme.com', kind: 'subscription', detail: '', exact: true });
  const k = connectionOf({ brand: 'grok', client: desk('acme'), files: { env: { XAI_API_KEY: 'xai-secret-9876', GROK_MODELS_BASE_URL: 'https://llm.example.com/v1' } } });
  assert.deepEqual(k, { key: `xai-key:llm.example.com:${fingerprint('xai-secret-9876')}`, label: 'llm.example.com key …9876', kind: 'apikey', detail: '', exact: true });
  const named = connectionOf({ brand: 'grok', client: desk('acme'), files: { grokAuth: { x: { first_name: 'Pat' } } } });
  assert.deepEqual(named, { key: 'unknown:acme:grok', label: 'Pat (Grok)', kind: 'unknown', detail: '', exact: false });
  assert.equal(connectionOf({ brand: 'grok', client: desk('acme') }).label, 'Acme Grok sign-in');
});

test('the same email under Claude and Grok is two connections', () => {
  const claude = connectionOf({ client: desk('acme'), files: { claudeJson: { oauthAccount: { emailAddress: 'pat@acme.com' } } } });
  const grok = connectionOf({ brand: 'grok', client: desk('acme'), files: { grokAuth: { x: { email: 'pat@acme.com' } } } });
  assert.equal(claude.label, grok.label);
  assert.notEqual(claude.key, grok.key);
});

test('a gateway is the payer for every brand through it', () => {
  const gw = { url: 'https://LLM.acme.example/v1', user: 'pat' };
  const keys = ['claude', 'codex', 'grok'].map((brand) => connectionOf({ brand, client: desk(brand, { gateway: gw }) }).key);
  assert.deepEqual(new Set(keys), new Set(['gateway:llm.acme.example:pat']));
  assert.equal(connectionOf({ client: desk('acme', { gateway: gw }) }).label, 'gateway llm.acme.example (pat)');
});

test('the kind of a key seen only in old rows', () => {
  assert.equal(kindOfKey('aws:111122223333'), 'bedrock');
  assert.equal(kindOfKey('claude:pat@acme.com'), 'subscription');
  assert.equal(kindOfKey('openai-key:api.openai.com:abcd1234'), 'apikey');
  assert.equal(kindOfKey('unknown:acme:claude'), 'unknown');
});
