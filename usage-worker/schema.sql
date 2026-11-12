-- Docket's usage counter (#848): one row per install per day, replaced by each later send that day, and one row per
-- finished install. No IP address, name or path is ever stored. Apply with:
--   npx wrangler d1 execute docket-usage --remote --file schema.sql
CREATE TABLE IF NOT EXISTS pings (
  install_id TEXT NOT NULL,
  day TEXT NOT NULL,              -- YYYY-MM-DD, UTC
  version TEXT NOT NULL,
  platform TEXT NOT NULL,         -- windows | mac | other
  first_seen TEXT NOT NULL,
  sessions_claude INTEGER NOT NULL DEFAULT 0,
  sessions_codex INTEGER NOT NULL DEFAULT 0,
  sessions_grok INTEGER NOT NULL DEFAULT 0,
  children INTEGER NOT NULL DEFAULT 0,
  shift_sessions INTEGER NOT NULL DEFAULT 0,
  gears TEXT NOT NULL DEFAULT '{}', -- JSON: { "opus": 3, "sonnet": 1 }
  plans INTEGER NOT NULL DEFAULT 0,
  ask INTEGER NOT NULL DEFAULT 0,
  handoff INTEGER NOT NULL DEFAULT 0,
  pages_usage INTEGER NOT NULL DEFAULT 0,
  pages_plans INTEGER NOT NULL DEFAULT 0,
  desks INTEGER NOT NULL DEFAULT 0,
  desks_claude INTEGER NOT NULL DEFAULT 0,
  desks_codex INTEGER NOT NULL DEFAULT 0,
  desks_grok INTEGER NOT NULL DEFAULT 0,
  remote_desks INTEGER NOT NULL DEFAULT 0,
  groups_count INTEGER NOT NULL DEFAULT 0,
  schedules INTEGER NOT NULL DEFAULT 0,
  signin_desks INTEGER NOT NULL DEFAULT 0,
  remote_control INTEGER NOT NULL DEFAULT 0,
  update_mode TEXT NOT NULL DEFAULT 'auto', -- auto | off
  theme TEXT NOT NULL DEFAULT 'system',     -- light | dark | system
  received_at TEXT NOT NULL,
  PRIMARY KEY (install_id, day)
);
CREATE INDEX IF NOT EXISTS pings_day ON pings (day);

CREATE TABLE IF NOT EXISTS installer_runs (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  platform TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS installer_runs_day ON installer_runs (day);

-- The maker's own installs (#982): they keep sending, so reports can be checked end to end, and queries.sql leaves
-- them out. Add one by hand (see README.md); the IDs live only here, never in the repo.
CREATE TABLE IF NOT EXISTS excluded (
  install_id TEXT NOT NULL PRIMARY KEY,
  note TEXT                       -- which computer
);
