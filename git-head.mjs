// The branch a folder is on, read from its HEAD file. Same answer as `git branch --show-current`, but
// without starting git: on Windows each process start blocks the app for tens of milliseconds, and the session
// list asks this for every folder every live session has worked in.
import fs from 'node:fs/promises';
import path from 'node:path';

// The branch name, '' when HEAD is detached, null when the folder is gone or not in a git repository.
export async function currentBranch(dir) {
  let d = path.resolve(dir);
  try { if (!(await fs.stat(d)).isDirectory()) return null; } catch { return null; }
  for (;;) {
    const dotGit = path.join(d, '.git');
    let st = null; try { st = await fs.stat(dotGit); } catch {}
    if (st) {
      let gitDir = dotGit;
      if (st.isFile()) { // a worktree or submodule: "gitdir: <path>", relative to the folder holding .git
        let text = ''; try { text = await fs.readFile(dotGit, 'utf8'); } catch { return null; }
        const m = text.match(/^gitdir:\s*(.+?)\s*$/m);
        if (!m) return null;
        gitDir = path.resolve(d, m[1]);
      }
      let head = ''; try { head = (await fs.readFile(path.join(gitDir, 'HEAD'), 'utf8')).trim(); } catch { return null; }
      const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
      return ref ? ref[1] : '';
    }
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}
