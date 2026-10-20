import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './test-support/load-module.mjs';

function responseJson(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeRows() {
  const displayNos = ['2026-09/135', '2026-09/143', ...Array.from({ length: 22 }, (_, index) => `2026-09/${200 + index}`)];
  const documents = displayNos.map((displayNo, index) => ({
    id: `document-${index + 1}`,
    displayNo,
    received_date: '2026-09-05',
    doc_number: `DOC-${index + 1}`,
    sender: 'ผู้ส่ง',
    subject: 'เอกสารทดสอบ',
    is_damaged: false,
    damage_image_url: null,
    note: null,
    recorded_by: 'profile-1',
    tax_invoice_no: null,
  }));
  const recipients = documents.map((document, index) => ({
    id: `recipient-${index + 1}`,
    document_id: document.id,
    department_id: 'department-1',
    status: index === 1 ? 'delivered' : 'closed',
    admin_signature: null,
    admin_signed_at: null,
    updated_at: '2026-09-09T00:00:00.000Z',
  }));
  return { documents, recipients };
}

function fixture({ referenceIdFor143 = '2026-09/128', locked = false, duplicateFirstReference = false, deliveries = [], lookupError = null } = {}) {
  const { documents, recipients } = makeRows();
  const calls = { normalized: [], updates: [], appends: [], locks: [], reads: [] };
  const legacyRows = [
    ['เลขที่รับเข้า'],
    ['2026-09/135', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', recipients[0].id],
    ['2026-09/143', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', referenceIdFor143],
  ];
  if (duplicateFirstReference) {
    legacyRows.push(['2026-09/135', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', recipients[0].id]);
  }
  const supabase = {
    rpc(name, args) {
      calls.locks.push({ name, args });
      if (name === 'try_acquire_sheet_backfill_lock') return Promise.resolve({ data: !locked, error: null });
      if (name === 'release_sheet_backfill_lock') return Promise.resolve({ data: true, error: null });
      throw new Error(`Unexpected RPC: ${name}`);
    },
    from(table) {
      const query = {
        select() { return query; },
        order() { return query; },
        range() {
          if (table === 'documents') return Promise.resolve({ data: documents, error: null });
          if (table === 'document_recipients') return Promise.resolve({ data: recipients, error: null });
          if (table === 'delivery_logs') return Promise.resolve({ data: deliveries, error: null });
          throw new Error(`Unexpected range table: ${table}`);
        },
        in() {
          if (table === 'departments') return Promise.resolve({ data: [{ id: 'department-1', name: 'ACC/บัญชี' }], error: lookupError });
          if (table === 'profiles') return Promise.resolve({ data: [{ id: 'profile-1', full_name: 'ผู้บันทึก' }], error: null });
          throw new Error(`Unexpected in table: ${table}`);
        },
      };
      return query;
    },
  };
  const route = loadModule('src/app/api/admin/backfill-sheets/route.ts', {
    'next/server': { NextResponse: { json: responseJson } },
    '@/lib/supabase/admin': { getServiceSupabase: () => supabase },
    '@/lib/supabase/auth-helpers': { requireRoles: async () => ({ context: {}, response: null }) },
    '@/lib/google-sheets': {
      HEADERS: ['เลขที่รับเข้า', 'วันที่รับ'],
      listSheetTabs: async () => ['2026-09-05'],
      ensureDailySheetReady: async (date) => { calls.normalized.push(date); },
      getSheetValuesBatch: async (sheets) => {
        calls.reads.push(sheets);
        return new Map(sheets.map((sheet) => [sheet, legacyRows]));
      },
      batchUpdateRowsOrThrow: async (sheet, updates) => { calls.updates.push({ sheet, updates }); },
      appendRowsOrThrow: async (sheet, rows) => { calls.appends.push({ sheet, rows }); },
      getSpreadsheetUrl: async () => 'https://example.invalid/sheet',
    },
    '@/lib/document-no': { documentNo: (document) => document.displayNo },
  });
  return { calls, route, recipients };
}

test('backfill refuses a second concurrent run before reading or writing Sheets', async () => {
  const f = fixture({ locked: true });

  const response = await f.route.GET();
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.success, false);
  assert.equal(f.calls.locks.length, 1);
  assert.equal(f.calls.locks[0].name, 'try_acquire_sheet_backfill_lock');
  assert.deepEqual(f.calls.normalized, []);
  assert.deepEqual(f.calls.updates, []);
  assert.deepEqual(f.calls.appends, []);
});

test('backfill omits an old rejected signature after redelivery', async () => {
  const f = fixture({ deliveries: [{ document_recipient_id: 'recipient-2', recipient_id: 'profile-1', recipient_signature: 'ชื่อรอบเก่า', recipient_signed_at: '2026-09-01', is_verified: false }] });
  assert.equal((await f.route.GET()).status, 200);
  const row = f.calls.updates.flatMap((call) => call.updates).find((update) => update.values[20] === 'recipient-2').values;
  assert.deepEqual(Array.from(row.slice(9, 14)), ['', '', '', '', '']);
});

test('backfill stops when a department lookup fails instead of overwriting names with blanks', async () => {
  const f = fixture({ lookupError: { message: 'department lookup unavailable' } });
  assert.equal((await f.route.GET()).status, 500);
  assert.equal(f.calls.updates.length, 0);
  assert.equal(f.calls.appends.length, 0);
});

test('backfill reuses a row with an invalid reference instead of appending a duplicate', async () => {
  const f = fixture();

  const response = await f.route.GET();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(f.calls.normalized, ['2026-09-05']);
  assert.equal(f.calls.updates.length, 1);
  assert.equal(f.calls.updates[0].sheet, '2026-09-05');
  assert.deepEqual(
    JSON.parse(JSON.stringify(f.calls.updates[0].updates)).map((update) => ({ row: update.row, referenceId: update.values[20] })),
    [
      { row: 2, referenceId: f.recipients[0].id },
      { row: 3, referenceId: f.recipients[1].id },
    ],
  );
  assert.equal(f.calls.appends.length, 1);
  assert.equal(f.calls.appends[0].sheet, '2026-09-05');
  assert.equal(f.calls.appends[0].rows.length, 22);
  assert.equal(body.updated, 2);
  assert.equal(body.appended, 22);
});

test('backfill never overwrites a row when its valid reference belongs to another document', async () => {
  const f = fixture({ referenceIdFor143: 'recipient-3' });

  const response = await f.route.GET();
  const body = await response.json();
  const updates = JSON.parse(JSON.stringify(f.calls.updates[0].updates));
  const appendedReferences = JSON.parse(JSON.stringify(f.calls.appends[0].rows)).map((row) => row[20]);

  assert.equal(response.status, 200);
  assert.deepEqual(updates.map((update) => ({ row: update.row, referenceId: update.values[20] })), [
    { row: 2, referenceId: f.recipients[0].id },
  ]);
  assert.equal(f.calls.appends[0].rows.length, 23);
  assert.equal(appendedReferences.includes(f.recipients[1].id), true);
  assert.equal(appendedReferences.includes(f.recipients[2].id), true);
  assert.equal(body.updated, 1);
  assert.equal(body.appended, 23);
});

test('backfill updates every canonical duplicate and reports the duplicate reference', async () => {
  const f = fixture({ duplicateFirstReference: true });

  const response = await f.route.GET();
  const body = await response.json();
  const updates = JSON.parse(JSON.stringify(f.calls.updates[0].updates));

  assert.equal(response.status, 200);
  assert.equal(body.duplicateReferences, 1);
  assert.equal(updates.filter((update) => update.values[20] === f.recipients[0].id).length, 2);
});
