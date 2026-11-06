// The private browser's tool server, one per desk (#757). Each session used to start its own copy of
// @playwright/mcp (about 80 to 105 MB of memory each, most of them never used). Now one copy per desk listens on a
// port on this computer and every session of the desk connects to it over HTTP. Checked in @playwright/mcp 0.0.83:
// with --isolated, each client connection gets its own browser context, made from --storage-state on its first
// browser tool call (so new sign-ins reach the sessions that start browsing after them); one Chrome serves them all,
// started on the first call and closed after the last connection ends or an hour without a call. Claude Code
// sends its folder as the MCP root, which is where that session may read and write files. --output-dir is one
// folder for the whole server, so the app links each file a session's tool result names into that session's own
// uploads folder (savedFiles), where its Files list looks.
// The runner keeps the server running (its stdin is a pipe from the runner; Playwright stops when it closes).
import path from 'node:path';

export const OUTPUT_MAX_BYTES = 100 * 1024 * 1024; // Playwright removes the oldest files past this; the linked copies stay

// The server's command line, all but the port: the part that has to match for a running server to be used again.
export const deskServerArgs = ({ cli, storage, outDir }) => [cli, '--isolated', '--headless',
  '--storage-state', storage, '--output-dir', outDir, '--file-paths', 'absolute', '--output-max-size', String(OUTPUT_MAX_BYTES)];

export const mcpUrl = (port) => `http://localhost:${port}/mcp`;

// The files a browser tool's result names inside the server's output folder (screenshots, snapshots, downloads).
// The result shows them as Markdown links, so a name ends at the closing bracket or at the end of the line.
export function savedFiles(text, outDir, platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const dir = p.resolve(outDir) + p.sep;
  const hay = platform === 'win32' ? String(text).toLowerCase() : String(text);
  const needle = platform === 'win32' ? dir.toLowerCase() : dir;
  const found = new Set();
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    const rest = String(text).slice(i + dir.length).match(/^[^\r\n)\]"'`<>|*?]+/)?.[0]?.trimEnd();
    if (!rest || rest.includes('..')) continue;
    found.add(dir + rest);
  }
  return [...found];
}
