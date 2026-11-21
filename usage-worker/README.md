# Docket's usage counter

The Cloudflare Worker and D1 database that keep Docket's anonymous usage stats (#848). What Docket sends, and how to
turn it off, is in the main README under "Usage stats". `src/clean.js` keeps only those fields; anything else is dropped.

- `POST /v1/ping`: the app's daily report (usage.mjs); one row per install per day in `pings`, the last send that day wins.
- `POST /v1/install`: one row in `installer_runs` per finished install, carrying only the platform.

## Set it up (once)

From this folder, signed in to the Cloudflare account (`npx wrangler login`, or `CLOUDFLARE_API_TOKEN` set):

```
npx wrangler d1 create docket-usage          # put the database_id it prints in wrangler.toml
npx wrangler d1 execute docket-usage --remote --file schema.sql
npx wrangler deploy
```

The address is `https://docket-usage.<account subdomain>.workers.dev`. It is in `usage.mjs` (USAGE_URL),
`install-windows.ps1` and `install-mac.sh`; `test/usage.test.mjs` checks all three agree. The public copy ships it, and
copies already installed keep sending to it, so the subdomain is not changed once released. A name on the
private-names guard's list (test/private-names.test.mjs) would stop the publish.

## Read it

`queries.sql` answers the launch questions: installs over time, installs that reached a first start, daily, weekly
and monthly active installs, still in use after 7 and 30 days, install count by version and platform, sessions by
brand, average groups and desks per install, and how much each switch is used.

```
npx wrangler d1 execute docket-usage --remote --file queries.sql
npx wrangler d1 execute docket-usage --remote --command "SELECT version, platform, COUNT(DISTINCT install_id) FROM pings GROUP BY 1, 2"
```

## Leave your own computers out

The maker's own computers keep usage stats on (it is the only way to check that reports really reach the counter), so
their installs are left out when the numbers are read instead: every query in `queries.sql` skips the install IDs in
the `excluded` table. On each such computer, find its install ID (`usage.id` in `portal-state.json`) from the Docket
folder:

```
node -e "console.log(require('./portal-state.json').usage.id)"
```

and add it from this folder (the note says which computer). A database set up before the table existed needs
`npx wrangler d1 execute docket-usage --remote --file schema.sql` once first; until then the queries stop with
"no such table: excluded".

```
npx wrangler d1 execute docket-usage --remote --command "INSERT INTO excluded (install_id, note) VALUES ('<id>', '<computer>')"
```

The IDs live only in the database: never put one in this repo, which is published. `installer_runs` carries no install
ID, so your own installer runs cannot be left out this way; subtract them by hand if they matter.

## Try it on this computer

```
npx wrangler d1 execute docket-usage --local --file schema.sql
npx wrangler dev --local --port 8787
```

Then start a test copy of Docket with `DOCKET_USAGE_URL=http://localhost:8787` (a test copy sends nowhere without it)
and `POST /api/usage-stats {"sendNow": true}` to send at once; read it back with `--local` in place of `--remote`.
