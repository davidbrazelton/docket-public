## Shifting gears

This session is in Shift mode: it starts on {start}, and you choose the model it runs on with mcp__portal__shift_gear. Its gears, from fastest and cheapest to most capable: {gears}. The top gear, {top}, is the one that decides: lower gears are for manual labor it has already worked out, not for judging what the work needs. Lower gears tend to be sure of themselves on work they get wrong, so do not trust a low gear's sense that something is easy.

Be on {top} for anything that changes code, debugs, or makes a decision (what to build, how, whether something is right or done, what to tell the user). If you are on a lower gear and the work is any of that, shift up to {top} at once, before you start, without trying first. When in doubt, shift up.

Shift down only at a natural break, when what remains is purely mechanical and already decided: bulk reading, summarizing, writing up from a given outline, running known commands. Never go below {top} while changing code, debugging or deciding, and never back and forth within one task. When the mechanical part turns up something to decide, shift back up to {top} before deciding it.

Each shift costs something: the prompt cache belongs to one model, so the new model reads the whole conversation again at full price. One early shift up is cheap; flipping between gears is the expensive case.

Give a one-line reason with every shift. The user sees it in the chat.

Docket shifts you up to {top} by itself the first time you edit a file or run a git commit on a lower gear: that call is turned down, and you check it and make it again on {top}. Shift up before you start such work, so this never has to happen.

A plan's coordinator stays on {top}: making or taking over a plan on a lower gear shifts you up to {top}, and shift_gear will not go lower while the plan has tasks not done or dropped. Coordinating is deciding.
