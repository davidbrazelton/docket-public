// Docket raising a Shift session to its top gear by itself: the first time a session on a lower gear edits a
// file or runs a git commit. Low gears sometimes made code changes without shifting up first, so Docket does it.
// The plugin hook (plugin/hooks/shift-first-edit.mjs) asks the app before the tool runs; the app decides here.
import { gearsOf, findGear } from './gears.mjs';

// The tools that change files: Claude's, Codex's (its file changes show as Edit), Grok's own names.
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'search_replace', 'write']);
// The tools that run a command: Claude's Bash and PowerShell, Codex's Shell, Grok's run_terminal_command.
const COMMAND_TOOLS = new Set(['Bash', 'PowerShell', 'Shell', 'run_terminal_command']);
// `git commit`, also with git options before it (git -C <folder> commit, git -c user.name=x commit); not commit-tree.
const GIT_COMMIT = /(^|[\s;&|(`'"])git(\.exe)?(\s+(-[cC]\s+("[^"]*"|'[^']*'|\S+)|--?[\w-]+(=\S+)?))*\s+commit(?![\w-])/;

// What a tool call does that needs the top gear: 'first file edit', 'git commit', or null.
export function workKind(tool, input) {
  if (EDIT_TOOLS.has(tool)) return 'first file edit';
  if (COMMAND_TOOLS.has(tool) && GIT_COMMIT.test(String(input?.command || ''))) return 'git commit';
  return null;
}

// Whether Docket raises this session before the tool call: { from, to, why } (gears of its brand), or null when the
// session is not in Shift (a model the user chose), the call changes nothing, or it is already on its top gear.
// gear: the model it runs on now; one that is no gear of its brand counts as its lowest, as shift_gear counts it.
export function shiftUpFor({ settings, brand, gear, tool, input }) {
  if (settings?.model !== 'shift') return null;
  const why = workKind(tool, input);
  if (!why) return null;
  const gears = gearsOf(brand), to = gears[gears.length - 1];
  const from = findGear(brand, gear) || gears[0];
  return from.id === to.id ? null : { from, to, why };
}
