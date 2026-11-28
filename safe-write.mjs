// Writing the files Docket keeps without ever stopping the app over them (#1279). On Windows a file can be refused for
// a moment (antivirus, the indexer or a backup holding it): the write then fails with EPERM, EBUSY, EACCES or even
// UNKNOWN. An uncaught error from a timer ends the app, so writes from timers go through createSaver, which never throws.
import fs from 'node:fs';
import path from 'node:path';

// The codes of a file held for a moment by another program; worth trying again shortly.
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES', 'UNKNOWN']);
export const busyError = (err) => BUSY.has(err?.code);
// Waits between tries of a refused rename (milliseconds). Short: the app waits for them.
export const RENAME_WAITS = [20, 40, 80, 160];
// Waits before saving again after a failed save: a passing lock costs a second, a longer one is tried less often.
export const RETRY_WAITS = [1000, 3000, 10000, 30000, 60000];

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Writes text to a spare file beside it and swaps that in, so a file is never left half-written. A rename refused by a
// busy file is tried again a few times. Throws when it still fails (the spare file is removed then).
export function writeAtomic(file, text, { fsx = fs, waits = RENAME_WAITS, sleep = pause } = {}) {
  const tmp = file + '.tmp';
  fsx.writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try { return fsx.renameSync(tmp, file); } catch (e) {
      if (i >= waits.length || !busyError(e)) { try { fsx.unlinkSync(tmp); } catch {} throw e; }
      sleep(waits[i]);
    }
  }
}

// A file saved a moment after each change (save), or at once (now). A failed save is logged once, the data stays in
// memory (text() is read again on each try) and it is tried again after a growing wait until it works; its success is
// logged too. Nothing here throws. flush: the exit-time write, best effort, only when a save is still waiting.
export function createSaver({ file, text, log = () => {}, delay = 200, waits = RETRY_WAITS, fsx = fs, sleep = pause, timers = globalThis }) {
  let timer = null, failures = 0, firstError = '';
  const name = path.basename(file);
  function schedule(ms) { timers.clearTimeout(timer); timer = timers.setTimeout(write, ms); }
  function write() {
    timers.clearTimeout(timer); timer = null;
    try {
      writeAtomic(file, text(), { fsx, sleep });
      if (failures) log(`saved ${name} again`, `after ${failures} failed ${failures === 1 ? 'try' : 'tries'} (${firstError})`);
      failures = 0;
      return true;
    } catch (e) {
      if (!failures) { firstError = e?.code || e?.message || String(e); log(`could not save ${name} (kept in memory, trying again)`, e?.stack || e); }
      failures++;
      schedule(waits[Math.min(failures - 1, waits.length - 1)]);
      return false;
    }
  }
  return {
    // While saves are failing, a change waits for the next try rather than trying sooner.
    save() { if (failures && timer) return; schedule(delay); },
    now: write,
    flush() { if (timer) write(); },
    pending: () => !!timer,
    failing: () => failures > 0,
  };
}
