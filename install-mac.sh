#!/bin/bash
# Installs Docket on this Mac account, from this folder:
# - starts it with no window at sign-in (a launchd LaunchAgent in ~/Library/LaunchAgents; no admin needed),
# - adds Docket.command to ~/Applications (opens Docket, starting it first if needed),
# - and starts it now.
# --shortcut-only: does not start it at sign-in (and stops doing so, if it did: the LaunchAgent goes to the Trash);
#   adds Docket.command to ~/Applications and the desktop instead, each starting Docket if needed and opening it.
# --desktop: adds Docket.command to the desktop as well.
# --port N: the port Docket answers on, for a test copy; 4400 unless given.
# Docket's own banner and ☰ > Settings > Starting Docket run this script too, so the page and the script agree.
# Docket keeps running from this folder, so edits and pulls are taken in as before.
# Run it again any time the folder or node moves. remove-mac.sh undoes it; start-docket.sh opens it.
set -euo pipefail
folder="$(cd "$(dirname "$0")" && pwd)"
label="local.docket"
plist="$HOME/Library/LaunchAgents/$label.plist"
only=0; desktop=0; port=4400
while [ $# -gt 0 ]; do
  case "$1" in
    --shortcut-only) only=1; desktop=1 ;;
    --desktop) desktop=1 ;;
    --port) port="$2"; shift ;;
    *) echo "Unknown option $1. Use --shortcut-only, --desktop or --port N." >&2; exit 1 ;;
  esac
  shift
done

# Docket.command: Terminal runs it on a double-click. It runs this folder's start-docket.sh, which starts Docket
# if needed and opens the page.
q() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
command_file() {
  mkdir -p "$(dirname "$1")"
  { echo '#!/bin/bash'
    echo '# Opens Docket, starting it first if needed. Made by install-mac.sh; remove-mac.sh takes it away.'
    if [ "$port" != 4400 ]; then echo "export PORTAL_PORT=$port"; fi
    echo "exec $(q "$folder/start-docket.sh")"
  } > "$1"
  chmod +x "$1"
}
command_file "$HOME/Applications/Docket.command"
if [ "$desktop" = 1 ]; then command_file "$HOME/Desktop/Docket.command"; fi

if [ "$only" = 1 ]; then
  # A Docket already running keeps running; it just will not start at the next sign-in.
  if [ -e "$plist" ]; then mv -f "$plist" "$HOME/.Trash/$label.plist"; fi
  echo "Docket's shortcuts point at $folder. It does not start at sign-in; open Docket.command in ~/Applications or on the desktop, which starts it if needed."
  exit 0
fi

node="$(command -v node || true)"
if [ -z "$node" ]; then echo "node is not on the PATH. Install Node.js (for example brew install node) and run this again." >&2; exit 1; fi

# launchd starts programs with a bare PATH (/usr/bin:/bin:/usr/sbin:/sbin), which has none of claude, gh, git from
# Homebrew or npm. Docket gets the PATH this terminal has now, so it finds the same programs. DOCKET_GITHUB_USER
# (README: where updates come from) and AZURE_DEVOPS_EXT_PAT (the Azure DevOps token for the Tickets list; on
# Windows Docket reads it from the registry) are passed on too when they are set here.
esc() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
portenv=""; if [ "$port" != 4400 ]; then portenv="<key>PORTAL_PORT</key><string>$(esc "$port")</string>"; fi
mkdir -p "$HOME/Library/LaunchAgents"
# AbandonProcessGroup: the session runner Docket starts keeps working when the app stops, as on Windows.
cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array><string>$(esc "$node")</string><string>$(esc "$folder/supervisor.mjs")</string></array>
  <key>WorkingDirectory</key><string>$(esc "$folder")</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(esc "$PATH")</string>$portenv${DOCKET_GITHUB_USER:+<key>DOCKET_GITHUB_USER</key><string>$(esc "$DOCKET_GITHUB_USER")</string>}${AZURE_DEVOPS_EXT_PAT:+<key>AZURE_DEVOPS_EXT_PAT</key><string>$(esc "$AZURE_DEVOPS_EXT_PAT")</string>}${DOCKET_NO_USAGE:+<key>DOCKET_NO_USAGE</key><string>$(esc "$DOCKET_NO_USAGE")</string>}</dict>
  <key>RunAtLoad</key><true/>
  <key>AbandonProcessGroup</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>$(esc "$folder/portal.log")</string>
</dict>
</plist>
EOF
# The file may hold the Azure DevOps token, so only this account can read it.
chmod 600 "$plist"

# A Docket already running is left alone: the new file is read at the next sign-in. Otherwise it starts now,
# replacing a copy launchd still holds from before (a moved folder).
if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Docket installed from $folder. It is already running, and starts by itself at sign-in."
else
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  echo "Docket installed from $folder and started. It starts by itself at sign-in; open it with Docket.command in ~/Applications or http://localhost:$port."
fi

# One anonymous count of a finished install, carrying only the platform (README.md, "Usage stats"). Never stops or
# slows the install by more than a few seconds; DOCKET_NO_USAGE=1 skips it. Docket's own reruns of this script skip it.
[ -n "${DOCKET_RERUN:-}" ] || case "${DOCKET_NO_USAGE:-}" in
  ''|0|false|no|off) curl -s -m 5 -o /dev/null -X POST -H 'content-type: application/json' -d '{"platform":"mac"}' https://docket-usage.dbrazelton.workers.dev/v1/install || true ;;
esac
