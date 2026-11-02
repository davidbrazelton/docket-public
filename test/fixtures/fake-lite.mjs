#!/usr/bin/env node
// A stand-in for LiteLLM's `lite` program, for the tests: the same commands and output Docket reads.
//   lite --base-url <url> login [--pkce]   prints a link (and for plain login a code), then "Login successful!"
//   lite --base-url <url> auth print-token prints the key, or exits 1 when signed out
//   lite --base-url <url> whoami           prints the user
// Its state is a JSON file named by FAKE_LITE_STATE: { signedIn, token, email, noPkce }. Login writes signedIn.
import fs from 'node:fs';

const file = process.env.FAKE_LITE_STATE;
const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
const write = (s) => file && fs.writeFileSync(file, JSON.stringify(s));
const args = process.argv.slice(2);
let url = '';
if (args[0] === '--base-url') { url = args[1]; args.splice(0, 2); }
const st = read();
const cmd = args.join(' ');

if (cmd.startsWith('login')) {
  const pkce = args.includes('--pkce');
  if (pkce && st.noPkce) { process.stderr.write(`Error: ${url} does not support /.well-known/litellm-cli-auth\n`); process.exit(2); }
  if (pkce) process.stdout.write(`Opening browser to: ${url}/sso/cli/authorize?state=abc123\n`);
  else process.stdout.write(`Visit ${url}/sso/cli and enter the code: ABCD-1234\n`);
  setTimeout(() => {
    write({ ...st, signedIn: true });
    process.stdout.write('Login successful!\n');
  }, Number(process.env.FAKE_LITE_DELAY || 300));
} else if (cmd === 'auth print-token') {
  if (!st.signedIn) { process.stderr.write('Not logged in. Run lite login.\n'); process.exit(1); }
  process.stdout.write((st.token || 'sk-fake-token') + '\n');
} else if (cmd === 'whoami') {
  if (!st.signedIn) { process.stderr.write('Not logged in.\n'); process.exit(1); }
  process.stdout.write(`User ID: u-1\nEmail: ${st.email || 'pat@example.com'}\n`);
} else {
  process.stderr.write(`fake-lite: unknown command ${cmd}\n`);
  process.exit(2);
}
