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
