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
        const properties = requestBody.requests[0].addSheet.properties;
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
        async update() { return { data: {} }; },
        async append({ range }) { appendRanges.push(range); return { data: {} }; },
      },
    },
  };
  return { client, tabs, appendRanges };
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

  await sheets.appendRowsOrThrow('2026-09-03', [['historical']]);

  assert.deepEqual(fixture.appendRanges, ['2026-09-03!A:U']);
});

test('row sync updates an existing reference and restores a missing row', async () => {
  const existingReference = 'existing-reference';
  const updateRanges = [];
  const appendRanges = [];
  const client = {
    spreadsheets: {
      async get() {
        return { data: { sheets: [{ properties: { sheetId: 123, title: '2026-09-03', index: 0 } }] } };
      },
      values: {
        async get() {
          return { data: { values: [[], [...Array(20).fill(''), existingReference]] } };
        },
        async update({ range }) { updateRanges.push(range); return { data: {} }; },
        async append({ range }) { appendRanges.push(range); return { data: {} }; },
      },
    },
  };
  const sheets = loadModule(client);

  await sheets.syncRowInSheet('2026-09-03', [...Array(20).fill(''), existingReference]);
  await sheets.syncRowInSheet('2026-09-03', [...Array(20).fill(''), 'missing-reference']);

  assert.deepEqual(updateRanges, ['2026-09-03!A2:U2']);
  assert.deepEqual(appendRanges, ['2026-09-03!A:U']);
});
