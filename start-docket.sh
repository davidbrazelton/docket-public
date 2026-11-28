#!/bin/bash
# Starts Docket with no window (if it is not running already) and opens it in the browser once it answers.
# Sessions run in the runner (runner.mjs), which keeps them working when the app stops.
# portal-events.log records every start, stop and crash with the reason.
set -uo pipefail
folder="$(cd "$(dirname "$0")" && pwd)"
port="${PORTAL_PORT:-4400}"
url="http://localhost:$port"
label="local.docket"

# Something holds the port but has not answered for 30 seconds: a frozen app (#1276). It is stopped, so Docket starts
# again below (or its supervisor starts it again first). Only what listens on this Docket's own port is stopped: never
# the session runner (its own port) or a test copy (another port). Any answer counts, even "not found" from an older app.
holder() { lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null; }
responds() { [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url/api/alive")" != 000 ]; }
if [ -n "$(holder)" ]; then
  ok=; until=$((SECONDS + 30))
  while [ "$SECONDS" -lt "$until" ]; do if responds; then ok=1; break; fi; sleep 1; done
  if [ -z "$ok" ]; then
    holder | xargs kill -9 2>/dev/null
    for _ in $(seq 1 40); do [ -z "$(holder)" ] && break; sleep 0.25; done
  fi
fi
if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  # Installed (install-mac.sh): launchd starts it, so it is the same Docket as at sign-in. Else it starts from here.
  if [ "$port" = 4400 ] && launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
    launchctl kickstart "gui/$(id -u)/$label"
  else
    (cd "$folder" && nohup node supervisor.mjs >/dev/null 2>>portal.log &)
  fi
fi
# Open the page only once Docket answers, so the browser never lands on a page that is not there yet.
for _ in $(seq 1 120); do curl -fs -o /dev/null --max-time 2 "$url/" && break; sleep 0.5; done
# In its own window, like an app, when the default browser is Chrome, Edge or Brave (--app). Any other
# (Safari, Firefox) gets a normal tab in that same browser, never a browser the person does not use.
# DOCKET_OPEN_PRINT=1 says what it would run instead (for tests).
default_browser() { # the bundle id set for https links, empty when none is set (Safari)
  plutil -convert json -o - "$HOME/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist" 2>/dev/null |
    tr '{}' '\n\n' | grep -i '"LSHandlerURLScheme":"https"' | grep -o '"LSHandlerRoleAll":"[^"]*"' | head -1 | cut -d'"' -f4
}
open_app() {
  local app=
  case "$(default_browser | tr '[:upper:]' '[:lower:]')" in
    com.google.chrome) app="Google Chrome" ;;
    com.microsoft.edgemac) app="Microsoft Edge" ;;
    com.brave.browser) app="Brave Browser" ;;
  esac
  if [ -n "$app" ]; then
    if [ "${DOCKET_OPEN_PRINT:-}" = 1 ]; then echo "open -na $app --args --app=$url"; else open -na "$app" --args --app="$url"; fi
  elif [ "${DOCKET_OPEN_PRINT:-}" = 1 ]; then echo "open $url"; else open "$url"; fi
}
if command -v open >/dev/null 2>&1 && [ "$(uname)" = Darwin ]; then open_app; else xdg-open "$url" >/dev/null 2>&1 || echo "$url"; fi
