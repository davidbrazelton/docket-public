# How Docket's controls look

Every button, toggle and menu in Docket is one of five kinds. The kind says what it does, and the look follows from the kind, so a person can tell at a glance whether pressing something takes them somewhere, does something, or changes what the list shows. Read this before adding or changing any control.

## The five kinds

| Kind | What it does | How it looks | Today |
|---|---|---|---|
| **Link** | takes you somewhere, or shows or hides a part of the page | flat: no border; grey tint when pointed at; when on, a soft tint (`--accent-soft`) and the icon or text in the main color (`--accent`), still no border | ☰ · the Sessions list and Details panel buttons · ‹ › · the desk tabs · the Sessions / Schedules tabs (in their grey track) · 🔨 Suggest |
| **Action** | does something | a thin grey border (`--line`) | Terminal ▾ · ⏸ Pause all · ⟳ Reload all |
| **Main action** | the one most important action on screen | solid main color (`button.primary`) | + New session, and nothing else in the bar or the list head |
| **Filter** | changes what the list shows | a thin grey border; when on, a soft tint, a main-color border and main-color text | the ✦ Needs attention control with its Keep period · 👁 View · ❝ Search inside chats · Order · the toggle chips in the 👁 and 🎙 menus (✓ when on), for short values in a row; their other choices are ✓ rows |
| **Indicator** | shows status | no border, muted (`--muted`); AI brand icons and 🌐 faded until signed in, then the main color | AI brand icons · 🌐 Sites · 📡 Remote · the CPU, memory and file space gauges · the update arrow (an indicator you can press: in the main color, since it shows only when an update is ready, with a soft tint when pointed at or open) |

## Why

- **Flat for going somewhere.** The top bar is mostly places: menus, panels, desks. Drawing a box round each would make the bar a row of boxes with nothing standing out. Flat links keep it quiet.
- **A border where you set or do something.** A border says "this changes something when pressed". Actions and filters get one, so the few controls that change things are easy to find.
- **One look for "on".** A link or filter that is on always has the soft tint in the main color. Before this, "on" looked different almost everywhere (a raised tile, a filled icon, a coloured icon, a ticked checkbox).
- **Filters show their state on the border too**, so a list that is filtered can be told from one that is not without reading the button.
- **One main action.** Solid main color is kept for + New session, so it never competes with anything else.
- **Cards in the chat are their own place.** A card that waits on one answer (Start on a suggested session, Merge on the Merge card under a plain merge ask) gets one solid button for that answer, and goes away or turns into a one-line record once answered. Its other choices are actions, and a way to see more (View PR) is a link.

## Where things sit in an open session

Every card, band and list in an open session goes in one of three places, by what it is:

1. **Top of the session: the session's state.** Things that stay true until fixed, not tied to a moment in the chat: budget reached, config changed, reply cut off, handed over from another desk, your last message, the timeline bar.
2. **In the chat: conversation events.** A card sits where it was asked (a suggested session, an offer, a handoff, a plan offer, a suggested title, a send to another desk, Allow this?, a question form, Merge, files, a child's report) and turns into a one-line record once answered.
3. **Beside the typing box: what you act on next.** One **Waiting on you** list (`#qTray`) of every open card, prompt, question form and numbered question, and every session under this one waiting on you, each once, with the card's own buttons; plus the autopilot band. Nothing waiting, no list.

The one deliberate exception is the **Sign in** card, pinned under the last reply: it needs a click now, before the session can go on, so it stays where the eye already is.

The list looks like a context menu (the `.ctx` rows, pills, a rule under its head) in a 1.5px `--warn` frame with no fill; every pill in it is plain gray, numbered questions too. It starts open, its whole head line folds or shows it, and its count is everything waiting, on screen or not.

**One right edge.** The cards in the chat, the Waiting on you list, and the typing box with its Send button all end on the chat column's edge: the composer shares the chat's `.inner` column and is padded by the chat's scrollbar width, so the three stay lined up as the window resizes or the scrollbar comes and goes. Buttons inside the list end as far in from its edge as a card's do from the card's.

A new card or band picks its place by this rule; it does not get a fourth place, and a thing waiting on you is listed once, beside the typing box, never also at the top.

## Shape and size

- **Corners: 8 px** on every button, chip, menu and split control (`border-radius: 8px`). Nothing round except count badges and status dots.
- **Every small icon-only button is at least 32 px wide and 28 px tall**, whether link, action or filter, so a thin glyph like ❝ is as easy to hit as ✦ or 👁. Indicators keep their own size.
- **A split control** (✦ and its Keep period) is one bordered box with a divider; each half is its own button, and the 8 px corners belong to the outer box.

## Menus

Every menu that drops from a button is one style, the 🎙 Talk menu's (`.ctx` in `index.html`; #1185). Its parts:

- **Heading** (`.tp-h`, or `.sub-h` in the session menu): small, bold, muted, over the rows it names. A heading says what the choice is for ("Also keep read sessions from", "Every plan shows"), so the rows can be short.
- **Rule** (`<hr>`) between two sections.
- **✓ rows**: one row per choice, a tick column on the left (`.tick`), the picked row in the soft tint. `menuitemradio` for one of several, `menuitemcheckbox` for on/off, `menuitem` for an action ("Disconnect Sam's laptop", "Off everywhere"). A row that can't change now is grayed out and says why.
- **Note beside the label** (`<small>`), for a few words ("Workday · Since the last workday").
- **Description line** under the label (`.d`), when the note is too long to sit beside it (Summary of, Plan view, Remote control, Autopilot).
- **Toggle chips** (`.tp-chips`), a filter's look, only for a short set of values in a row (Speed, Chat presets, Period). Actions are rows, never chips.
- **Switch on the right** (`.swrow`) only where turning a row on acts for the user: Autopilot's desks, since engaging lets it answer and send.
- **A footnote** (`.sub-f`), muted, for what the menu can't say in a row; a link in it is `.lk`. A one-time notice with its own button is a tinted box (`.tp-note`).

Every menu: ↑ ↓ move through the rows that can change now (Home and End to the ends), Escape and a click outside close it, and the row just changed keeps the focus.

## Colors

Use the color tokens on `:root` in `index.html` only (`--line`, `--panel-2`, `--accent`, `--accent-soft`, `--muted`, `--text`, `--warn`). Never a fixed color. That way light, dark and a default color picked in ☰ > Docket settings > Default color, or a desk's own (`data-accent`) all work without extra rules.

## One look: Tint, with a stripe only where you act (#1033)

Docket has one look and no setting for it. Every box is drawn the same way, from a few tokens in `index.html`:

1. **One shape.** A box has a pill naming its kind, a bold title, a body and its buttons.
2. **Tint everywhere.** A box (`.bx`) is a soft fill in its kind's color, with no border and every corner rounded (10 px). A kind class sets `--c` (the color) and `--cs` (its soft fill):

   | Kind class | For | `--c` / `--cs` |
   |---|---|---|
   | `k-q` | every question: Qn in a reply, question forms, plan decisions | `--q` / `--q-soft` |
   | `k-warn` | Allow? | `--warn` / `--warn-soft` |
   | `k-sign` | Sign in | `--signin` / `--signin-soft` |
   | `k-acc` | suggestions, offers, Merge, "Next" | `--accent` / `--accent-soft` |
   | `k-run` | messages from sessions, reports | `--run` / `--run-soft` |
   | `k-ok`, `k-bad` | done, errors | `--ok` / `--ok-soft`, `--bad` / `--bad-soft` |
   | `k-plain` | neutral things: tool steps, files, the waiting list, the composer | `--muted` / `--panel-2` |

   The soft fills for warn, sign in, run, ok and bad mix the color into `--panel` at 14% in light and 20% in dark, the same mix as `data-accent`.
3. **The focus edge.** `.focus` adds a 3 px stripe in the kind's color down the left (corners `4px 10px 10px 4px`). It goes only on cards that wait on you right now: open questions (Qn, forms, plan decisions), Allow?, Sign in and Merge. It never goes on headers, banners, suggestions, offers, reports, file cards, errors, rows or the waiting-on-you list.
4. **Answered, a card is a one-line record** on `--panel-2` (`.bx.done`), with a green ✓ pill, or a grey pill (`.settled`) when it was turned down or is no longer needed. The stripe goes.
5. **Headers never get a border or a stripe**, and never look more important than what is under them.
6. **"On" is one look:** the soft accent fill (`--accent-soft`).
7. **What the autopilot answered or sent gets a pill, never an edge.** An answered record keeps its one line on `--panel-2`, with the teal 🤖 Autopilot pill (`--pilot`) beside its ✓ pill and the autopilot's reason (and Not my pick) on a line under it. A message the autopilot sent carries the same pill in its head. A stripe always means "waiting on you now" (#1034).

A new card takes the same classes and the `wHead` / `wRec` helpers, and never a border or fill of its own.

**What stays as it is:** status dots, your own message bubbles, centered notes (compaction, retry) and the done line; solid main-action buttons; the session row's own layout (its columns and reason icons). Floating menus, pops and dialogs keep their neutral `--pop-bg` frame and shadow; only their ticked items and the boxes inside them follow the look. Dense rows (sessions, plan tasks, files, pull requests, waiting-on-you rows) get no box each: kind colors there sit in small pills or the existing icons. The top bar stays neutral: desks are told apart by their own main color (`data-accent`), which reaches the open tab, the selected row, the pills and the buttons.

### Surface by surface

| Surface | Under the one look |
|---|---|
| Group headers in the list, Details section headers | `--head` fill, inset and rounded, no border |
| Session row selected or picked, my plan task, a ticked menu item | the soft accent fill only, no stripe |
| Plan: "Next" | an accent card with a Next pill |
| Sites: a site that needs a sign-in | a Sign in card with the stripe |
| Banners (budget, settings changed, cut off, start at sign-in) | a tinted card with a pill (Budget, Settings, Cut off, Start) and its buttons |
| Welcome back | an accent card with its pill |
| Message from a session | a `--run` card, pill From session (Handoff, Brief) |
| Message the autopilot sent | a neutral card with the 🤖 Autopilot pill, no edge |
| Child report, session report | a `--run` card, pill Report (Waiting when the child waits on you), no stripe |
| Docket note (`.msg-docket`) | a neutral one-line record with its From Docket pill |
| Tool steps, step groups, timeline | a neutral card, the tool's name in a soft pill |
| Qn, forms, plan decisions, Allow?, Sign in, Merge | one card shape; the stripe only while waiting |
| Suggestions and offers | one card shape, never a stripe |
| File card in the chat | a neutral card, pill Files |
| Error | a `--bad` card, pill Error |
| Waiting on you list | a neutral card; each row starts with its kind's pill |
| Composer | a neutral card |
| Menus and dialogs | their neutral frame; ticked items use the accent fill |

### Every element in an open session

| Element | What it is | Open, then answered | Card? |
|---|---|---|---|
| Numbered question in a reply (`.qhl`) | a reply's line that asks Qn | open, or faint when unsure → ✓ Qn with your answer, or grey when settled without one | yes: purple, stripe while open |
| Question form (AskUserQuestion, `.qform`) | Claude's form of questions | pending → one record line per question with its answer; grey when skipped or no longer needed | yes: purple, pill Qn or Question, stripe while open |
| Plan decision (`.qask`, `.qrec`, `.qquote`) | a plan's Qn line with its options as buttons | open → ✓ Qn answered or done, with Change or Answer | yes: purple, stripe while open |
| Allow? (`.perm`) | a permission ask | pending → ✓ Allowed, or grey Denied / No longer needed | yes: amber, stripe while open |
| Suggested session (`proposal`) | a session suggested by start_session | open → ✓ Started, or grey Dismissed / Withdrawn | yes |
| New session? (`offer`) | "do this in its own session?" | pending → ✓ New session / ✓ Doing it here, or grey Closed | yes |
| Hand off? (`handoff`) | carry on in a fresh session | open → Archive? (a second wait) → ✓ Handed off / ✓ Kept here, or grey Closed | yes |
| Plan? (`plan-offer`) | a second child started without a plan | open → ✓ Plan, or grey No plan | yes |
| Title? (`title-suggestion`) | a suggested session title | open → ✓ Applied, or grey Dismissed | yes |
| Ask desk? / Hand over? (`cross`) | the first crossing into another desk | pending → ✓ Sent, or grey Not sent | yes |
| Other desk (`desk-handoff`) | work handed to another desk, followed there | open → a settled card that keeps its Sent / Started / Done track (Started, Running, ✓ Done); grey record when taken back or dismissed | yes |
| Sign in (`.signin-ask`) | the private browser needs a sign-in | waiting → gone once signed in | yes: yellow, stripe while waiting |
| Merge (`.merge-ask`) | a plain merge ask under a reply | waiting (Fix while it cannot merge) → gone once merge is sent | yes: stripe while waiting |
| Send again? (`retry`) | signed in again after a failed turn | waiting | yes |
| Your messages | what you typed | — | no: yours, not waiting |
| Messages from another session, Docket or the autopilot | `.msg-from`, `.msg-docket`, with their notes | — | no: a `--run` card (From session), the autopilot's neutral with its pill, Docket's a neutral record |
| Replies and narration | the AI's answer; narration muted | — | no |
| Steps and step groups | tool runs, one line each, grouped or opened | running → done or error | no: a neutral card, the tool in a soft pill |
| File card | files a session presented, as file rows | — | no: a neutral card with a Files pill; its rows are links |
| Child report | a child finished a turn or is waiting on you | — | no: a `--run` card (Report or Waiting); its wait is answered in the child |
| Session report, child progress fold | reports from sessions under this one | folded or open | no: the report is a `--run` card |
| Notes, compaction lines | Docket's notes in the chat | compacting → compacted or failed | no |
| Error (`.err`) | a turn that failed | — | no: a `--bad` card with an Error pill, a failure not a question |
| Done / Stopped line, finished line, ready-to-close band, "Part of this reply was not saved" | the end of a turn | — | no: status |
| New since you last looked | the line where unread starts | — | no |
| Welcome back | offers Summary after time away | shown → gone | no: an accent card with its pill, never a record |
| Timeline | costs and timings in the chat | folded or open | no: a neutral card |
| Autopilot suggestion (`.pl-suggest`) | what the autopilot would pick, inside a card | — | follows its card |
| Waiting on you list, last-message pin, Jump to new | beside the typing box or over the chat | — | no: the list is a neutral card whose rows start with their kind's pill |
| Inbox cards in the session list | work handed over from another desk | — | not in the chat; the list keeps its own look for now |

## Deciding a new control

1. **What does pressing it do?** Takes you somewhere or shows a panel: a link. Does something once: an action. Changes what the list shows until you change it back: a filter. Only shows status: an indicator.
2. **Is it the single most important thing to do here?** Only then is it a main action, and there is already one (+ New session) in the bar and the list head.
3. **Does it have an "on" state?** Use the soft tint and main color for it, and a main-color border as well if it is a filter. Set `aria-pressed` or `aria-expanded` to match.
4. **Is it icon-only?** Make it at least 32 × 28.
5. **Does it open a menu?** Make it of the shared parts in **Menus** above: 8 px corners, a tick on the current choice, closed on a click outside or Esc.
6. **Check it** in light and dark, with a custom main color, and at phone width (the top bar changes at 900 px and 640 px).
