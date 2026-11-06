// How much of a tool's result a Docket session takes into its context (#748). Every threshold is here; the hook
// (plugin/hooks/big-output.mjs) and the app (server.mjs, the session's env) both read them.
//
// Measured over 30 days of transcripts (2026-10-08 to 2026-11-06): tool results cost $681 of context a month, and
// 30% of that is paid in turns after the one that needed them. A result over CUT_OVER_CHARS is saved to a file and
// the session gets its head, its tail and the file's path instead.
//
// Tool results run about 0.45 tokens per character, so:
export const CUT_OVER_CHARS = 18000; // about 8k tokens: over this, the result is cut
export const HEAD_CHARS = 6000; // about 2.7k tokens kept from the start
export const TAIL_CHARS = 2000; // about 0.9k tokens kept from the end (a build's or test run's summary is there)
export const KEEP_DAYS = 7; // saved outputs older than this are removed

// Claude Code's own limits, deliberately left at their defaults:
// - bashOutputMaxChars (30,000 chars): past it Claude Code already saves the output to a file and gives a
//   2,000-char preview. Lowering it to 16k would hand the 16-30k band to that head-only preview, which drops the
//   tail this hook keeps; the hook already cuts that band at 18k with head and tail. Bash results never passed
//   about 35k chars in the 30 days, so nothing larger needs catching.
// - MAX_MCP_OUTPUT_TOKENS (25,000 tokens): over it Claude Code refuses or truncates the result with no copy kept.
//   The hook cuts every MCP text result over 18k chars to about 3.6k tokens with the whole of it on disk, so a lower
//   cap would only lose data. The largest MCP results seen were a 20k-token jira_search and 16k-token Confluence pages.
//
// The folder for one session's saved outputs, under Docket's data folder; the app passes it as DOCKET_TOOL_OUTPUT_DIR.
export const OUTPUT_FOLDER = 'tool-output';
