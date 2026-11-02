# Docket

A page on your computer for starting, resuming and watching Claude Code sessions, so your work does not depend on the Claude desktop app. It runs on Windows 10 or 11 and on macOS.

## What you need

- **Node.js** 20 or newer (the LTS version from nodejs.org).
- **Git.**
- **Claude Code:** `npm install -g @anthropic-ai/claude-code`
- Optional: the **GitHub CLI** (`gh`) to show pull request status on sessions, and the **AWS CLI** for a desk that runs on Amazon Bedrock.

## Install on Windows

In PowerShell:

```powershell
git clone https://github.com/davidbrazelton/docket-public.git C:\Work\docket
cd C:\Work\docket
npm install
npx playwright install chromium
.\install-windows.ps1
```

`C:\Work\docket` is only a suggestion: any folder works. The `playwright` line installs the private browser sessions use.

`install-windows.ps1` makes Docket start by itself, with no window, when you sign in to Windows, and adds **Docket** to the Start menu, which opens it in its own window (starting it first if needed). Pin that Start menu entry to the taskbar rather than pinning the page in your browser: the page alone cannot start Docket after a restart.

- `.\install-windows.ps1 -ShortcutOnly`: only the Start menu and desktop shortcuts, no start at sign-in.
- `.\install-windows.ps1 -Desktop`: a **Start Docket** shortcut on the desktop as well.
- `.\remove-windows.ps1` undoes the install.

If Windows refuses to run the script because it came from the internet, run `Unblock-File .\install-windows.ps1` in the Docket folder and try again.

## Install on a Mac

Install Node.js, Git and Claude Code first, for example with Homebrew: `brew install node git gh`, then `npm install -g @anthropic-ai/claude-code`. Then in Terminal:

```bash
git clone https://github.com/davidbrazelton/docket-public.git ~/Work/docket
cd ~/Work/docket
npm install
npx playwright install chromium
./install-mac.sh
```

`install-mac.sh` makes Docket start by itself when you sign in to the Mac, adds `Docket.command` to `~/Applications` (it starts Docket if needed and opens it), and starts it now. Run it from a Terminal where `claude`, `git` and `node` work, since Docket uses that Terminal's PATH. `--shortcut-only` skips the start at sign-in; `./remove-mac.sh` undoes the install.

## First start

Docket opens at http://localhost:4400 (only this computer can open it). The first time, a **Set up Docket** window walks you through your first desk: a name, which AI it uses (Claude, Grok or Codex), its folders, and signing in. **☰ > Desks** adds more desks later.

## Start and stop

- **Start:** it starts at sign-in. Otherwise open **Docket** from the Start menu (on a Mac, `./start-docket.sh`). Without the install, double-click `start-docket.cmd` in the Docket folder.
- **Stop the app** (sessions keep working): `Stop-Process -Id (Get-NetTCPConnection -LocalPort 4400 -State Listen).OwningProcess`. On a Mac: `kill $(lsof -ti tcp:4400 -sTCP:LISTEN)`.
- **Stop the sessions too:** the same command with port 4410.

## Updates

Docket updates itself from this repo. Every 5 minutes it checks GitHub for new git commits on `master`; this repo is public, so no GitHub sign-in is needed. The first time an update arrives, a card in the lower-right corner asks how you want updates:

- **Automatic:** Docket pulls the update into its folder and restarts itself. Sessions keep working.
- **Manual:** it only says an update is waiting; **Update now** in the card or the ☰ menu takes it.

Change it any time in **☰ > Settings > Updates**. The ☰ menu shows the version and when it last checked. Docket never updates over your own changes: if you edit files in the Docket folder, it skips the update and the menu says why.

## License

MIT. See LICENSE and CONTRIBUTING.md.
