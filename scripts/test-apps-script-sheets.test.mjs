import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const id = '50000000-0000-4000-8000-000000000001';
const day = '2026-11-03';
const values = Array.from({ length: 21 }, (_, i) => i === 20 ? id : i === 3 ? '=1+1' : String(i));
const job = { id, revision: '9007199254740993', sheet_name: day, values };

function fixture({ tab, initialRows, writeError = false, ackError = false, locked = false, jobs = [job] } = {}) {
  const writes = [], calls = [], sheets = new Map();
  const put = (name, rows) => {
    const sheet = {
      getName: () => name,
      getLastRow: () => rows.length,
      getMaxRows: () => 1000,
      getMaxColumns: () => 26,
      setFrozenRows() {},
    };
    sheets.set(name, { sheet, rows });
    return sheet;
  };
  if (tab) put(tab, initialRows || [[], [...values, 'manual']]);
  const spreadsheet = {
    getSheetByName: name => sheets.get(name)?.sheet || null,
    getSheets: () => [...sheets.values()].map(item => item.sheet),
    insertSheet: name => put(name, []),
  };
  const cellsFor = range => {
    const rows = sheets.get(range.split("'")[1])?.rows || [];
    if (range.endsWith('!A:A')) return rows.map(row => row[0] ? [row[0]] : []);
    if (range.endsWith('!U:U')) return rows.map(row => row[20] ? [row[20]] : []);
    const row = Number(range.match(/!A(\d+):U\d+$/)?.[1]);
    return rows[row - 1] ? [rows[row - 1].slice(0, 21)] : [];
  };
  const sandbox = vm.createContext({
    console: { warn() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({
      SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'publishable', SHEETS_SYNC_TOKEN: 'a'.repeat(64),
    }) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => !locked, releaseLock() {} }) },
    UrlFetchApp: { fetch(url, options) {
      const method = url.split('/').at(-1);
      const body = JSON.parse(options.payload);
      calls.push({ method, ...body });
      assert.equal(options.headers.apikey, 'publishable');
      const failure = ackError && method === 'finish_apps_script_sheet_job';
      return { getResponseCode: () => failure ? 503 : 200, getContentText: () => JSON.stringify(method === 'pull_apps_script_sheet_jobs' ? jobs : true) };
    } },
    SpreadsheetApp: { openById: () => spreadsheet, flush() {} },
    Sheets: { Spreadsheets: { Values: {
      get: (_id, range) => ({ values: cellsFor(range) }),
      batchGet: (_id, { ranges }) => ({ valueRanges: ranges.map(range => ({ values: cellsFor(range) })) }),
      update(resource, _id, range, options) {
        if (writeError) throw new Error('Temporary Sheets outage');
        writes.push({ range, rows: resource.values, option: options.valueInputOption });
        const [, name, row] = range.match(/^'([^']+)'!A(\d+):U\d+$/);
        const target = sheets.get(name).rows;
        target[Number(row) - 1] = [...resource.values[0], ...(target[Number(row) - 1] || []).slice(21)];
      },
    } } },
  });
  vm.runInContext(readFileSync('apps-script/sheets-sync/SheetSync.gs', 'utf8'), sandbox);
  return { writes, calls, sheets, run: () => vm.runInContext('syncPendingSheetJobs()', sandbox) };
}

test('Apps Script writes one RAW A:U row and acknowledges its original string revision', () => {
  const f = fixture();
  assert.equal(f.run().written, 1);
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[1].range, `'${day}'!A2:U2`);
  assert.equal(f.writes[1].option, 'RAW');
  assert.equal(f.writes[1].rows[0][3], '=1+1');
  assert.equal(f.calls[1].p_revision, job.revision);
  assert.equal(f.calls[1].p_success, true);
});

test('Apps Script updates a moved row by recipient ID without overwriting column V', () => {
  const f = fixture({ tab: '2026-11-01' });
  assert.equal(f.run().written, 1);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].range, "'2026-11-01'!A2:U2");
  assert.equal(f.sheets.get('2026-11-01').rows[1][21], 'manual');
  assert.equal(f.sheets.has(day), false);
});

test('a failed acknowledgment retries the same row without appending a duplicate', () => {
  const f = fixture({ ackError: true });
  assert.throws(() => f.run(), /503/);
  assert.throws(() => f.run(), /503/);
  assert.deepEqual(f.writes.map(write => write.range), [`'${day}'!A1:U1`, `'${day}'!A2:U2`, `'${day}'!A2:U2`]);
});

test('failed Sheets writes stay pending and a second worker cannot pull concurrently', () => {
  const failed = fixture({ writeError: true });
  assert.equal(failed.run().failed, 1);
  assert.equal(failed.calls[1].p_success, false);
  const locked = fixture({ locked: true });
  assert.equal(locked.run().skipped, true);
  assert.equal(locked.calls.length, 0);
});

test('an ambiguous write error stops the batch before another row can reuse its position', () => {
  const secondId = '50000000-0000-4000-8000-000000000002';
  const f = fixture({ writeError: true, jobs: [job, { ...job, id: secondId, values: [...values.slice(0, 20), secondId] }] });
  assert.equal(f.run().failed, 1);
  assert.deepEqual(f.calls.slice(1).map(call => call.p_id), [id]);
});

test('a single matching legacy row without U is updated in place', () => {
  const legacy = [...values.slice(0, 20), '', 'manual'];
  const f = fixture({ tab: '2026-11-01', initialRows: [[], legacy], jobs: [{ ...job, single_recipient: true }] });
  assert.equal(f.run().written, 1);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].range, "'2026-11-01'!A2:U2");
  assert.equal(f.sheets.get('2026-11-01').rows[1][21], 'manual');
});

test('ambiguous legacy rows stay pending without adding or changing rows', () => {
  const legacy = [...values.slice(0, 20), ''];
  const f = fixture({ tab: day, initialRows: [[], legacy, legacy], jobs: [{ ...job, single_recipient: true }] });
  assert.equal(f.run().failed, 1);
  assert.equal(f.writes.length, 0);
  assert.equal(f.calls[1].p_success, false);
});
