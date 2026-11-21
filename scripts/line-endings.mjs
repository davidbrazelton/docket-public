// Stops a commit that rewrites many lines' endings by accident (#1114). index.html and server.mjs keep mixed CRLF/LF on
// purpose, and `sed -i` in Git Bash, Python in text mode or an editor can quietly turn every line to one ending, so a
// one-line change becomes thousands of changed lines in the pull request. For each file it compares the diff's line
// counts with and without --ignore-cr-at-eol: the gap is how many lines changed only in their ending.
//
//   node scripts/line-endings.mjs              what is staged (the pre-commit hook runs this)
//   node scripts/line-endings.mjs <commit>     the working tree against <commit>
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIMIT = 20; // more lines than this changed only in their ending stops the commit

function numstat(cwd, args) {
  const r = spawnSync('git', ['diff', '--numstat', '--no-renames', '--no-color', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`git diff failed: ${r.stderr}`);
  const files = new Map();
  for (const line of r.stdout.split('\n')) {
    const [added, deleted, file] = line.split('\t');
    if (file && added !== '-') files.set(file, Math.max(+added, +deleted)); // '-' is a binary file
  }
  return files;
}

// [{ file, lines }] for each file with more than `limit` lines whose only change is the line ending.
export function endingRewrites(cwd, args = ['--cached'], limit = LIMIT) {
  const plain = numstat(cwd, args), ignoring = numstat(cwd, ['--ignore-cr-at-eol', ...args]);
  return [...plain].map(([file, n]) => ({ file, lines: n - (ignoring.get(file) || 0) })).filter((f) => f.lines > limit);
}

export function message(rewrites, base = 'origin/master') {
  return [
    'Line endings rewritten by accident: these files have lines whose only change is CRLF <-> LF.',
    ...rewrites.map((f) => `  ${f.file}: ${f.lines} lines`),
    'index.html and server.mjs keep mixed CRLF/LF on purpose. sed -i, Python in text mode and some editors normalise them.',
    `To fix: restore each file (git checkout ${base} -- <file>) and make your edits again with Python, opening it with`,
    "newline='' so every line keeps its ending, then check git diff --stat shows only the lines you meant to change.",
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const commit = process.argv[2];
  const rewrites = endingRewrites(process.cwd(), commit ? [commit] : ['--cached']);
  if (rewrites.length) {
    console.error(`Commit stopped. ${message(rewrites, commit || 'HEAD')}`);
    process.exit(1);
  }
}
