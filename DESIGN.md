# How Docket's controls look

Every button, toggle and menu in Docket is one of five kinds. The kind says what it does, and the look follows from the kind, so a person can tell at a glance whether pressing something takes them somewhere, does something, or changes what the list shows. Read this before adding or changing any control.

## The five kinds

| Kind | What it does | How it looks | Today |
|---|---|---|---|
| **Link** | takes you somewhere, or shows or hides a part of the page | flat: no border; grey tint when pointed at; when on, a soft tint (`--accent-soft`) and the icon or text in the main color (`--accent`), still no border | ☰ · the Sessions list and Details panel buttons · ‹ › · the desk tabs · the Sessions / Schedules tabs (in their grey track) · 🔨 Suggest |
| **Action** | does something | a thin grey border (`--line`) | Terminal ▾ · ⏸ Pause all · ⟳ Reload all |
| **Main action** | the one most important action on screen | solid main color (`button.primary`) | + New session, and nothing else in the bar or the list head |
| **Filter** | changes what the list shows | a thin grey border; when on, a soft tint, a main-color border and main-color text | the ✦ Needs attention control with its Keep period · 👁 View · ❝ Search inside chats · Order · the toggle chips in the 👁 menu (✓ when on) |
| **Indicator** | shows status | no border, muted (`--muted`); AI brand icons and 🌐 faded until signed in, then the main color | AI brand icons · 🌐 Sites · 📡 Remote · the CPU, memory and file space gauges · the update arrow (an indicator you can press: in the main color, since it shows only when an update is ready, with a soft tint when pointed at or open) |

## Why

- **Flat for going somewhere.** The top bar is mostly places: menus, panels, desks. Drawing a box round each would make the bar a row of boxes with nothing standing out. Flat links keep it quiet.
- **A border where you set or do something.** A border says "this changes something when pressed". Actions and filters get one, so the few controls that change things are easy to find.
- **One look for "on".** A link or filter that is on always has the soft tint in the main color. Before this, "on" looked different almost everywhere (a raised tile, a filled icon, a coloured icon, a ticked checkbox).
- **Filters show their state on the border too**, so a list that is filtered can be told from one that is not without reading the button.
- **One main action.** Solid main color is kept for + New session, so it never competes with anything else.

## Shape and size

- **Corners: 8 px** on every button, chip, menu and split control (`border-radius: 8px`). Nothing round except count badges and status dots.
- **Every small icon-only button is at least 32 px wide and 28 px tall**, whether link, action or filter, so a thin glyph like ❝ is as easy to hit as ✦ or 👁. Indicators keep their own size.
- **A split control** (✦ and its Keep period) is one bordered box with a divider; each half is its own button, and the 8 px corners belong to the outer box.

## Colors

Use the color tokens on `:root` in `index.html` only (`--line`, `--panel-2`, `--accent`, `--accent-soft`, `--muted`, `--text`, `--warn`). Never a fixed color. That way light, dark and a main color picked in ☰ > Settings > Color (`data-accent`) all work without extra rules.

## Deciding a new control

1. **What does pressing it do?** Takes you somewhere or shows a panel: a link. Does something once: an action. Changes what the list shows until you change it back: a filter. Only shows status: an indicator.
2. **Is it the single most important thing to do here?** Only then is it a main action, and there is already one (+ New session) in the bar and the list head.
3. **Does it have an "on" state?** Use the soft tint and main color for it, and a main-color border as well if it is a filter. Set `aria-pressed` or `aria-expanded` to match.
4. **Is it icon-only?** Make it at least 32 × 28.
5. **Does it open a menu?** Give the menu 8 px corners, a tick on the current choice, and close it on a click outside or Esc.
6. **Check it** in light and dark, with a custom main color, and at phone width (the top bar changes at 900 px and 640 px).
