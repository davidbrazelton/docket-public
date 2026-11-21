// A desk's own environment variables, saved as "env" in clients.local.json: live tooling that keeps state
// outside the home (BATON_NOTES_ROOT and the like) can be pointed at this desk's own folders.
// envFor gives them to every session of every brand (and so to its hooks and tools), and the Terminal window and
// docket-env.ps1 / docket-env.sh set them too. Kept apart from server.mjs so the tests can try it.

// Names Docket sets itself (the homes, the sign-in, the connection), so a desk can't set them.
export const RESERVED = [/^CLAUDE_CONFIG_DIR$/, /^CODEX_HOME$/, /^GROK_HOME$/, /^GH_CONFIG_DIR$/, /^DOCKET_/, /^CLAUDE_CODE_USE_BEDROCK$/, /^AWS_PROFILE$/, /^AWS_REGION$/];
export const isReserved = (name) => RESERVED.some((r) => r.test(String(name).toUpperCase()));

// The list as typed (an object, or [[name, value]] / [{ name, value }] rows), checked: { env } or { error }. A row with
// no name and no value is dropped.
export function cleanEnv(input) {
  const rows = Array.isArray(input) ? input.map((r) => Array.isArray(r) ? r : [r?.name, r?.value]) : Object.entries(input || {});
  const env = {};
  for (const [n, v] of rows) {
    const name = String(n ?? '').trim(), value = String(v ?? '');
    if (!name && !value.trim()) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { error: `${name || '(no name)'} is not a variable name (letters, digits and _, not starting with a digit)` };
    if (isReserved(name)) return { error: `${name} is set by Docket itself (the homes, sign-in and connection), so a desk can't set it` };
    if (/[\r\n\0]/.test(value)) return { error: `${name}: the value must be on one line` };
    if (name in env) return { error: `${name} is in the list twice` };
    env[name] = value;
  }
  return { env };
}

// The prefixes a terminal clears before it sets a desk's variables, so nothing of another desk's (or of the session
// it was opened from) is left behind.
export const CLEARED = ['CLAUDE', 'ANTHROPIC', 'USE_LOCAL_OAUTH', 'USE_STAGING_OAUTH', 'CODEX_', 'GROK_', 'DOCKET_'];

// The same variables as a block to paste, for PowerShell, Command Prompt and bash/zsh: vars is name -> value, or
// empty to unset. The PowerShell and bash ones are also what docket-env.ps1 and docket-env.sh hold.
export function envScripts(vars, name = '') {
  const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const head = name ? `Docket: ${name}'s homes, sign-ins and variables. ` : '';
  const ps = [
    `# ${head}Run it in a window with: . <path to this file>`,
    `Get-ChildItem env: | Where-Object Name -match '^(${CLEARED.join('|')})' | ForEach-Object { Remove-Item ('env:' + $_.Name) -ErrorAction SilentlyContinue }`,
    ...Object.entries(vars).map(([k, v]) => v ? `$env:${k} = ${psq(v)}` : `Remove-Item env:${k} -ErrorAction SilentlyContinue`),
  ].join('\n') + '\n';
  const sh = [
    `# ${head}Run it in a window with: . <path to this file>`,
    `for v in $(env | awk -F= '/^(${CLEARED.join('|')})/ {print $1}'); do unset "$v"; done`,
    ...Object.entries(vars).map(([k, v]) => v ? `export ${k}=${shq(v)}` : `unset ${k}`),
  ].join('\n') + '\n';
  const cmd = [
    ...CLEARED.map((p) => `for /f "delims==" %v in ('set ${p} 2^>nul') do @set "%v="`),
    ...Object.entries(vars).map(([k, v]) => `set "${k}=${v}"`),
  ].join('\r\n') + '\r\n';
  return { ps, sh, cmd };
}
