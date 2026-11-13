// Excel workbooks (.xlsx, .xls, .xlsm) as tables for the file preview (#1016), read on this computer with
// SheetJS Community Edition (Apache 2.0); nothing is sent anywhere. Reading runs in a worker thread, so a
// big workbook never holds up the app, and each sheet is cut to its first rows and columns.
import fs from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import * as XLSX from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel.full.mjs';

XLSX.set_cptable(cptable); // older .xls files written in other code pages
export const MAX_ROWS = 1000, MAX_COLS = 100;
export const SHEET_EXT = new Set(['xlsx', 'xls', 'xlsm']);

// Each sheet: its name, whether Excel hides it, where its used range starts (0-based row and column),
// how many rows and columns it has in all, and its first rows and columns as Excel shows them
// (number and date formats applied, formulas as their saved results).
export function sheetsOf(buf, { rows = MAX_ROWS, cols = MAX_COLS } = {}) {
  const wb = XLSX.read(buf, { type: 'buffer', sheetRows: rows, cellFormula: false, cellHTML: false, cellStyles: false });
  return wb.SheetNames.map((name, i) => {
    const ws = wb.Sheets[name], hidden = !!wb.Workbook?.Sheets?.[i]?.Hidden;
    if (!ws?.['!ref']) return { name, hidden, row: 0, col: 0, totalRows: 0, totalCols: 0, rows: [] }; // empty, or a chart sheet
    const full = XLSX.utils.decode_range(ws['!fullref'] || ws['!ref']), range = XLSX.utils.decode_range(ws['!ref']);
    range.e.c = Math.min(range.e.c, range.s.c + cols - 1);
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true, range });
    return { name, hidden, row: range.s.r, col: range.s.c, totalRows: full.e.r - full.s.r + 1, totalCols: full.e.c - full.s.c + 1,
      rows: data.map((r) => r.map((v) => String(v))) };
  });
}

// The workbook at `file`, read in a worker thread; gives up after `ms`.
export function readWorkbook(file, { ms = 30000, ...opts } = {}) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { workbook: file, opts } });
    const timer = setTimeout(() => { w.terminate(); reject(new Error('That workbook took too long to read')); }, ms);
    w.once('message', (m) => { clearTimeout(timer); w.terminate(); m.error ? reject(new Error(m.error)) : resolve(m.sheets); });
    w.once('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

if (!isMainThread && workerData?.workbook) {
  try { parentPort.postMessage({ sheets: sheetsOf(fs.readFileSync(workerData.workbook), workerData.opts) }); }
  catch (e) { parentPort.postMessage({ error: /password|encrypt/i.test(e.message) ? 'This workbook is password-protected, so it does not preview here' : `Could not read this workbook: ${e.message}` }); }
}
