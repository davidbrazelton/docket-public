// What a failed turn says about signing in, and the checks that notice a sign-in ending or coming back.

// A Claude (or other brand) sign-in that is missing or refused.
const SIGNED_OUT = /not logged in|authenticate|authentication failed|\/login/i;
// Bedrock's AWS credentials running out, e.g. "Could not load AWS credentials · Token is expired. To refresh this SSO
// session run 'aws sso login' with the corresponding profile."
const AWS_EXPIRED = /could not load aws credentials|token is expired|aws sso login|expiredtoken|sso session.*expired|security token.*expired/i;

// Whether a turn's error text means the company has to sign in again. bedrock: the turn ran on Amazon Bedrock.
export const signInFailure = (text, bedrock = false) => SIGNED_OUT.test(text || '') || (bedrock && AWS_EXPIRED.test(text || ''));

// The prompt to offer again once signed in: the last message sent to the session, or '' if there is none.
export function retryText(events) {
  const last = [...(events || [])].reverse().find((e) => e.k === 'user');
  return last?.text?.trim() || '';
}

// Asks check(client) whether each client is signed in, and calls onChange(client, signedIn) for each whose answer
// differs from known(client) (true, false, or undefined when not yet checked). A check that throws is skipped.
export async function recheckSignIns(clients, known, check, onChange) {
  for (const c of clients) {
    const before = known(c); // read first: the check may store its own answer
    let now;
    try { now = await check(c); } catch { continue; }
    if (now !== before) onChange(c, now);
  }
}

// What AWS says when a Bedrock desk's credentials are missing, expired or refused: the expired wordings above, and
// "Error loading SSO Token", "Unable to locate credentials", an unknown profile, or a key AWS turns down.
const AWS_SIGNED_OUT = new RegExp(`${AWS_EXPIRED.source}|token has expired|error loading sso token|unable to locate credentials|` +
  'profile .* could not be found|invalidclienttokenid|unrecognizedclientexception|signaturedoesnotmatch|invalidgrant', 'i');
// What `aws sts get-caller-identity` ({ code, out, err, timedOut }) says about a Bedrock desk's AWS sign-in: true,
// false only when AWS itself says the credentials are expired or invalid, and null (unknown) when it ran out of time,
// could not run, or failed some other way (AWS or the network being slow or unreachable, say).
export function awsSignedIn({ code, out = '', err = '', timedOut = false } = {}) {
  if (timedOut) return null;
  if (code === 0) return true;
  return AWS_SIGNED_OUT.test(`${err}\n${out}`) ? false : null;
}
// An unknown answer keeps the last one; with none yet it counts as signed in, so a slow check never shows the Sign in
// prompt (a turn that fails on its credentials still does, through signInFailure).
export const keepKnown = (now, before) => now ?? before ?? true;
