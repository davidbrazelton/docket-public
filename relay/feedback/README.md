# Docket's feedback relay

The small hosted function behind Docket's Suggest a feature button (#1035). Docket posts the suggestion here with no
key; the relay checks the limits and files it as a GitHub Issue labelled `suggestion` in the private repo. The relay's
environment holds the only GitHub token, so no Docket install, and nothing in the public copy, carries one.

- `relay.mjs`: everything the relay decides (checks, limits, the Issue, GitHub's answer). Tested by
  `test/feedback-relay.test.mjs` from the repo root.
- `netlify/functions/feedback.mjs`: the Netlify Functions wrapper, serving `POST /v1/suggest`, with the day's counts in
  Netlify Blobs.
- `local.mjs`: the same relay on this computer, counts in memory, for trying a Docket test copy against it.

## Limits

- 3 suggestions a day per sender, counted both by address and by install ID; either one at 3 refuses the next.
- 30 a day from everyone together.
- The day is the UTC day. Addresses are stored only as a hash salted with the day.
- Empty messages, messages over 4,000 characters and reports without an install ID are refused.
- A send that GitHub does not file (refused, or not reached) is not counted.

Over a limit the relay answers 429 with the reason, and Docket's panel shows "Not sent" with it and keeps the message.
Docket's own per-computer count (`feedback.mjs`, 3 a day) is a first check only; this one is the one that holds.

## Set it up (once)

Needs the owner's Netlify sign-in and a GitHub token; nobody else can do these steps.

1. **The token.** On GitHub: Settings > Developer settings > Fine-grained tokens > Generate new token. Resource owner:
   the account that owns the private repo. Repository access: only that repo. Permissions: Issues, Read and write;
   nothing else (Metadata, Read, is added by itself). Pick an expiry and note it: when it runs out, sends fail with
   "error 401" until a new token is set in step 3.
2. **The site.** From this folder:
   ```
   npm install
   npx netlify-cli login
   npx netlify-cli sites:create --name docket-suggestions
   ```
   The address must stay `https://docket-suggestions.netlify.app` (it is `RELAY_URL` in `feedback.mjs`, and copies
   already installed keep sending to it). If that name is taken, pick another and change `RELAY_URL` to match.
   A Netlify team may protect new sites with a visitor login, which makes every send fail with error 401. Turn it off
   for this site: Site configuration > Access & security > Visitor access, or
   `npx netlify-cli api updateSite --data '{"site_id":"<site id>","body":{"sso_login":false}}'`.
3. **The settings.** Kept only in the site's environment, never in a file:
   ```
   npx netlify-cli env:set FEEDBACK_REPO <owner>/<repo>
   npx netlify-cli env:set FEEDBACK_GITHUB_TOKEN <the token> --secret
   ```
   Functions read these when deployed, so deploy (step 4) after setting or changing one.
4. **Deploy:** `npx netlify-cli deploy --prod --dir public --functions netlify/functions` (the flags are needed because this folder sits inside the Docket repo). Deploy again the same way after any change to this folder.
5. **Check it:** send one suggestion from Docket (the speech bubble in the top bar); it should say "Sent to the Docket
   team as suggestion #N", and the Issue should be in the repo with the `suggestion` label.

The labels `suggestion` and `accepted` should exist in the repo. GitHub makes `suggestion` the first time the relay uses
it if it is missing.

## Suggestions and autopilot

A `suggestion` Issue is written by someone outside, so nothing builds from it directly: the owner reads it and adds
`accepted` first. Wherever autopilot picks issues to work on (#885), it skips anything labelled `suggestion` without
`accepted`.

## Try it on this computer

```
FEEDBACK_GITHUB_TOKEN=<token> FEEDBACK_REPO=<owner>/<repo> node local.mjs 4490
```
then start Docket's test copy with `PORTAL_FEEDBACK_URL=http://localhost:4490/v1/suggest`. With no token it still runs
and answers "not set up", which is enough to see the panel's refusals.
