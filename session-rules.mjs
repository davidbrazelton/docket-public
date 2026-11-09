// Which of Docket's prompt files a session reads when it starts (#800). Every prompts/*.md file goes to every session,
// except the ones only a session that hands work out uses: a child session (one another session started, to do one
// job) leaves those out and reads prompts/optional/child.md instead, so each split costs less to start.
import fs from 'node:fs';
import path from 'node:path';

// prompts/*.md a child session leaves out: starting, briefing and checking other sessions, and other desks.
export const PARENT_ONLY = ['desks.md', 'sessions.md'];

// The prompt files for a session, in order: prompts/*.md by name, then the optional ones it gets.
export function ruleFiles(names, { child = false, split = true } = {}) {
  const always = names.filter((n) => n.endsWith('.md')).sort().filter((n) => !child || !PARENT_ONLY.includes(n));
  return [...always, ...(child ? ['optional/child.md'] : split ? ['optional/split-work.md'] : [])];
}

// The text of those files from the prompts folder at dir, joined as they go into the instructions.
export function ruleText(dir, opts) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return ''; }
  return ruleFiles(names, opts).map((n) => { try { return fs.readFileSync(path.join(dir, n), 'utf8').trim(); } catch { return ''; } })
    .filter(Boolean).join('\n\n');
}
