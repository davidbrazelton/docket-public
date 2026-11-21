// Excel workbooks in the file preview (#1016): read on this computer, values as Excel shows them, big sheets cut short.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { sheetsOf, readWorkbook, SHEET_EXT, MAX_ROWS, MAX_COLS } from '../workbook.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-workbook-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function workbook(bigRows = MAX_ROWS + 500) {
  const data = XLSX.utils.aoa_to_sheet([['Name', 'Amount', 'When'], ['Pat', 1234.5, new Date(2026, 0, 5)]], { cellDates: true, dateNF: 'yyyy-mm-dd' });
  data.B2.z = '#,##0.00';
  data.D2 = { t: 'n', f: 'B2*2', v: 2469 }; // a formula with its saved result
  data['!ref'] = 'A1:D2';
  const big = XLSX.utils.aoa_to_sheet(Array.from({ length: bigRows }, (_, r) => Array.from({ length: MAX_COLS + 20 }, (_, c) => r + c)));
  const offset = { C3: { t: 's', v: 'x' }, '!ref': 'C3:C3' };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, data, 'Data');
  XLSX.utils.book_append_sheet(wb, big, 'Big');
  XLSX.utils.book_append_sheet(wb, offset, 'Offset');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Empty');
  wb.Workbook = { Sheets: [{}, {}, {}, { Hidden: 1 }] };
  return wb;
}

test('every sheet, in order, with values as Excel shows them and formulas as their saved results', () => {
  const sheets = sheetsOf(XLSX.write(workbook(), { type: 'buffer', bookType: 'xlsx' }));
  assert.deepEqual(sheets.map((s) => s.name), ['Data', 'Big', 'Offset', 'Empty']);
  assert.deepEqual(sheets[0].rows, [['Name', 'Amount', 'When', ''], ['Pat', '1,234.50', '2026-01-05', '2469']]);
  assert.equal(sheets[0].totalRows, 2);
  assert.deepEqual(sheets.map((s) => s.hidden), [false, false, false, true]);
});

test('a big sheet is cut to its first rows and columns, and says how big it is', () => {
  const big = sheetsOf(XLSX.write(workbook(), { type: 'buffer', bookType: 'xlsx' }))[1];
  assert.equal(big.rows.length, MAX_ROWS);
  assert.equal(big.rows[0].length, MAX_COLS);
  assert.equal(big.totalRows, MAX_ROWS + 500);
  assert.equal(big.totalCols, MAX_COLS + 20);
  assert.equal(big.rows[999][99], String(999 + 99));
});

test('a sheet that starts away from A1 says where, and an empty sheet has no rows', () => {
  const [, , offset, empty] = sheetsOf(XLSX.write(workbook(), { type: 'buffer', bookType: 'xlsx' }));
  assert.deepEqual([offset.row, offset.col, offset.rows], [2, 2, [['x']]]);
  assert.deepEqual(empty.rows, []);
});

test('.xls and .xlsm read in a worker thread too', async () => {
  for (const [ext, bookType] of [['xls', 'biff8'], ['xlsm', 'xlsm'], ['xlsx', 'xlsx']]) {
    const file = path.join(dir, `book.${ext}`);
    fs.writeFileSync(file, XLSX.write(workbook(50), { type: 'buffer', bookType }));
    const sheets = await readWorkbook(file, { rows: 20 });
    assert.equal(sheets[0].rows[1][0], 'Pat', ext);
    assert.deepEqual([sheets[1].rows.length, sheets[1].totalRows], [20, 50], ext);
  }
});

test('a file that is not a workbook gives a plain error, not a crash', async () => {
  const file = path.join(dir, 'broken.xlsx');
  fs.writeFileSync(file, Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]));
  await assert.rejects(readWorkbook(file), /Could not read this workbook/);
});

test('the page, the tab of its own and the server agree on which files show as workbooks', () => {
  const root = path.join(import.meta.dirname, '..');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8'), view = fs.readFileSync(path.join(root, 'view.html'), 'utf8');
  const tabView = new RegExp(index.match(/const TAB_VIEW = \/(.+)\/i;/)[1], 'i'), shows = new RegExp(view.match(/const SHOWS = \/(.+)\/i;/)[1], 'i');
  for (const ext of SHEET_EXT) {
    assert.ok(tabView.test(`a.${ext}`), `TAB_VIEW shows .${ext}`);
    assert.ok(shows.test(`a.${ext}`), `view.html shows .${ext}`);
  }
  assert.equal(tabView.source, shows.source);
});
