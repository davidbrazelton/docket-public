// How long turns took, from the lines Docket writes to <data>/turn-times-YYYY-MM.jsonl at the end of each turn (#793):
// by hour of day and by how many sessions were working, with the model, tool and hook shares, the model's speed,
// the computer's CPU and Docket's event-loop delay.
//
//   node scripts/turn-report.mjs [--days N] [--data <folder>] [--hook-logs <folder>]
//
// --data is Docket's data folder (default: PORTAL_DATA, else data/ beside this script's folder). --hook-logs is a
// folder of a hook program's *.log files (read only) to count hook calls and deadline outcomes per hour; without it
// the folder named in docs/research/731-concurrency/hook-logs.txt is used when that file and folder exist.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLines, reportText, hookLogHours } from '../turn-times.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const days = Number(arg('--days')) || 14;
const dataDir = path.resolve(arg('--data') || process.env.PORTAL_DATA || path.join(ROOT, 'data'));
const since = Date.now() - days * 86400000;

let hookDir = arg('--hook-logs');
if (!hookDir) try { hookDir = fs.readFileSync(path.join(ROOT, 'docs/research/731-concurrency/hook-logs.txt'), 'utf8').trim(); } catch {}
let hookHours;
if (hookDir) try {
  hookHours = {};
  for (const f of fs.readdirSync(hookDir).filter((f) => f.endsWith('.log'))) hookLogHours(fs.readFileSync(path.join(hookDir, f), 'utf8'), since, hookHours);
} catch { hookHours = undefined; }

console.log(`# Turn times, last ${days} days (${dataDir})\n`);
process.stdout.write(reportText(readLines(dataDir, since), { days, hookHours }));
