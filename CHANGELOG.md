# Changelog

What changed in each version of Docket, newest first.

## 1.278.0 (2026-11-27)

- Auto mode refusals: row tag, Allow with the exact rule, and a Docket-problem hint (v1.278.0)

## 1.277.1 (2026-11-27)

- Private browser output outside Docket's data folder, so Auto mode stops denying snapshots (v1.277.1)

## 1.277.0 (2026-11-25)

- Plan section also shows in sub-sessions of a plan's task sessions and coordinator (v1.277.0)

## 1.276.0 (2026-11-25)

- Docket starts itself again: supervisor restart and rollback, frozen-app watchdog, runner backstop (v1.276.0)

## 1.275.1 (2026-11-25)

- State writes survive a briefly locked file (v1.275.1)

## 1.275.0 (2026-11-25)

- Page says when Docket isn't answering, and a docket:// Start Docket button (v1.275.0)

## 1.274.0 (2026-11-25)

- Code hosts: detect a desk's Azure DevOps / GitHub and offer to connect them (v1.274.0)

## 1.273.0 (2026-11-25)

- Docket passes Auto mode settings and allows its session tools (v1.273.0)
- Menus: one level per menu, level headings, per-desk chime, session mute on the server (v1.273.0)

## 1.272.4 (2026-11-25)

- Session list hover cards: the menus' frame (v1.272.4)

## 1.272.3 (2026-11-25)

- A quiet background job stays under Tasks running after 15 minutes (v1.272.3)

## 1.272.2 (2026-11-25)

- Read aloud: stale-line fixes on by default (v1.272.2)

## 1.272.1 (2026-11-25)

- Read aloud: a sign-in is said at once and never after it is done (v1.272.1)

## 1.272.0 (2026-11-25)

- Group headers: status count badges; schedules count once in waiting totals (v1.272.0)

## 1.271.1 (2026-11-25)

- Queue mode: battery default 3, 1 on Best power efficiency (v1.271.1)

## 1.271.0 (2026-11-25)

- Sign-in needs chime, notify, show a status and are read aloud (v1.271.0)

## 1.270.1 (2026-11-25)

- Read aloud keeps the speakers awake so the first sound and words after a gap are not clipped (v1.270.1)

## 1.270.0 (2026-11-24)

- Setup check card comes back by itself after a cleanup; deny-hidden connectors count as 0 (v1.270.0)

## 1.269.1 (2026-11-24)

- Pre-allow Docket's label tools so Auto mode stops denying them (v1.269.1)
- Question forms come after a written reply, not instead of it (v1.269.1)

## 1.269.0 (2026-11-24)

- Optional environment guard at desk setup: test-env writes ask, production blocked (v1.269.0)
- Desk check flags skills and plugins that write into.claude; setup backups leave the Claude home (v1.269.0)
- Settings-change card: a session proposes a settings diff, the user clicks Apply (v1.269.0)

## 1.268.0 (2026-11-24)

- Claude Code's terminal menus (/permissions, /model, /mcp…) open Docket's own views (v1.268.0)
- Show refused tool calls in the chat: Auto mode, settings rules, prompts, hooks (v1.268.0)

## 1.266.0 (2026-11-24)

- Gauges: Docket's figure over the computer's total, stacked, amber when either is high (v1.266.0)
- Talk: hands-free listening with a wake word per computer, experimental (v1.266.0)

## 1.265.0 (2026-11-24)

- Read aloud: Sound and microphone help gets a Speakers part (test tone, output picker, can't-hear checklist) (v1.265.0)

## 1.264.0 (2026-11-24)

- Talk: explain microphone errors and add a Microphone help dialog (v1.264.0)

## 1.263.1 (2026-11-23)

- Children inherit their parent's permission mode; server-started sessions follow the desk's Auto default (v1.263.1)

## 1.263.0 (2026-11-23)

- Vanilla desk: bare, clean sessions in any brand to diagnose issues (v1.263.0)
- One Terminal button: pick the session's or desk's folder in its menu (v1.263.0)

## 1.262.2 (2026-11-23)

- Read aloud: no pause between a session's title and what happened (v1.262.2)

## 1.262.1 (2026-11-23)

- Put the daily-limit tip on the autopilot cap input (v1.262.1)

## 1.262.0 (2026-11-23)

- Offer Auto when a hook blocks a Bypass permissions session, and start the desk's new sessions in Auto (v1.262.0)

## 1.261.0 (2026-11-23)

- Show what Claude Code hooks block or fail in the session's chat (v1.261.0)

## 1.260.0 (2026-11-23)

- Re-ask for a lost reply as soon as the turn ends (v1.260.0)

## 1.259.0 (2026-11-22)

- Autopilot learns from items the person answered first: shadow suggestions (v1.259.0)

## 1.258.0 (2026-11-22)

- Autopilot: question forms wait for the person by default (v1.258.0)

## 1.257.0 (2026-11-22)

- Turn claude.ai connectors on and off per desk, built in (v1.257.0)
- Autopilot: cut run cost: bigger batches, a lean run start, a daily limit per desk (v1.257.0)
- Talk mode: tip when a read-back is cut short, "read back" and "catch me up" (v1.257.0)
- Autopilot: score question forms per question, leave typed answers out (v1.257.0)

## 1.256.1 (2026-11-22)

- Thin-reply check fires again for a reply lost before mark_turn (v1.256.1)

## 1.256.0 (2026-11-21)

- Talk mode: choose how much a spoken message is read back (v1.256.0)

## 1.255.0 (2026-11-20)

- One menu style: six more menus like the Talk menu (v1.255.0)

## 1.254.0 (2026-11-20)

- 👁 View menu in the Talk menu's style: ✓ rows, headings, rules (v1.254.0)

## 1.253.1 (2026-11-20)

- PR ownership: a branch only made isn't the session's; Read aloud says merge only when asked (v1.253.1)

## 1.253.0 (2026-11-20)

- Read aloud: Off is truly silent, Sounds in Help > Key, a timing log, and stale-line fixes behind a setting (v1.253.0)

## 1.252.1 (2026-11-20)

- Desk tabs: Off shows no counts, Counts uses badges (v1.252.1)

## 1.252.0 (2026-11-20)

- Read aloud silent while the screen is locked, Windows and Mac (v1.252.0)

## 1.251.1 (2026-11-20)

- Tips test: rd-setup button tip as a template literal (v1.251.1)

## 1.251.0 (2026-11-20)

- Onboarding: talk & display steps in the setup wizard; one What's new and suggestions list replaces the corner cards (v1.251.0)

## 1.249.0 (2026-11-20)

- Talk and read aloud: one setup card in the standard notice style, download ring in the top bar (v1.249.0)

## 1.248.2 (2026-11-20)

- Install pages: pick-your-version cards, Labs in purple (v1.248.2)

## 1.248.0 (2026-11-20)

- Talk mode: a speech queue so Read aloud never cuts itself off (v1.248.0)

## 1.247.0 (2026-11-20)

- What's new card; first entry: talk mode with a voice sample and one-click natural voice

## 1.246.0 (2026-11-20)

- Two public copies: local-first Docket and experimental Docket Labs, with a one-time choice and Share

## 1.245.1 (2026-11-20)

- Thin-reply flag: only a narration after the last working tool counts (v1.245.1)

## 1.245.0 (2026-11-20)

- Talk mode: natural local voice for Read aloud (Kokoro in a worker)

## 1.244.0 (2026-11-20)

- Talk mode × autopilot: voice engage, its report, next waiting skips its items

## 1.243.0 (2026-11-20)

- Talk mode hybrid, Read aloud dial, what is talking, 🎙▾ in Docket's look

## 1.242.1 (2026-11-20)

- Drop the automatic 'Updating Docket…' note under the update arrow

## 1.242.0 (2026-11-20)

- Talk mode: Listen/Read aloud switches, in the typing box, multi-step plans

## 1.241.0 (2026-11-19)

- Activity view: footer and desk tabs set separately, any combination

## 1.240.0 (2026-11-19)

- Sessions stop restating open questions

## 1.239.0 (2026-11-19)

- Activity view option: sparkline, counts or both, in the footer or on the desk tabs
- One live card per question in the chat; references as chips

## 1.238.2 (2026-11-19)

- Working count on the open desk's tab too
- Change log leaves out titles the private-names guard refuses, in the build

## 1.238.1 (2026-11-19)

- Typed answers: lowercase q, and/&, shared answers, not quarters

## 1.238.0 (2026-11-19)

- Change log for the public copy: CHANGELOG.md from merged pull requests, and in the release notes

## 1.237.0 (2026-11-19)

- Pause one session from its menu

## 1.236.0 (2026-11-19)

- Load monitor suggests queue mode under strain; queue mode on automatically on battery

## 1.235.0 (2026-11-19)

- Show the shortcut keys on their own line in every tooltip
- Rest idle sessions sooner on battery

## 1.234.0 (2026-11-19)

- Keep docket-public history-free: one fresh commit per publish, and updates that accept it
- Queue mode: at most N sessions working at once

## 1.233.0 (2026-11-19)

- Show the power mode on battery, and hint when it is Best power efficiency

## 1.232.2 (2026-11-19)

- Leave perf samples that overlap sleep or standby out of the lag figures
- Stop the app starting the session runner again when its own event loop stalls

## 1.232.1 (2026-11-19)

- Replace employer identifiers with placeholders and guard against them

## 1.232.0 (2026-11-19)

- Explain more and a side chat on every question, with a model picker and usage stats

## 1.231.2 (2026-11-19)

- Stop commits that rewrite line endings by accident

## 1.231.1 (2026-11-19)

- Opt Docket out of Windows power throttling on battery

## 1.230.0 (2026-11-19)

- Talk mode, stage 1: push-to-talk, local speech-to-text, spoken commands and read-back

## 1.228.0 (2026-11-19)

- Keyboard shortcuts: one keymap, a command palette, and the list in Help

## 1.227.2 (2026-11-19)

- Plan decisions: hide answered ones behind a ✓ Answered filter

## 1.227.1 (2026-11-19)

- Answers by number close their questions as soon as they are sent

## 1.226.1 (2026-11-19)

- Session list scrolls while a session or group is dragged

## 1.226.0 (2026-11-19)

- Keep short child tasks in the parent; weekly short-child share

## 1.225.0 (2026-11-19)

- start_session no_plan: a session can say its child sessions need no plan

## 1.224.1 (2026-11-19)

- Plan 👁 View menu shows in full, above every panel

## 1.224.0 (2026-11-19)

- Spend by step: which tools and commands cost the most
- Edit a suggested session's brief before it starts

## 1.220.0 (2026-11-18)

- Start at sign-in from a scheduled task, wait for the network, and a standby page

## 1.219.1 (2026-11-17)

- Redraws never clobber an edit in progress: one edit hold

## 1.219.0 (2026-11-16)

- plan_update_task can replace a task's brief

## 1.217.2 (2026-11-15)

- Load report_progress up front so Claude sessions actually call it

## 1.217.0 (2026-11-14)

- Sessions report a rough progress estimate, shown muted in the plan column

## 1.216.0 (2026-11-14)

- Check for updates shows that click's result; up to date says when not running yet

## 1.215.0 (2026-11-14)

- Feedback through a rate-limited relay, no key handed out

## 1.213.0 (2026-11-14)

- One look across Docket: Tint everywhere, a stripe only on cards waiting on you

## 1.212.1 (2026-11-14)

- Parent cost tooltip gives both its own and its family's figure

## 1.212.0 (2026-11-14)

- Chat cards: one shape, Tint, with a stripe only on cards waiting on you

## 1.211.0 (2026-11-14)

- Autopilot answers stand out on cards, with the pilot's reason

## 1.210.0 (2026-11-14)

- One Waiting on you list beside the typing box; a stated rule for where cards go
- Files list: sort control in its header, last edited first by default

## 1.209.0 (2026-11-14)

- Detect oversized instruction files that cause Prompt-is-too-long on resume
- Desk tabs: show how many sessions are working
- Welcome-back card: nudge Summary on sessions you have been away from

## 1.208.0 (2026-11-13)

- Preview Excel workbooks (.xlsx,.xls,.xlsm) in Docket, no Office needed
- Open in Google Sheets on a spreadsheet's menu and the preview
- Sign-in needs: several sites per session; Done clears only what was signed in to

## 1.207.1 (2026-11-12)

- Each Qn line its own question, even with no blank line between

## 1.207.0 (2026-11-12)

- Autopilot: Suggest keeps what it learned; Train starts it over after a warning
- Restart Docket starts everything fresh: new supervisor, environment read again

## 1.206.1 (2026-11-12)

- Session list keeps its scroll position per desk
- Only questions that ask open as questions, not mentions

## 1.206.0 (2026-11-12)

- Quit Docket in the ☰ menu

## 1.205.1 (2026-11-12)

- Sign-in Done tells the waiting sessions to carry on
- Merge card shows while the pull request's checks still run

## 1.205.0 (2026-11-12)

- Plan section: one "Next for you" list; coordinator questions show in it

## 1.204.1 (2026-11-12)

- Done decision tasks no longer show as waiting on you

## 1.204.0 (2026-11-12)

- Private browser sign-in: Sign in card in the chat, row mark, globe blinks for any waiting session
- Numbered questions stand out: chat highlight, open-questions tray, count on the row tag

## 1.203.2 (2026-11-12)

- Reply before a question form stays a reply, not narration

## 1.203.1 (2026-11-12)

- Archived sessions' open cards: settled on archive, left out of waiting, warned about

## 1.203.0 (2026-11-12)

- Usage counter leaves the maker's own installs out of the numbers
- Autopilot tab on each desk: runs by day, Suggest/Answer per kind, offer to engage

## 1.202.0 (2026-11-12)

- AI Usage: Docket's own side calls as rows, and a Docket overhead card
- Autopilot per desk: enable in Settings, engage each desk from 🤖, no Autopilot desk

## 1.201.0 (2026-11-12)

- AI Usage measures autopilot: its own cause, cost card, per desk and day

## 1.200.0 (2026-11-12)

- ✦ keeps sessions that coordinate an unfinished plan

## 1.199.4 (2026-11-12)

- Idle sessions keep their last turn's end after an app restart
- Keep question form answers across a reload, and let filling one in hold an update

## 1.199.3 (2026-11-12)

- Skip off-screen chat items, cache rendered replies

## 1.199.2 (2026-11-11)

- Typing holds a restart or update for 15 minutes at most, only keystrokes count

## 1.199.1 (2026-11-11)

- Send each page only its open session's chat, and coalesce session pushes
- Hide the feedback button when FEEDBACK_ON is false

## 1.199.0 (2026-11-11)

- Restart a session when its Docket tool list changes, and Refresh in the session menu

## 1.198.0 (2026-11-11)

- Desk daily budget stops new turns: pause and ask to go on

## 1.197.2 (2026-11-11)

- Keep group collapse state per desk

## 1.197.1 (2026-11-11)

- Chat append marks only the latest turn

## 1.197.0 (2026-11-11)

- Plan decisions answered in the chat, saved on the plan
- Performance sampler and ☰ > Gauges > Performance

## 1.196.3 (2026-11-11)

- Autopilot never wipes or answers over a question form you are filling in

## 1.196.2 (2026-11-11)

- Merge card: a conflicting pull request is caught, not silently hidden
- List redraw: once per frame, only changed rows, no forced layout

## 1.196.1 (2026-11-11)

- Streamed replies: once per frame, re-parse only the open tail
- App update no longer waits on sessions only waiting for the person

## 1.196.0 (2026-11-11)

- Plan section stays in a task session's details after its task is done

## 1.195.1 (2026-11-11)

- CPU gauge: per-program differences, no false 100%

## 1.195.0 (2026-11-11)

- Acknowledge every click at once: controls grey out the moment they are pressed
- Number questions to the user across the whole session (Q1, Q2…), counted by Docket

## 1.194.1 (2026-11-11)

- Full test suite passes: no usage window over the menus test, lighter test Dockets

## 1.194.0 (2026-11-11)

- Autopilot: each desk's own brand, billed there

## 1.193.1 (2026-11-11)

- Chat stop button gets the filter-on tint

## 1.193.0 (2026-11-11)

- Autopilot: a head start from past sessions
- Summary checks stale facts first, with per-desk stats and a tuning offer

## 1.192.0 (2026-11-11)

- Autopilot learns first: it suggests, watches your answers, then offers "I got this"

## 1.191.0 (2026-11-11)

- Autopilot: top model, a simpler panel without flicker, runs kept a week, what it is doing shown on the desk, top bar and chat
- Anonymous usage stats: daily counts to Docket's own counter, asked first

## 1.190.2 (2026-11-11)

- Rename ☰ > Docket settings > Profile to Setup

## 1.190.1 (2026-11-11)

- Drop the per-desk Desk settings item; point its mentions to Manage

## 1.190.0 (2026-11-10)

- Cross-desk handoff: live card in the sending chat, badge on the other desk, opt-in report back

## 1.189.0 (2026-11-10)

- Install page: the screenshot shows a Plan, and Why Docket mentions plans
- Install page: a screenshot of Docket and the app icon
- Install page leads with Why Docket before the install steps
- Plan panel: a key for the step icons, and status-first row tooltips

## 1.188.1 (2026-11-10)

- Public README: install links right under the opening paragraph
- Child session that opened a pull request owns the merge ask; parent links to it

## 1.188.0 (2026-11-10)

- Plans keep moving: nudge stalled coordinators, catch orphaned tasks, show stalled plans, Pause plan

## 1.187.0 (2026-11-10)

- Chat controls inside the message box: + / Stop / Send as icon buttons

## 1.186.0 (2026-11-10)

- Autopilot desk is special: robot icon, first, locked down, one switch sets it up, asks for screen control

## 1.185.0 (2026-11-10)

- Autopilot runs: choose the pilot's brand and gear, short runs instead of one long session

## 1.184.1 (2026-11-10)

- ☰ > Desks marks the desk you are on in the navbar's color

## 1.184.0 (2026-11-10)

- ☰ menu: Docket settings apart from each desk's own, color squares, same-size icons

## 1.183.0 (2026-11-10)

- Autopilot: the pilot is its own desk, and only a session of that desk can be the pilot

## 1.182.1 (2026-11-10)

- Plan rules: fewer user steps, start everything free, gather decisions

## 1.182.0 (2026-11-10)

- Plan panel redesign: one-line rows, plan order, Done toggle, chains, 👁 view menu

## 1.181.0 (2026-11-10)

- Plans: phases as sections the plan defines

## 1.180.1 (2026-11-10)

- Fold long briefs on desk handovers, fresh starts and Docket-started sessions

## 1.180.0 (2026-11-10)

- Plan switch: convert one project, report missing claims, find unclaimed plan files

## 1.179.0 (2026-11-10)

- Conversion makes one plan per file, in a session per file
- Flag a reply whose answer was saved only as a short or empty narration block

## 1.178.1 (2026-11-10)

- mark_turn: closing tools before the final reply; name label, accept state

## 1.178.0 (2026-11-10)

- start_session: start a session in another group when asked

## 1.177.0 (2026-11-09)

- Question forms setting: Never / Default / Often, with a one-time card

## 1.176.0 (2026-11-09)

- One-click Merge card under a plain merge ask

## 1.175.0 (2026-11-09)

- Learn how long steps take per repo and show the usual time
- Summary: heading, numbered questions, and a question form

## 1.174.0 (2026-11-09)

- Session list: tree rail to set families apart

## 1.173.0 (2026-11-09)

- Plan badge hover: show the full task breakdown

## 1.172.2 (2026-11-09)

- Show reply text written before a tool call

## 1.172.1 (2026-11-09)

- Close the plan-offer card once the session has a plan

## 1.172.0 (2026-11-09)

- Profile export/import, and keeping it in your own cloud folder

## 1.171.0 (2026-11-09)

- Updates: always automatic, and a down arrow in the top bar

## 1.170.1 (2026-11-09)

- Public README: a Why Docket section, with Docket next to Cursor and OpenCode
- Card strip: list cards waiting in sessions under the open one

## 1.169.0 (2026-11-09)

- Card strip in the primary color, and a 'card' reason in the session list

## 1.168.0 (2026-11-09)

- Autopilot: a pilot session answers what waits on the person, under rules

## 1.166.0 (2026-11-09)

- Optional cost in the session list: per session or family, group totals, Today or Ever

## 1.165.1 (2026-11-09)

- Activity footer: one line with spend, drop pieces as the list narrows, ⋯ menu
- Make menus and popups stand off the page, especially in dark mode

## 1.165.0 (2026-11-09)

- Split work by how long it takes, reuse children, slim child start

## 1.164.0 (2026-11-09)

- Show what starting sessions costs, and offer turning splitting off

## 1.163.0 (2026-11-09)

- Parent may start a child on a lower gear, then checks its result harder
- Session activity: counts by state, footer sparkline, Usage › Activity, one-time rebuild
- Memory and disk: breakdown by session, what they share, and test copies and leftovers

## 1.162.2 (2026-11-09)

- Say merge only for pull requests the session made or pushed to

## 1.162.1 (2026-11-09)

- Keep a turn's final reply open when bookkeeping steps follow it

## 1.162.0 (2026-11-09)

- Log turn timings and report where slowness comes from

## 1.161.1 (2026-11-07)

- Lower-right cards stack instead of overlapping

## 1.161.0 (2026-11-07)

- Replace the cache-expiring toast with a solid time pill in the session list

## 1.160.0 (2026-11-07)

- Show costs in the session Timeline

## 1.159.2 (2026-11-07)

- Mark unread brings back the session's reason tag

## 1.159.1 (2026-11-07)

- Keep the globe's sign-in blink through restarts, rest and reloads

## 1.159.0 (2026-11-07)

- Codex and Grok status icons say who is signed in, and the plan

## 1.158.0 (2026-11-07)

- Pin cards waiting on you in a strip above the chat

## 1.157.2 (2026-11-07)

- A turn that only started a child shows the ring, not the orange dot

## 1.157.0 (2026-11-07)

- Move sessions' records to another desk
- Feedback button: speech bubble, files straight to GitHub, daily limit per install

## 1.156.3 (2026-11-06)

- New since you last looked: show the line on a first visit to an unread session

## 1.156.2 (2026-11-06)

- Research: do concurrent sessions slow each other down?
- Heal a session whose first start never reached Claude Code

## 1.156.1 (2026-11-06)

- No green done while things are left for the user

## 1.156.0 (2026-11-06)

- Share one Playwright MCP server per desk instead of one per session
- Restart Docket in the ☰ menu

## 1.155.0 (2026-11-06)

- Setup check: measure what each desk's sessions load at start, and offer a session to slim it

## 1.154.0 (2026-11-06)

- Share one mcp-atlassian server per sign-in instead of one per session

## 1.153.1 (2026-11-06)

- A parent's done to a child already ready to close is a note, not a turn

## 1.153.0 (2026-11-06)

- Cheaper compactions and idle caches: priced compactions, terse PreCompact summary, keep-warm for idle sessions

## 1.152.0 (2026-11-06)

- Docket does the checks: wait_until tool and a state line on notes
- Keep big tool output on disk: head, tail and a path

## 1.151.0 (2026-11-06)

- Step times: show the time hooks hold a turn up

## 1.150.2 (2026-11-06)

- Runner: no stray node.exe windows, and leftover runners stop by themselves

## 1.150.1 (2026-11-06)

- Trim the session-coordination rules and the session-report boilerplate

## 1.150.0 (2026-11-06)

- Child reports that are only news no longer wake the parent; keep a waiting parent's cache warm

## 1.149.0 (2026-11-06)

- Chat: the session's state moves from the header to the line under the message box

## 1.148.0 (2026-11-06)

- Summary button: built-in wrap-up prompt, Top or Deep
- Chat: fold a message from another session to one line
- A turn marked done: ready-to-close sentence in a green band, green Done line
- Usage rows: a Cause column, and the coordination cost on the Usage page

## 1.147.1 (2026-11-06)

- gh account note only in folders whose origin is on GitHub

## 1.147.0 (2026-11-06)

- Reason tags: Icon as session dot, with a one-time offer card
- Resume sessions by themselves after a desk signs in again
- Chat: when steps finished and how long they took, plus times on notes and replies

## 1.146.2 (2026-11-06)

- Coordinator's view of its sessions matches the session list

## 1.146.1 (2026-11-06)

- AWS sign-in: a slow check is unknown, not signed out; wait 90s for the link
- Held turn: a job's sign of life is its own, and a turn marked done reports

## 1.146.0 (2026-11-05)

- View > Chat: checkmarks for what shows, with presets from Everything to Replies only

## 1.145.0 (2026-11-05)

- Chat: show messages from another session apart from the person's own

## 1.144.0 (2026-11-05)

- Chat: mute narration and add a Group view that folds it with the steps

## 1.143.0 (2026-11-05)

- Warn and offer a guided conversion when a desk switches plan system
- Fold session-report messages in the chat like background steps

## 1.142.3 (2026-11-05)

- Session hover card: off by default, and steady while the list redraws

## 1.142.2 (2026-11-05)

- Usage: label the added-up chart's tooltip as a running total

## 1.142.1 (2026-11-05)

- Parent shows done after closing its last child; last reply never folded

## 1.142.0 (2026-11-05)

- Group background steps and Icons reason tags by default, and a tighter chat

## 1.141.0 (2026-11-05)

- Hover card on session rows: full title and every detail, in the View menu

## 1.140.1 (2026-11-05)

- ✦ Needs attention: stop drawing kept rows faded

## 1.140.0 (2026-11-05)

- Reason tags: Words / Icons / Off in the view menu, plan badge column, calmer row colors
- View menu in the session menu: Hide / Group / Line / Expand for background steps

## 1.139.0 (2026-11-05)

- One ✦ control with its Keep period, and one look for links, actions and filters

## 1.138.1 (2026-11-05)

- Handoff: move the old session's plans and held tasks to the new one

## 1.138.0 (2026-11-05)

- Setting to show or hide the row reason tags, off by default

## 1.137.0 (2026-11-04)

- Chat: New since you last looked line, Jump to new, fold quiet turns
- Blink the globe yellow when the open session needs a private browser sign-in

## 1.136.1 (2026-11-04)

- Top bar fits at phone width

## 1.136.0 (2026-11-04)

- Needs-you dots: one question, one dot, and say why each row needs you

## 1.135.1 (2026-11-04)

- Plans: clicking a claimed task row opens the session that holds it

## 1.135.0 (2026-11-04)

- Plans: the coordinator can correct a task wrongly marked done

## 1.134.1 (2026-11-04)

- Handoff: move the old session's child sessions to the new one

## 1.134.0 (2026-11-04)

- Plans: one-time nudge to review each plan against new rules

## 1.133.0 (2026-11-04)

- Keep a plan's coordinator on the top gear

## 1.132.0 (2026-11-04)

- Plans: the user's steps, and tasks waiting outside Docket

## 1.131.0 (2026-11-04)

- Plans: the coordinator can change the plan's goal

## 1.130.0 (2026-11-04)

- Plan rules reach a session before it starts its second child session

## 1.129.2 (2026-11-04)

- Plan 'done since' shows when a task was set done, and who did a coordinator's own task

## 1.129.1 (2026-11-04)

- Pause all: stop a turn a background command starts during the pause
- A full list reload no longer puts a finished session back on running

## 1.129.0 (2026-11-04)

- Parent waiting on child sessions: still blue ring, orange only when it matters

## 1.128.1 (2026-11-04)

- Opening a session no longer waits for the whole list to be rebuilt

## 1.128.0 (2026-11-04)

- Show a yellow "?" badge while a session waits on a prompt

## 1.127.1 (2026-11-04)

- Links: a folder's branch counts only where the session did branch work

## 1.127.0 (2026-11-04)

- Plan task names follow the tree, every new task has a kind, dropped tasks

## 1.126.0 (2026-11-04)

- Plans keep moving past the wake limit
- New desks start Shift sessions on the top gear, not the lowest

## 1.125.2 (2026-11-03)

- List bar: Keep and ✦ at the right; ✦ and Keep tips as bullets

## 1.125.1 (2026-11-03)

- Keep an unread session orange when the page opens it by itself
- List bar: Keep dropdown only while ✦ is on, labelled, beside ✦
- Hover tip for the Start folder button under Group

## 1.125.0 (2026-11-03)

- Remove the folder guessing: move card and Work in chip
- Details: show the group's start folder under Group

## 1.124.0 (2026-11-03)

- Desk check: a per-desk report of setup problems, each with its fix

## 1.123.1 (2026-11-03)

- ✦ dropdown on the Order line, touch times filled in once, list settings per desk

## 1.123.0 (2026-11-03)

- Needs attention: keep recently touched sessions, pins, and whole families

## 1.122.0 (2026-11-03)

- Hide a desk without removing it; fold each desk on the Desks screen

## 1.121.0 (2026-11-03)

- Pop out a session into its own window

## 1.120.1 (2026-11-02)

- Copied groups accept delete, rename, folder, archive and restore

## 1.120.0 (2026-11-02)

- Rest idle sessions: release their process tree after an hour

## 1.119.1 (2026-11-02)

- Keep a file's artifact link when a session publishes it with its own Artifact tool

## 1.119.0 (2026-11-02)

- Plans on by default, carried only by sessions that use one

## 1.118.0 (2026-11-02)

- Artifact tool in Docket Claude sessions, with Publish as artifact on the Files list
- Orange needs-you dot for sessions Claude Desktop ran

## 1.117.3 (2026-11-02)

- Menus and dropdowns stay open while session updates arrive

## 1.117.2 (2026-11-02)

- Drop targets: only the one under the pointer gets the full highlight
- Inspector Plugin sources: Browse button, uncut help text, accurate wording

## 1.117.1 (2026-11-02)

- Sessions stopped by an error stay in Needs you

## 1.117.0 (2026-11-02)

- Drag a session to another group or under another session

## 1.116.0 (2026-11-02)

- Fewer repeat beeps: one per session family, a quiet window, one page plays it
- Details panel cost: agent time and your time beside cost

## 1.115.0 (2026-11-02)

- Plugin sources: install plugins from any git host or a folder, per desk

## 1.114.3 (2026-11-02)

- Config reload: ignore marketplace and plugin timestamps

## 1.114.2 (2026-11-02)

- Public install page on GitHub Pages
- Hide the feedback button until launch
- Brand-neutral wording: say the AI where text meant any brand

## 1.114.1 (2026-11-02)

- Installer build: look up the newest MinGit signed in

## 1.114.0 (2026-11-02)

- Reload a running session when its Claude config changes

## 1.113.1 (2026-11-02)

- Installer build: full output path, so the release step finds Docket-Setup.exe

## 1.113.0 (2026-11-02)

- Read-only plan folder: setting, reader, Plan section and Plan tree

## 1.111.0 (2026-11-02)

- Feedback button: anyone using Docket can suggest a feature
- Plan system setting, wizard step and one-time card

## 1.110.0 (2026-11-02)

- Windows installer: Docket-Setup.exe, released on the public repo
- Narrow window: details gives way first, then the session list

## 1.109.1 (2026-11-02)

- Say where the public copy is in the README
- ⋯ on a presented file card in chat opens the file menu

## 1.109.0 (2026-11-02)

- Per-desk on/off for Docket's split-work instructions

## 1.108.0 (2026-11-02)

- Docket's own plan system: plans, claims, task order, nesting, Plan section

## 1.107.0 (2026-11-02)

- Automatic update waits while you are typing in a session

## 1.106.0 (2026-11-02)

- Public install README: list every supported AI tool, not only Claude
- Ticket and PR chips use the session dot colors (tracker scheme)
- Top bar: sign-ins, brands, gauges and panel icons; Sites in a dialog

## 1.105.0 (2026-11-02)

- Desk Settings dialog becomes the Inspector: sections left, content right

## 1.104.2 (2026-11-02)

- Details panel: plug and checklist icons; drop lines only where a drop is accepted

## 1.104.1 (2026-11-02)

- Session menu: Chime reads 🔔 Chime: on / 🔕 Chime: off, like Sound in Settings

## 1.104.0 (2026-11-02)

- Desk profile page reads the Codex and Grok homes too, grouped by brand

## 1.103.1 (2026-11-02)

- Publish a clean install-only copy of Docket to a public repo on every merge
- Remove the issue-number notes from code comments and strings

## 1.103.0 (2026-11-02)

- ☰ Desks submenu with every desk's Settings; desk Settings in a dialog

## 1.102.0 (2026-11-02)

- Inspector: on/off checkboxes for Docket's hooks, plugins, Grok compat and settings layers

## 1.101.2 (2026-11-02)

- Archive with the ones started from it comes before Archive

## 1.101.1 (2026-11-02)

- Turn footer shows the time before Done in

## 1.101.0 (2026-11-02)

- Group picker on the new-session draft
- Back/Forward: chevron buttons, right-click menu of steps; ☰ History is now Recently viewed

## 1.100.1 (2026-11-02)

- First click on another session is no longer lost when Docket's window regains focus
- Group header grey dot visible, so status dots line up

## 1.100.0 (2026-11-02)

- New sessions split real work into child sessions without the user having to ask
- Tell new sessions their group and let them search its past sessions

## 1.99.3 (2026-11-02)

- Copy a Desk moves to ☰ > Tools, with a Desk to copy step
- Desk badge and ✦ badge tooltips say what each counts

## 1.99.2 (2026-11-02)

- Details panel: Tasks running and Tasks finished as two collapsible sections

## 1.99.1 (2026-11-01)

- Old answered cards no longer reappear under the latest reply after a compaction

## 1.99.0 (2026-11-01)

- Reach Claude through a LiteLLM gateway, signed in with lite

## 1.98.0 (2026-11-01)

- Session reports go to the session that sent the work with send_to_session

## 1.97.1 (2026-11-01)

- Open in File Explorer brings the folder's window to the front on Windows

## 1.96.0 (2026-11-01)

- ui: session working folder in the details panel, with worktree path
- Browse… folder picker on every folder box

## 1.95.1 (2026-11-01)

- Save and count Docket's own shifts

## 1.95.0 (2026-11-01)

- One Docket in the Start menu: it opens in its own window

## 1.94.0 (2026-11-01)

- AI Usage: show what Shift saved; save shift history
- Details panel: fold sections, drag them into order, buttons follow
- Shift: raise to the top gear before the first file edit or git commit

## 1.93.1 (2026-11-01)

- A test copy never sets up how Docket starts

## 1.93.0 (2026-11-01)

- Wait for a quiet moment before any Docket restart; stop false 'interrupted' marks

## 1.92.1 (2026-11-01)

- Keep manual-update Docket from updating by itself; log why each update happened

## 1.92.0 (2026-11-01)

- Comment chips: the row speech bubble gets its own 👁 setting

## 1.91.1 (2026-11-01)

- Desk button tooltip: say you can add more desks, and why

## 1.91.0 (2026-10-31)

- Attention view: Waiting on your answer section, drop Recent

## 1.90.0 (2026-10-31)

- Usage page: totals grouped by billing connection

## 1.89.1 (2026-10-31)

- Comment bubble after the ticket chip; a bubble per ticket and PR in Details

## 1.89.0 (2026-10-31)

- Copy a desk as a new desk (setup, connections, groups; never sessions)

## 1.87.0 (2026-10-31)

- Remove real names from tracked files; MIT license; name check and commit hook
- Speech bubble on session rows for comments waiting on you

## 1.85.1 (2026-10-31)

- Runner restart waits for background commands, and tells the session after

## 1.85.0 (2026-10-31)

- Check that Docket starts after a restart; offer start at sign-in or a shortcut

## 1.84.0 (2026-10-31)

- Derive the company default gh account when no ghDefault is set

## 1.83.0 (2026-10-31)

- Delete to the Recycle Bin without the "Folder In Use" dialog; queue locked items

## 1.82.0 (2026-10-31)

- Color under ☰ > Settings, ask for the main color once, new ☰ > Tools

## 1.81.0 (2026-10-31)

- Today button: lines added/removed; green/red lines colors
- Show when each message and reply was written

## 1.80.2 (2026-10-31)

- Settings > Theme opens its own list: Default / Light / Dark

## 1.80.1 (2026-10-31)

- Read a folder's branch from HEAD instead of spawning git

## 1.80.0 (2026-10-31)

- Update mode: auto-update or update manually (Update now card)

## 1.79.0 (2026-10-31)

- Details panel: lines added/removed in the Pull requests section
- Settings > Theme: Default / Light / Dark

## 1.78.0 (2026-10-30)

- Auto-continue interrupted sessions; manual Continue as a banner

## 1.77.1 (2026-10-30)

- Bring in wizard: only Close when nothing is new; disabled dialog buttons look disabled

## 1.77.0 (2026-10-30)

- ☰ > Bring in past sessions: copy Claude Code sessions from before Docket into a desk

## 1.76.2 (2026-10-30)

- Cache toast: say session cache, not memory window; primary color

## 1.76.1 (2026-10-30)

- Move job Mark done into a ⋯ row menu

## 1.76.0 (2026-10-30)

- Tidy the ☰ menu: groups with submenus, Settings first, pause button in the navbar
- Usage page: tally lines added and removed

## 1.75.0 (2026-10-30)

- Rename Company to Desk in the UI, prompts and tools

## 1.74.1 (2026-10-30)

- Details > Branches: follow a branch switched to mid-session

## 1.74.0 (2026-10-30)

- One ⋯ session menu, shared by the header and right-click

## 1.73.0 (2026-10-30)

- Terminal button: dropdown to pick a shell and start Claude, Grok or Codex

## 1.72.0 (2026-10-30)

- Bedrock: show Sign in as soon as AWS SSO credentials expire

## 1.71.0 (2026-10-30)

- Session list: red ringed dot when the last turn ended in an error

## 1.70.0 (2026-10-30)

- Open a session's folder in VS Code or Visual Studio

## 1.69.2 (2026-10-30)

- Skip the desktop notification when Docket has focus

## 1.69.1 (2026-10-30)

- Keep the Order and Recent dropdowns open across list redraws

## 1.69.0 (2026-10-30)

- Track agent, wait and user time per session, add it up like cost

## 1.68.1 (2026-10-30)

- Glide rows when a click marks a session read

## 1.68.0 (2026-10-29)

- Tickets: flag a new Jira comment from someone else

## 1.67.1 (2026-10-29)

- Hold the list redraw while Order or Recent is open

## 1.67.0 (2026-10-29)

- Shift: the top gear decides, children start on their parent's gear

## 1.66.0 (2026-10-29)

- Light theme: floating panels, 10px corners, no divider lines

## 1.65.0 (2026-10-29)

- Pick the gh account per session
- Dark theme: floating panels, 10px corners, no divider lines (mock D)

## 1.64.0 (2026-10-28)

- Pause and resume automatically on sleep, hibernate and shutdown

## 1.63.0 (2026-10-28)

- Pause all / Resume all, with a gray cover while paused

## 1.62.0 (2026-10-28)

- Shift by default on every brand, children always Shift, start gear
- ☰ menu: Memory and disk window

## 1.61.1 (2026-10-28)

- Pull request status: ask as the gh account that can read the repo
- Files list: hide files that no longer exist

## 1.61.0 (2026-10-28)

- Company profile: details panel summarizes each section

## 1.60.2 (2026-10-28)

- Child sessions follow the parent's model and effort, including Shift

## 1.60.1 (2026-10-28)

- Session list: tag column the same width on every row

## 1.60.0 (2026-10-28)

- Mac: the page uses Mac words, keys and install commands

## 1.59.1 (2026-10-28)

- Group header status dots: fixed order, right-aligned

## 1.59.0 (2026-10-28)

- Detail panel: ⋯ menu on file, pull request and ticket rows; ‹ › file pager
- Chat typing box: drag its top edge to make it taller

## 1.58.2 (2026-10-28)

- Archive view: show the Order setting

## 1.58.1 (2026-10-28)

- Session list: ticket and pull request tags in a column after the brand icon

## 1.58.0 (2026-10-28)

- Tickets: show Azure DevOps work items a session worked on
- Session list: rows glide to their new place instead of jumping

## 1.57.0 (2026-10-28)

- Tickets: show the GitHub issues a session worked on

## 1.56.0 (2026-10-28)

- Offer to switch a company to the 1-hour prompt cache
- Pull requests: find GitHub pull requests by the session's branches
- macOS support: open files, terminal, launchd install, POSIX paths

## 1.55.2 (2026-10-28)

- Move-folder card: respect a top folder's AGENTS.md and local settings

## 1.55.1 (2026-10-28)

- Setup wizard: say when a home folder already holds a setup

## 1.55.0 (2026-10-28)

- Session list: tidy top bar, tree view always on, new group at bottom

## 1.54.0 (2026-10-28)

- Details panel: list the git branches a session worked on
- Session list: one 👁 view menu for every view option

## 1.53.1 (2026-10-28)

- Archive view keeps groups and sort

## 1.53.0 (2026-10-28)

- Jira ticket and Azure DevOps PR chips on session rows

## 1.52.0 (2026-10-28)

- Install offer: card in the main color so it stands out

## 1.51.1 (2026-10-28)

- Folder card: skip top folders with their own Claude setup

## 1.51.0 (2026-10-28)

- Setup wizard: working folder from the person's AI history, reuse an existing setup

## 1.50.0 (2026-10-28)

- Neutral product: remove every company, person and private-setup reference

## 1.49.1 (2026-10-28)

- Left list: Order dropdown stays open, and drags always land

## 1.49.0 (2026-10-28)

- Setup wizard: pick the AI brand (Claude, Grok, Codex)

## 1.48.1 (2026-10-28)

- Default Grok and Codex folders: one pattern

## 1.48.0 (2026-10-28)

- Usage report: brand logo before each account in the Accounts filter

## 1.47.5 (2026-10-28)

- Keep the open session orange when nobody is at the computer

## 1.47.4 (2026-10-28)

- Recent picker: "Day" means the last 24 hours

## 1.47.3 (2026-10-28)

- Brand logos on list rows: smaller, faded, at the far right

## 1.47.2 (2026-10-28)

- Wizard sign-in step: one button in the usual place

## 1.47.1 (2026-10-28)

- Wizard: fresh install suggests folders under the user folder

## 1.47.0 (2026-10-28)

- Natural order: drag session rows into place

## 1.46.0 (2026-10-28)

- Survive compaction: recall tool and a save-before-compact turn

## 1.45.1 (2026-10-27)

- ask_company searches and reads a company's Grok and Codex chats

## 1.45.0 (2026-10-27)

- Natural list order: rows stay where they are
- Codex (ChatGPT) sessions in Docket: engine, sign-in, usage, logo, crossings

## 1.44.1 (2026-10-27)

- README: a newcomer's path from download to first session
- A fresh download opens the setup wizard instead of the maker's own desks

## 1.44.0 (2026-10-27)

- Daily budget per company, with today's spend in the bottom left

## 1.43.3 (2026-10-27)

- A session started in a group no longer opens No group

## 1.43.2 (2026-10-27)

- Setup wizard: Next needs a sign-in type picked

## 1.43.1 (2026-10-27)

- Copy clients.json to clients.local.json on start-up when there is none

## 1.43.0 (2026-10-27)

- Memory window tone names its sessions, merges, and plays on one page only

## 1.42.0 (2026-10-27)

- Grok sessions remember their conversation when picked up again

## 1.41.0 (2026-10-27)

- Sessions of different AI brands in one company message each other with no approval

## 1.40.0 (2026-10-27)

- Brand logos on session rows, brand label in the header, brand option on start_session

## 1.39.0 (2026-10-27)

- Usage: Grok sessions on the Usage page, Brand column and filter

## 1.38.0 (2026-10-27)

- Usage: count Codex sessions, with a Brand column and filter

## 1.37.0 (2026-10-27)

- Usage page, matching the ai-usage tracker's viewer

## 1.36.2 (2026-10-27)

- Keep Grok chats across app restarts; show engine stops and cut-off messages

## 1.36.1 (2026-10-27)

- Open a collapsed group when a new session lands in it

## 1.36.0 (2026-10-27)

- Ask another company, and hand work to another company

## 1.35.0 (2026-10-27)

- Cards that wait on you survive a reload and an app restart

## 1.34.0 (2026-10-27)

- Sign-in status on the Companies screen; left column shows it only when something needs doing

## 1.33.0 (2026-10-27)

- Hold the open session in place in the list until another is opened

## 1.32.2 (2026-10-27)

- Move-folder card: never offer the same folder under another name
- Last message strip shows only what you typed, not child reports

## 1.32.1 (2026-10-27)

- Sign-in: the link with a Copy button, and Grok's page opens once

## 1.32.0 (2026-10-27)

- Companies screen: a Use box per AI brand that fills in its home folder

## 1.31.3 (2026-10-27)

- Group view and Tree view on by default on first run

## 1.31.2 (2026-10-27)

- Red "needs you" once the prompt cache has expired

## 1.31.1 (2026-10-27)

- Readable text on badges and warning marks in dark mode

## 1.31.0 (2026-10-27)

- A main color for each company

## 1.30.0 (2026-10-27)

- Type a hex code in the Main color dialog

## 1.29.0 (2026-10-27)

- Several AI brands per company, picked per session

## 1.28.2 (2026-10-27)

- Session list: closed sessions sit below open read ones

## 1.28.1 (2026-10-27)

- Hover tips on the folder suggestion and folder move buttons

## 1.28.0 (2026-10-27)

- Grok sign-in per company and the Docket hooks on Grok

## 1.27.0 (2026-10-27)

- Offer the right folder for a new session
- Welcome tour, Help window and a hover tip on every control

## 1.26.0 (2026-10-27)

- Click an image in a session's chat to see it bigger

## 1.25.0 (2026-10-27)

- Session search: a toggle to also search what was said
- Session list: waiting families first, then working, then read

## 1.24.1 (2026-10-27)

- Session list: a child waiting on you lifts its whole family

## 1.24.0 (2026-10-27)

- Session list: unread sessions first, then the chosen time order

## 1.23.3 (2026-10-27)

- Grey the title of an archived session still shown in the list

## 1.23.2 (2026-10-27)

- Window title: say Docket once in the app window

## 1.23.1 (2026-10-27)

- Keep handoff cards through a Docket restart

## 1.23.0 (2026-10-27)

- Catch a session stuck on a step mid-turn

## 1.22.1 (2026-10-27)

- Archived open session no longer vanishes and comes back

## 1.22.0 (2026-10-27)

- Session list: Oldest first / Newest first switch (oldest first by default)

## 1.21.1 (2026-10-27)

- Context gauge and a percent beside the title turn red near auto-compact

## 1.21.0 (2026-10-27)

- Red session title when the conversation is close to auto-compact

## 1.20.1 (2026-10-27)

- Claude companies on a Bedrock-forced computer no longer count as signed in

## 1.20.0 (2026-10-27)

- Grok sessions in Docket: start, chat, permission card, Docket tools

## 1.19.1 (2026-10-27)

- The Docket company: work on Docket without one company's standards
- Stop the sign-in window flashing tabs while open

## 1.19.0 (2026-10-27)

- One row per schedule in the session list

## 1.18.0 (2026-10-27)

- Docket plugin: shared hooks for Claude sessions, starting with the Windows long-command guard

## 1.17.0 (2026-10-27)

- Sites tab: list, add and delete the private browser's saved sign-ins

## 1.16.0 (2026-10-27)

- Run button beside Copy on shell commands in replies
- Tidy the top bar: sound and theme in the menu, section buttons in the Details panel
- Each group can have its own start folder

## 1.15.1 (2026-10-26)

- Keep a finished session orange until the Docket window is in use

## 1.15.0 (2026-10-26)

- Fix finished jobs list in the Details panel
- Back and Forward through viewed sessions, and a History timeline

## 1.14.3 (2026-10-26)

- Keep orange sessions orange through a Docket restart

## 1.14.2 (2026-10-26)

- Say "ready to close" only when nothing waits on the user

## 1.14.1 (2026-10-26)

- Keep the open archived session in the left list

## 1.14.0 (2026-10-26)

- Handoff card: continue a session in a fresh one under the same parent
- Stop a stuck job from hiding the orange dot
- Start a new session under any session from its menu

## 1.13.0 (2026-10-26)

- List a schedule's runs in the Details panel of a session it started

## 1.12.3 (2026-10-26)

- Show the schedule clock to the right of the session title

## 1.12.2 (2026-10-26)

- Show cache minutes left on sessions that need you

## 1.12.1 (2026-10-26)

- Enter sends right away while the skill list is open; Tab or Space picks a skill
- Put the cursor in the message box when a session is clicked

## 1.12.0 (2026-10-26)

- Show the session timeline inside the chat; timeline and chime buttons by the title

## 1.11.0 (2026-10-26)

- Parent reviews a finished child, then closes it or hands it back

## 1.10.1 (2026-10-26)

- Clear the composer bar when starting a new session
- Show the AWS sign-in code in the Bedrock sign-in notice

## 1.10.0 (2026-10-23)

- Keep links, phone numbers and emails when pasting rich text

## 1.9.0 (2026-10-23)

- Change a session's parent: move under another, or make top level
- Key: add a Sound column with a play button for each chime

## 1.8.0 (2026-10-23)

- Install Docket as an app, and offer it now and then

## 1.7.0 (2026-10-23)

- Ask before archiving a session that is working, waiting on an answer, or unread

## 1.6.0 (2026-10-23)

- Files list: open a file's preview in a new browser tab

## 1.5.0 (2026-10-23)

- Put Unix line endings back in prompts/sessions.md
- Add a Key to the ☰ menu explaining every status color and blink
- Timeline filters: one dropdown list instead of a row of chips

## 1.4.1 (2026-10-23)

- Chime only when the orange dot stays

## 1.4.0 (2026-10-23)

- A child waiting on the user no longer wakes its parent

## 1.3.2 (2026-10-23)

- Keep deleted sessions in group and family cost totals

## 1.3.1 (2026-10-23)

- Open outside links in a new browser tab

## 1.3.0 (2026-10-23)

- Chat box: typing / lists the session's skills and narrows them as you type
- Tree view: show real parent and child depth in the session list

## 1.2.0 (2026-10-22)

- Keep subagent and background tasks listed across app restarts

## 1.1.2 (2026-10-22)

- Remove the "Suggested next" line above the message box

## 1.1.1 (2026-10-22)

- Send requests for agents or fan-out work to Docket sessions

## 1.1.0 (2026-10-22)

- Show cache and context during a new session's first turn
- Check GitHub for updates on a timer, pull them in, and show the version in the menu

## 1.0.0 (2026-10-22)

- Show each company's connected services and whether they connected
- Show compacting in the session while it happens
- Stop timeline and profile requests from being answered twice
- Scheduler: stop runs happening twice
- First start with no company: a setup wizard that walks through adding one
- Keep group view while searching
- Multi-select: actions in the right-click menu, not a dropdown
- Multi-select: make clicks work the way Windows does
- Show a session with background jobs as still working
- Put the Details button next to the section filters
- Terminal button: open PowerShell in a session's folder
- Pick several sessions at once and move them all to a group
- Session list: tint the selected session with the main color
- Remove the colored group square
- Session list: rows move only when a session turns orange
- Delete a session
- Auto Group: suggest a group for a session that has none
- Costs: Bedrock model names and rates, compactions, workflow agents
- Spell "color" the American way
- Give Docket its own icon: a courtroom scroll
- Pick Docket's main colour
- Shade section headers so they stand out by colour
- README: simple setup for the Windows install
- Install Docket to start with Windows, hidden, without a desktop icon
- Show a loading page at once and get Docket ready in under a second
- Move the Timeline into the Details panel so the chat keeps its space
- Keep the first click after archiving a session
- Timeline tab per session, and a profile page per company
- After filing an issue, ask whether to build it
- Pin your last message at the top of a session
- Alt+Click a session in the list to mark it unread
- Docket removes folders a session can't delete because a session is using them
- Each session keeps its own unsent message in the send box
- Archiving a session asks nothing when it's finished, and it stays gone
- Spin off work the user asks for by judgement, keeping the parent free
- Show Claude's questions as a form, not a permission card
- Step 3 of the runner: Docket takes in changes by itself
- Step 2 of the runner: sessions keep working while the app restarts
- Step 1 of the runner: Docket's tools as their own helper
- Write down how changes are made
- Page: ignore a remembered company that was removed; show an edited company list before its sessions load
- Bedrock clients: an AWS profile per client, AWS sign-in check and sign-in; ~/.claude home keeps ~/.claude.json
- README: code to make the Docket desktop shortcut
- Add Mark unread to the session right-click menu
- Sessions can rename themselves or suggest a title; new session from a group
- Edit the company list per machine from the menu; renames reach the Details panel
- Launcher: Windows line endings and a simpler already-running check
- Launcher: only open the page when Docket is already running
- Rename the program to Docket
- README: how to set the portal up on another machine
- Add Recent to Needs attention and line up group view titles
- Needs attention filters inside group sections when group view is on
- Add a Needs attention filter and mark caches that are running out
- Hide empty groups in group view unless Show empty groups is ticked
- Stop a slow list reload from undoing an archive
- Let the session list and Details panel be resized by dragging
- Add session groups, three-layer cost, and a 10-minute cache tone
- Remove the automatic restart after a crash
- Keep 'waiting on you' across portal restarts
- Log starts, stops and crashes; restart the portal after a crash
- Mute the chime per conversation
- Chime when a session needs you, with a mute button
- Nest and archive one-shot claude -p runs under the session that ran them
- Wake the parent on child reports; add Shift mode (start on Haiku, shift up)
- Let sessions start other sessions the way desktop sessions do, by editable rules
- Family total first; show or hide each Details section from the top bar
- Show a family total for sessions that started others
- Align session cost with the AI Usage Tracker; write per-day usage rows
- Show each session's cost at API prices in the Details panel
- Make dropdowns readable in both themes
- Move session details into a bar under the message box
- Show model, context use and cache timer per session
- Preview Markdown and text files in the middle, a window, or a pop-out
- Rename the Tasks button and panel to Details
- List the files each session produced, open them or show them in Explorer
- Edit a schedule by chatting with a session kept for it
- Schedules as a left-column tab with an editor in the middle panel
- Run scheduled tasks from the portal, with missed-run catch-up
- Give every session a private browser with remembered sign-ins
- Archive and restore sessions from a right-click menu
- Show session families two levels deep, like the desktop app
- Line up nested session rows
- Nest sessions under the session that started them
- Show each session's pull requests with their status
- Offer Continue for any conversation that was cut off
- Survive a portal restart without silent stalls
- Copy buttons and suggested next prompt
- Sign in from the page instead of a terminal
- First version of the session portal
