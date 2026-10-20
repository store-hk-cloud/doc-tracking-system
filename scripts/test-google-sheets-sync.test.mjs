import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { ModuleKind, transpileModule } from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync('src/lib/google-sheets.ts', 'utf8');
const output = transpileModule(source, {
  compilerOptions: { module: ModuleKind.CommonJS, target: 99 },
}).outputText;

function loadModule(client) {
  // fixture รุ่นเดิมจำลองการอ่านทีละแท็บ ให้ batchGet ใช้ข้อมูลชุดเดียวกัน
  const values = client.spreadsheets.values;
  if (values?.get && !values.batchGet) {
    values.batchGet = async ({ ranges }) => ({ data: { valueRanges: await Promise.all(
      ranges.map(async (range) => (await values.get({ range })).data),
    ) } });
  }
  const exports = {};
  vm.runInNewContext(output, {
    exports,
    console,
    process,
    setTimeout,
    clearTimeout,
    require(name) {
      if (name === './google-auth') return { getSheetsClient: () => client };
      if (name === './thai-date') return { bangkokDate: () => '2026-09-10' };
      return require(name);
    },
  });
  return exports;
}

function concurrentCreateFixture(requiredFirstReads = 2) {
  const tabs = [];
  const appendRanges = [];
  const headersBySheet = new Map();
  let firstReads = 0;
  let releaseFirstReads;
  const firstReadsDone = new Promise((resolve) => { releaseFirstReads = resolve; });

  const client = {
    spreadsheets: {
      async get() {
        if (firstReads < requiredFirstReads) {
          const snapshot = tabs.map((tab) => ({ properties: { ...tab } }));
          firstReads += 1;
          if (firstReads === requiredFirstReads) releaseFirstReads();
          await firstReadsDone;
          return { data: { sheets: snapshot } };
        }
        return { data: { sheets: tabs.map((tab) => ({ properties: { ...tab } })) } };
      },
      async batchUpdate({ requestBody }) {
        const addSheet = requestBody.requests.find((request) => request.addSheet)?.addSheet;
        if (!addSheet) return { data: {} };
        const properties = addSheet.properties;
        if (tabs.some((tab) => tab.sheetId === properties.sheetId)) {
          const error = new Error('sheet id already exists');
          error.code = 400;
          throw error;
        }
        const title = tabs.some((tab) => tab.title === properties.title)
          ? `${properties.title}_conflict${properties.sheetId ?? 1}`
          : properties.title;
        tabs.push({ ...properties, title });
        return { data: {} };
      },
      values: {
        async get({ range }) {
          const [sheet] = range.split('!');
          const header = headersBySheet.get(sheet);
          return { data: { values: header ? [header] : [] } };
        },
        async update() { return { data: {} }; },
        async append({ range }) { appendRanges.push(range); return { data: {} }; },
      },
    },
  };
  return { client, tabs, appendRanges, headersBySheet };
}

test('cold serverless instances create only one deterministic daily tab', async () => {
  const fixture = concurrentCreateFixture();
  const first = loadModule(fixture.client);
  const second = loadModule(fixture.client);

  await Promise.all([
    first.appendRowsOrThrow('เอกสารเข้า', [['first']]),
    second.appendRowsOrThrow('เอกสารเข้า', [['second']]),
  ]);

  assert.deepEqual(fixture.tabs.map((tab) => ({ sheetId: tab.sheetId, title: tab.title })), [
    { sheetId: 20260910, title: '2026-09-10' },
  ]);
  assert.deepEqual(fixture.appendRanges, ['2026-09-10!A:U', '2026-09-10!A:U']);
});

test('repair append honors an explicit historical daily tab', async () => {
  const fixture = concurrentCreateFixture(1);
  fixture.tabs.push({ sheetId: 123, title: '2026-09-03', index: 0 });
  const sheets = loadModule(fixture.client);
  fixture.headersBySheet.set('2026-09-03', sheets.HEADERS);

  await sheets.appendRowsOrThrow('2026-09-03', [['historical']]);

  assert.deepEqual(fixture.appendRanges, ['2026-09-03!A:U']);
});

test('bulk daily reads use one batch request and preserve each tab mapping', async () => {
  const batchGetCalls = [];
  const client = {
    spreadsheets: {
      values: {
        async batchGet(call) {
          batchGetCalls.push(call);
          return {
            data: {
              valueRanges: [
                { values: [['header-03'], ['row-03']] },
                { values: [['header-05'], ['row-05']] },
              ],
            },
          };
        },
      },
    },
  };
  const sheets = loadModule(client);

  const rows = await sheets.getSheetValuesBatch(['2026-09-03', '2026-09-05']);

  assert.equal(batchGetCalls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(batchGetCalls[0].ranges)), ['2026-09-03!A:U', '2026-09-05!A:U']);
  assert.deepEqual(rows.get('2026-09-03'), [['header-03'], ['row-03']]);
  assert.deepEqual(rows.get('2026-09-05'), [['header-05'], ['row-05']]);
});

test('row lookup finds an existing recipient from one batched daily-tab read', async () => {
  const reference = 'recipient-in-old-tab';
  const batchGetCalls = [];
  const updateRanges = [];
  const appendRanges = [];
  const client = {
    spreadsheets: {
      async get() {
        return {
          data: {
            sheets: [
              { properties: { sheetId: 123, title: '2026-09-03', index: 0 } },
              { properties: { sheetId: 124, title: '2026-09-05', index: 1 } },
            ],
          },
        };
      },
      values: {
        async batchGet(call) {
          batchGetCalls.push(call);
          return {
            data: {
              valueRanges: [
                { values: [headers, [...Array(20).fill(''), reference]] },
                { values: [headers] },
              ],
            },
          };
        },
        async get() {
          throw new Error('row lookup must not issue a request per daily tab');
        },
        async update({ range }) { updateRanges.push(range); return { data: {} }; },
        async append({ range }) { appendRanges.push(range); return { data: {} }; },
      },
    },
  };
  let headers = [];
  const sheets = loadModule(client);
  headers = sheets.HEADERS;

  await sheets.syncRowInSheet('2026-09-05', [...Array(20).fill(''), reference]);

  assert.deepEqual(updateRanges, ['2026-09-03!A2:U2']);
  assert.deepEqual(appendRanges, []);
  assert.equal(batchGetCalls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(batchGetCalls[0].ranges)), ['2026-09-03!A:U', '2026-09-05!A:U']);
});

test('row sync updates an existing reference and restores a missing row', async () => {
  const existingReference = 'existing-reference';
  const updateRanges = [];
  const appendRanges = [];
  let headers = [];
  const client = {
    spreadsheets: {
      async get() {
        return { data: { sheets: [{ properties: { sheetId: 123, title: '2026-09-03', index: 0 } }] } };
      },
      values: {
        async get({ range }) {
          if (range.endsWith('A1:U1')) return { data: { values: [headers] } };
          return { data: { values: [headers, [...Array(20).fill(''), existingReference]] } };
        },
        async update({ range }) { updateRanges.push(range); return { data: {} }; },
        async append({ range }) { appendRanges.push(range); return { data: {} }; },
      },
    },
  };
  const sheets = loadModule(client);
  headers = sheets.HEADERS;

  await sheets.syncRowInSheet('2026-09-03', [...Array(20).fill(''), existingReference]);
  await sheets.syncRowInSheet('2026-09-03', [...Array(20).fill(''), 'missing-reference']);

  assert.deepEqual(updateRanges, ['2026-09-03!A2:U2']);
  assert.deepEqual(appendRanges, ['2026-09-03!A:U']);
});

test('row sync does not append when the reference lookup fails', async () => {
  const appendRanges = [];
  const client = {
    spreadsheets: {
      async get() {
        return { data: { sheets: [{ properties: { sheetId: 123, title: '2026-09-03', index: 0 } }] } };
      },
      values: {
        async get() {
          const error = new Error('temporary lookup failure');
          error.code = 400;
          throw error;
        },
        async update() { return { data: {} }; },
        async append({ range }) { appendRanges.push(range); return { data: {} }; },
      },
    },
  };
  const sheets = loadModule(client);

  await sheets.syncRowInSheet('2026-09-03', [...Array(20).fill(''), 'existing-reference']);

  assert.deepEqual(appendRanges, []);
});

test('concurrent syncs for one reference append once then update the same row', async () => {
  const reference = 'recipient-reference';
  const appendCalls = [];
  const updateCalls = [];
  let headers = [];
  let rows = [];
  const client = {
    spreadsheets: {
      async get() {
        return { data: { sheets: [{ properties: { sheetId: 123, title: '2026-09-03', index: 0 } }] } };
      },
      values: {
        async get({ range }) {
          return { data: { values: range.endsWith('A1:U1') ? [rows[0]] : rows } };
        },
        async update(call) { updateCalls.push(call); return { data: {} }; },
        async append(call) {
          appendCalls.push(call);
          rows.push(...call.requestBody.values);
          return { data: {} };
        },
      },
    },
  };
  const sheets = loadModule(client);
  headers = sheets.HEADERS;
  rows = [headers];

  await Promise.all([
    sheets.syncRowInSheet('2026-09-03', [...Array(6).fill(''), 'delivered', ...Array(13).fill(''), reference]),
    sheets.syncRowInSheet('2026-09-03', [...Array(6).fill(''), 'closed', ...Array(13).fill(''), reference]),
  ]);

  assert.equal(appendCalls.length, 1);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].requestBody.values[0][6], 'closed');
});

test('every Sheets write stores user-supplied values as raw text', async () => {
  const writes = [];
  const tabs = [];
  const client = {
    spreadsheets: {
      async get() {
        return { data: { sheets: tabs.map((properties) => ({ properties })) } };
      },
      async batchUpdate({ requestBody }) {
        tabs.push(requestBody.requests[0].addSheet.properties);
        return { data: {} };
      },
      values: {
        async get() { return { data: { values: [] } }; },
        async update(call) { writes.push({ kind: 'update', ...call }); return { data: {} }; },
        async append(call) { writes.push({ kind: 'append', ...call }); return { data: {} }; },
        async batchUpdate(call) { writes.push({ kind: 'batchUpdate', ...call }); return { data: {} }; },
      },
    },
  };
  const sheets = loadModule(client);

  await sheets.appendRowsOrThrow('2026-09-03', [['=HYPERLINK("https://evil.invalid")']]);
  await sheets.updateRowInSheetOrThrow('2026-09-03', 2, [['@payload']]);
  await sheets.batchUpdateRowsOrThrow('2026-09-03', [{ row: 3, values: ['+payload'] }]);

  assert.deepEqual(
    writes.map((write) => write.valueInputOption ?? write.requestBody?.valueInputOption),
    ['RAW', 'RAW', 'RAW', 'RAW']
  );
});

test('row sync ignores a legacy conflict tab instead of updating its duplicate row', async () => {
  const updateRanges = [];
  const appendRanges = [];
  const reference = 'reference-only-in-conflict-tab';
  let headers = [];
  const client = {
    spreadsheets: {
      async get() {
        return {
          data: {
            sheets: [
              { properties: { sheetId: 123, title: '2026-09-03', index: 0 } },
              { properties: { sheetId: 124, title: '2026-09-03_conflict124', index: 1 } },
            ],
          },
        };
      },
      values: {
        async get({ range }) {
          if (range.startsWith('2026-09-03!')) return { data: { values: [headers] } };
          if (range.startsWith('2026-09-03_conflict124!')) {
            return { data: { values: [headers, [...Array(20).fill(''), reference]] } };
          }
          return { data: { values: [headers] } };
        },
        async update({ range }) { updateRanges.push(range); return { data: {} }; },
        async append({ range }) { appendRanges.push(range); return { data: {} }; },
      },
    },
  };
  const sheets = loadModule(client);
  headers = sheets.HEADERS;

  await sheets.syncRowInSheet('2026-09-03', [...Array(20).fill(''), reference]);

  assert.deepEqual(updateRanges, []);
  assert.deepEqual(appendRanges, ['2026-09-03!A:U']);
});

test('controlled backfill shifts a first document row and writes its header atomically', async () => {
  const calls = [];
  const firstDocumentRow = ['2026-09/135', '2026-09-05', 'STK-INS-IH6908-0035'];
  const client = {
    spreadsheets: {
      async get() {
        return { data: { sheets: [{ properties: { sheetId: 123, title: '2026-09-05', index: 0 } }] } };
      },
      async batchUpdate(call) { calls.push({ kind: 'batchUpdate', ...call }); return { data: {} }; },
      values: {
        async get() {
          return { data: { values: [firstDocumentRow] } };
        },
        async update(call) { calls.push({ kind: 'update', ...call }); return { data: {} }; },
        async append(call) { calls.push({ kind: 'append', ...call }); return { data: {} }; },
      },
    },
  };
  let headers = [];
  const sheets = loadModule(client);
  headers = sheets.HEADERS;

  await Promise.all([
    sheets.ensureDailySheetReady('2026-09-05'),
    sheets.ensureDailySheetReady('2026-09-05'),
  ]);

  assert.deepEqual(calls.map((call) => call.kind), ['batchUpdate']);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].requestBody.requests)), JSON.parse(JSON.stringify([
    {
      insertDimension: {
        range: { sheetId: 123, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        inheritFromBefore: false,
      },
    },
    {
      updateCells: {
        start: { sheetId: 123, rowIndex: 0, columnIndex: 0 },
        rows: [{
          values: headers.map((header) => ({ userEnteredValue: { stringValue: header } })),
        }],
        fields: 'userEnteredValue',
      },
    },
  ])));
});

test('row lookup rebuilds after a concurrent header repair shifts a cached row', async () => {
  const reference = 'recipient-reference';
  const documentRow = [...Array(20).fill(''), reference];
  const updateRanges = [];
  let headers = [];
  let rows = [documentRow];
  let batchReads = 0;
  let beginFirstRead;
  let releaseFirstRead;
  const firstReadBegun = new Promise((resolve) => { beginFirstRead = resolve; });
  const firstReadReleased = new Promise((resolve) => { releaseFirstRead = resolve; });
  const client = {
    spreadsheets: {
      async get() {
        return { data: { sheets: [{ properties: { sheetId: 123, title: '2026-09-05', index: 0 } }] } };
      },
      async batchUpdate(call) {
        if (call.requestBody.requests.some((request) => request.insertDimension)) {
          rows = [headers, ...rows];
        }
        return { data: {} };
      },
      values: {
        async get() { return { data: { values: [rows[0]] } }; },
        async batchGet() {
          const snapshot = rows.map((row) => [...row]);
          batchReads += 1;
          if (batchReads === 1) {
            beginFirstRead();
            await firstReadReleased;
          }
          return { data: { valueRanges: [{ values: snapshot }] } };
        },
        async update({ range }) { updateRanges.push(range); return { data: {} }; },
        async append() { return { data: {} }; },
      },
    },
  };
  const sheets = loadModule(client);
  headers = sheets.HEADERS;

  const syncing = sheets.syncRowInSheet('2026-09-05', [...documentRow]);
  await firstReadBegun;
  await sheets.ensureDailySheetReady('2026-09-05');
  releaseFirstRead();
  await syncing;

  assert.equal(batchReads, 2);
  assert.deepEqual(updateRanges, ['2026-09-05!A2:U2']);
});

test('operational row sync updates a headerless first document row without shifting it', async () => {
  const calls = [];
  const reference = 'recipient-reference';
  const documentRow = [...Array(20).fill(''), reference];
  const client = {
    spreadsheets: {
      async get() {
        return { data: { sheets: [{ properties: { sheetId: 123, title: '2026-09-05', index: 0 } }] } };
      },
      async batchUpdate(call) { calls.push({ kind: 'batchUpdate', ...call }); return { data: {} }; },
      values: {
        async get() {
          return { data: { values: [documentRow] } };
        },
        async update(call) { calls.push({ kind: 'update', ...call }); return { data: {} }; },
        async append(call) { calls.push({ kind: 'append', ...call }); return { data: {} }; },
      },
    },
  };
  const sheets = loadModule(client);

  await sheets.syncRowInSheet('2026-09-05', [...documentRow]);

  assert.deepEqual(calls.map((call) => call.kind), ['update']);
  assert.equal(calls[0].range, '2026-09-05!A1:U1');
});

test('ordinary append does not shift a legacy headerless tab', async () => {
  const calls = [];
  const firstDocumentRow = ['2026-09/135', '2026-09-05'];
  const client = {
    spreadsheets: {
      async get() {
        return { data: { sheets: [{ properties: { sheetId: 123, title: '2026-09-05', index: 0 } }] } };
      },
      async batchUpdate(call) { calls.push({ kind: 'batchUpdate', ...call }); return { data: {} }; },
      values: {
        async get() { return { data: { values: [firstDocumentRow] } }; },
        async update(call) { calls.push({ kind: 'update', ...call }); return { data: {} }; },
        async append(call) { calls.push({ kind: 'append', ...call }); return { data: {} }; },
      },
    },
  };
  const sheets = loadModule(client);

  await sheets.appendRowsOrThrow('2026-09-05', [['new document']]);

  assert.deepEqual(calls.map((call) => call.kind), ['append']);
});

test('an existing daily header is not shifted or rewritten', async () => {
  const calls = [];
  let headers = [];
  const client = {
    spreadsheets: {
      async get() {
        return { data: { sheets: [{ properties: { sheetId: 123, title: '2026-09-05', index: 0 } }] } };
      },
      async batchUpdate(call) { calls.push({ kind: 'batchUpdate', ...call }); return { data: {} }; },
      values: {
        async get() { return { data: { values: [headers] } }; },
        async update(call) { calls.push({ kind: 'update', ...call }); return { data: {} }; },
        async append(call) { calls.push({ kind: 'append', ...call }); return { data: {} }; },
      },
    },
  };
  const sheets = loadModule(client);
  headers = sheets.HEADERS;

  await sheets.appendRowsOrThrow('2026-09-05', [['new document']]);

  assert.deepEqual(calls.map((call) => call.kind), ['append']);
});
