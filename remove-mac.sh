#!/bin/bash
# Undoes install-mac.sh: Docket no longer starts at sign-in. The LaunchAgent file and the Docket.command shortcuts
# (in ~/Applications and on the desktop) go to the Trash.
# It does not stop a Docket that is running, and it deletes nothing in this folder.
set -euo pipefail
plist="$HOME/Library/LaunchAgents/local.docket.plist"
if [ -e "$plist" ]; then mv -f "$plist" "$HOME/.Trash/local.docket.plist"; fi
if [ -e "$HOME/Applications/Docket.command" ]; then mv -f "$HOME/Applications/Docket.command" "$HOME/.Trash/Docket.command"; fi
if [ -e "$HOME/Desktop/Docket.command" ]; then mv -f "$HOME/Desktop/Docket.command" "$HOME/.Trash/Docket (desktop).command"; fi
echo 'Docket will no longer start at sign-in, and its shortcuts are in the Trash.'
