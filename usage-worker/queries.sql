-- The launch questions (#848). Run one with:
--   npx wrangler d1 execute docket-usage --remote --command "<query>"
-- or all of them: npx wrangler d1 execute docket-usage --remote --file queries.sql
-- "Active" means the install sent a report that day. Days are UTC.

-- 1. Installs over time: finished installs per day, by platform.
SELECT day, platform, COUNT(*) AS installs FROM installer_runs GROUP BY day, platform ORDER BY day;

-- 2. Installs that reached a first start: installer runs, against installs that ever reported, by first day.
SELECT (SELECT COUNT(*) FROM installer_runs) AS installer_runs,
       (SELECT COUNT(DISTINCT install_id) FROM pings) AS installs_started;
SELECT first_seen AS day, COUNT(*) AS new_installs FROM (SELECT install_id, MIN(first_seen) AS first_seen FROM pings GROUP BY install_id) GROUP BY first_seen ORDER BY day;

-- 3. Daily, weekly and monthly active installs (as of today).
SELECT day, COUNT(*) AS daily_active FROM pings GROUP BY day ORDER BY day;
SELECT (SELECT COUNT(DISTINCT install_id) FROM pings WHERE day = date('now')) AS dau,
       (SELECT COUNT(DISTINCT install_id) FROM pings WHERE day > date('now', '-7 days')) AS wau,
       (SELECT COUNT(DISTINCT install_id) FROM pings WHERE day > date('now', '-30 days')) AS mau;

-- 4. Still in use after 7 and 30 days: of the installs old enough, the share that reported on or after that day.
WITH f AS (SELECT install_id, MIN(first_seen) AS first_seen FROM pings GROUP BY install_id)
SELECT
  (SELECT COUNT(*) FROM f WHERE first_seen <= date('now', '-7 days')) AS old_enough_7,
  (SELECT COUNT(*) FROM f WHERE first_seen <= date('now', '-7 days') AND EXISTS (SELECT 1 FROM pings p WHERE p.install_id = f.install_id AND p.day >= date(f.first_seen, '+7 days'))) AS kept_7,
  (SELECT COUNT(*) FROM f WHERE first_seen <= date('now', '-30 days')) AS old_enough_30,
  (SELECT COUNT(*) FROM f WHERE first_seen <= date('now', '-30 days') AND EXISTS (SELECT 1 FROM pings p WHERE p.install_id = f.install_id AND p.day >= date(f.first_seen, '+30 days'))) AS kept_30;

-- 5. Install count by version and platform (each install's latest report in the last 30 days).
WITH latest AS (SELECT * FROM pings p WHERE day > date('now', '-30 days') AND day = (SELECT MAX(day) FROM pings q WHERE q.install_id = p.install_id))
SELECT version, platform, COUNT(*) AS installs FROM latest GROUP BY version, platform ORDER BY installs DESC;

-- 6. Sessions started by brand, per day.
SELECT day, SUM(sessions_claude) AS claude, SUM(sessions_codex) AS codex, SUM(sessions_grok) AS grok,
       SUM(children) AS child_sessions, SUM(shift_sessions) AS shift_sessions
FROM pings GROUP BY day ORDER BY day;

-- 7. Average groups and desks per install (latest report in the last 30 days).
WITH latest AS (SELECT * FROM pings p WHERE day > date('now', '-30 days') AND day = (SELECT MAX(day) FROM pings q WHERE q.install_id = p.install_id))
SELECT COUNT(*) AS installs, ROUND(AVG(groups_count), 1) AS avg_groups, ROUND(AVG(desks), 1) AS avg_desks,
       ROUND(AVG(desks_claude), 1) AS avg_claude_desks, ROUND(AVG(desks_codex), 1) AS avg_codex_desks, ROUND(AVG(desks_grok), 1) AS avg_grok_desks,
       ROUND(AVG(schedules), 1) AS avg_schedules
FROM latest;

-- 8. How much each switch and feature is used: of installs active in the last 30 days, how many used it at least once
--    (counts) or have it on in their latest report (settings).
WITH recent AS (SELECT * FROM pings WHERE day > date('now', '-30 days')),
latest AS (SELECT * FROM recent p WHERE day = (SELECT MAX(day) FROM recent q WHERE q.install_id = p.install_id))
SELECT
  (SELECT COUNT(DISTINCT install_id) FROM recent) AS active_installs,
  (SELECT COUNT(DISTINCT install_id) FROM recent WHERE shift_sessions > 0) AS used_shift,
  (SELECT COUNT(DISTINCT install_id) FROM recent WHERE gears <> '{}') AS shifted_gears,
  (SELECT COUNT(DISTINCT install_id) FROM recent WHERE plans > 0) AS used_plans,
  (SELECT COUNT(DISTINCT install_id) FROM recent WHERE children > 0) AS used_child_sessions,
  (SELECT COUNT(DISTINCT install_id) FROM recent WHERE ask > 0) AS used_ask_desk,
  (SELECT COUNT(DISTINCT install_id) FROM recent WHERE handoff > 0) AS used_desk_handoff,
  (SELECT COUNT(DISTINCT install_id) FROM recent WHERE pages_usage > 0) AS opened_usage_page,
  (SELECT COUNT(DISTINCT install_id) FROM recent WHERE pages_plans > 0) AS opened_plans_page,
  (SELECT COUNT(*) FROM latest WHERE schedules > 0) AS have_schedules,
  (SELECT COUNT(*) FROM latest WHERE remote_desks > 0) AS have_remote_desks,
  (SELECT COUNT(*) FROM latest WHERE remote_control = 1) AS remote_control_on,
  (SELECT COUNT(*) FROM latest WHERE signin_desks > 0) AS have_browser_signins,
  (SELECT COUNT(*) FROM latest WHERE update_mode = 'off') AS updates_off,
  (SELECT COUNT(*) FROM latest WHERE theme = 'dark') AS theme_dark,
  (SELECT COUNT(*) FROM latest WHERE theme = 'light') AS theme_light;

-- 8b. Shifts by gear (last 30 days).
SELECT j.key AS gear, SUM(j.value) AS shifts FROM pings, json_each(pings.gears) j WHERE day > date('now', '-30 days') GROUP BY j.key ORDER BY shifts DESC;
