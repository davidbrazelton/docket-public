// Reply text that Claude Code saves as a thinking block (#842): text written before a tool call can come back as a
// 'thinking' block holding a shortened copy, told apart from real thinking only by its signature, whose base64 header
// names the kind ('narration' against 'thinking'). Pure, so test/narration.test.mjs runs it on its own.
export function narrationText(b) {
  if (b?.type !== 'thinking' || !b.thinking?.trim() || typeof b.signature !== 'string') return '';
  let head = '';
  try { head = Buffer.from(b.signature.slice(0, 64), 'base64').toString('latin1'); } catch { return ''; }
  return head.includes('narration') ? b.thinking.trim() : '';
}
