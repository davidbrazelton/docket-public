// PreCompact hook: what goes into the summary when a conversation is compacted (#747). A Docket hook: a company turns
// it off with "compact-summary" in docketHooks.off.
//
// Claude Code adds what this prints to its own compact instructions. The summary is read again on every call after
// the compact, so it asks for a short one in fixed sections (OpenCode's template), and for the exact facts a summary
// tends to lose and sessions otherwise look up again with recall: IDs, SHAs, pull request numbers, and what is
// committed, pushed and merged. Claude Code puts CLAUDE.md and the setup back by itself, so they are left out.
// Kept well under the 10,000 characters a hook may add.

import { pathToFileURL } from 'node:url';
import { isOff } from './off.mjs';

export const NAME = 'compact-summary';

export const TEMPLATE = `Write the summary in these sections, as terse one-line bullets. Leave a section out when it has nothing.

## Objective
What the user wants done, in one or two lines.

## Requirements
The user's own constraints, conditions and preferences, in their words where they matter ("merge only when I say merge").

## Decisions
What was decided and why, one line each. Include options that were ruled out, so they are not tried again.

## Work State
What is done and what is not. Give the exact state of each change: committed, pushed, pull request open, merged. Name the branch, worktree folder, commit SHAs, pull request and issue numbers, ticket keys, session ids, ports and background jobs or servers still running.

## Next Move
The very next step, and anything the user is waiting on or was asked.

## Relevant Files
At most 15 paths, one per line, with a few words on why each matters. Paths only: no file contents.

## Important Context
Facts that are costly to find again: exact error messages, commands that worked, URLs, numbers measured, names and ids.

Rules:
- Copy IDs, SHAs, numbers, paths and names exactly; never shorten or round them.
- Leave out CLAUDE.md and other instruction files, the session setup, tool lists and anything the system prompt says again after the compact.
- No file contents and no long logs: name the file or quote the one line that matters.
- Keep it short: the summary is read again on every later call.`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (isOff(NAME)) process.exit(0);
  process.stdout.write(TEMPLATE + '\n');
}
