# Docket

A page on your computer for starting, resuming and watching AI coding sessions, so your work does not depend on any one AI company's desktop app. It runs on Windows 10 or 11 and on macOS.

## Why Docket

Cursor, OpenCode and similar tools are AI coding agents: one person, one editor or terminal, one conversation at a time. Docket works one level above them. It doesn't replace your AI. It runs the AI tools you already use (Claude Code, Codex, Grok) and gives you one place to run all your work with them.

- **Every session in one place.** Dozens of sessions side by side, grouped by project, each marked with what it needs from you: a question, a merge, a problem. No more hunting through a pile of terminal windows.
- **Sessions that hand off work.** A session can start child sessions for separate pieces of a job, check what they did and close them when they're done. Each one runs on the model the work needs, so routine steps don't cost top-model prices.
- **A desk for each client or team.** Each desk has its own sign-in, memory, past sessions and billing. Work for one client never leaks into another, and reaching across desks always asks you first.
- **Work keeps going without you.** Schedules start sessions on a timetable, the autopilot answers routine questions under rules you set, and sessions keep running while Docket restarts or updates itself.
- **More than code.** Sessions get a private browser with your saved sign-ins, a Files list for the reports and exports they make, and links to GitHub, Jira and Azure DevOps.
- **Your computer, your accounts.** Docket runs on your own computer, and each desk bills to its own AI account.

### Docket next to Cursor and OpenCode

| | Docket | Cursor | OpenCode |
|---|---|---|---|
| **What it is** | A workspace for running many AI sessions | An AI code editor | An AI coding agent in the terminal |
| **Sessions at once** | Many, side by side, with parent and child sessions | Mostly one per window | One per terminal |
| **Separate clients** | One desk each, with its own sign-in, memory and billing | No | No |
| **Runs unattended** | Schedules and autopilot | Background agents | No |
| **Editing code by hand** | No, use your editor | Yes, a full editor | No |

They work well together: Docket runs and organizes the work, and you open the results in Cursor or any other editor when you want to edit by hand.

## What you need

- **Node.js** 20 or newer (the LTS version from nodejs.org), and **Git**. The Windows installer below brings its own of both.
- **At least one AI tool** from the table below.
- Optional: the **GitHub CLI** (`gh`) to show pull request status on sessions, and the **AWS CLI** for a desk that runs Claude through Amazon Bedrock.

### Supported AI tools

| AI tool | Made by | Install | Signs in with |
|---|---|---|---|
| Claude Code | Anthropic | `npm install -g @anthropic-ai/claude-code` | a Claude account, or Amazon Bedrock (your company's AWS account) |
| Codex | OpenAI | `npm install -g @openai/codex` (Windows also: `winget install -e --id OpenAI.Codex`) | a ChatGPT account (Plus, Pro, Business or Enterprise) |
| Grok | xAI | Mac: `curl -fsSL https://x.ai/cli/install.sh \| bash`<br>Windows: `irm https://x.ai/cli/install.ps1 \| iex` | a Grok account |

Each desk picks one or more of these, and each signs in on its own. Docket checks which tools are on the computer and shows how to install a missing one. Docket also recognizes an API key for each tool (Anthropic, OpenAI or xAI) set in that tool's own settings or in the desk's environment; the setup window does not ask for one.

### Connections (optional)

- **GitHub** (`gh`): pull request status on sessions.
- **Jira** and **Azure DevOps**: ticket and pull request status, for desks set up for them in ☰ > Desks.
- **AWS CLI**: only for a desk that runs Claude through Amazon Bedrock.

## Install on Windows the easy way

**[Download for Windows](https://github.com/davidbrazelton/docket-public/releases/latest/download/Docket-Setup.exe)** (Docket-Setup.exe, about 50 MB), then double-click it. It needs no admin rights and nothing installed beforehand: it carries its own Node.js and Git, downloads Docket into `%LOCALAPPDATA%\Programs\Docket`, makes it start when you sign in, adds **Docket** to the Start menu and opens it. The private browser sessions use downloads by itself in the background the first time Docket starts. You still need an AI tool (the table above); Docket shows how to install one.

The installer is not code-signed yet, so Windows may show a blue **Windows protected your PC** window: click **More info**, then **Run anyway**.

To remove it: **Settings > Apps > Installed apps > Docket > Uninstall**. That stops Docket and deletes its folder, with Docket's own settings and desk list. Each desk's own folders (its AI tool's sign-in and past sessions) are elsewhere and stay.

## Install on Windows from the terminal

If you already have Node.js and Git, or want Docket in a folder of your choice, in PowerShell:

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

Install Node.js, Git and at least one AI tool from the table above first, for example with Homebrew: `brew install node git gh`, then the AI tool's install line. Then in Terminal:

```bash
git clone https://github.com/davidbrazelton/docket-public.git ~/Work/docket
cd ~/Work/docket
npm install
npx playwright install chromium
./install-mac.sh
```

`install-mac.sh` makes Docket start by itself when you sign in to the Mac, adds `Docket.command` to `~/Applications` (it starts Docket if needed and opens it), and starts it now. Run it from a Terminal where `git`, `node` and your AI tools (`claude`, `codex`, `grok`) work, since Docket uses that Terminal's PATH. `--shortcut-only` skips the start at sign-in; `./remove-mac.sh` undoes the install.

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
