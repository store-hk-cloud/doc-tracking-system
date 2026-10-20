import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './test-support/load-module.mjs';

function createFixture({ locked = false, rowExists = false } = {}) {
  const calls = { locks: [], releases: [], updates: [], appends: [], deletes: [] };
  const job = { document_recipient_id: 'recipient-1', revision: 'revision-1' };
  const recipient = {
    id: 'recipient-1', document_id: 'document-1', department_id: 'department-1',
    status: 'closed', admin_signature: 'admin', admin_signed_at: '2026-09-09T01:00:00Z',
  };
  const document = {
    id: 'document-1', display_no: '2026-09/001', received_date: '2026-09-09',
    doc_number: 'DOC-1', sender: 'ผู้ส่ง', subject: 'เอกสารทดสอบ',
    is_damaged: false, damage_image_url: null, note: null, recorded_by: 'profile-1', tax_invoice_no: null,
  };
  const supabase = {
    rpc(name, args) {
      calls.locks.push({ name, args });
      if (name === 'try_acquire_sheet_write_lock') return Promise.resolve({ data: !locked, error: null });
      if (name === 'release_sheet_write_lock') {
        calls.releases.push(args);
        return Promise.resolve({ data: true, error: null });
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
    from(table) {
      const query = {
        select() { return query; },
        order() { return query; },
        limit() {
          if (table === 'google_sheets_sync_queue') return Promise.resolve({ data: [job], error: null });
          throw new Error(`Unexpected limit table: ${table}`);
        },
        in(column) {
          if (table === 'document_recipients' && column === 'id') return Promise.resolve({ data: [recipient], error: null });
          if (table === 'documents' && column === 'id') return Promise.resolve({ data: [document], error: null });
          if (table === 'departments' && column === 'id') return Promise.resolve({ data: [{ id: 'department-1', name: 'ACC/บัญชี' }], error: null });
          if (table === 'delivery_logs' && column === 'document_recipient_id') return query;
          if (table === 'profiles' && column === 'id') return Promise.resolve({ data: [{ id: 'profile-1', full_name: 'ผู้บันทึก' }], error: null });
          throw new Error(`Unexpected in: ${table}.${column}`);
        },
        delete() {
          assert.equal(table, 'google_sheets_sync_queue');
          return query;
        },
        eq(column, value) {
          if (table === 'google_sheets_sync_queue') calls.deletes.push({ column, value });
          return query;
        },
        then(resolve) {
          return Promise.resolve({ data: table === 'delivery_logs' ? [] : null, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  const queue = loadModule('src/lib/google-sheets-sync-queue.ts', {
    '@/lib/supabase/admin': { getServiceSupabase: () => supabase },
    '@/lib/google-sheets': {
      findRowLocation: async () => rowExists ? { sheet: '2026-09-09', row: 2 } : null,
      updateRowInSheetOrThrow: async (...args) => { calls.updates.push(args); },
      appendRowsOrThrow: async (...args) => { calls.appends.push(args); },
    },
    '@/lib/document-no': { documentNo: (doc) => doc.display_no },
  });
  return { calls, queue };
}

test('คิวชีทเก็บงานไว้เมื่อ writer lease ถูกใช้อยู่', async () => {
  const { calls, queue } = createFixture({ locked: true });

  const result = await queue.flushGoogleSheetsSyncQueue();

  assert.deepEqual(JSON.parse(JSON.stringify(result)), { processed: 0, deferred: true, failed: 0 });
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.appends.length, 0);
  assert.equal(calls.deletes.length, 0);
  assert.equal(calls.releases.length, 0);
});

test('คิวชีทเขียนแถวใหม่ภายใต้ lease และลบเฉพาะ revision ที่ซิงก์แล้ว', async () => {
  const { calls, queue } = createFixture();

  const result = await queue.flushGoogleSheetsSyncQueue();

  assert.deepEqual(JSON.parse(JSON.stringify(result)), { processed: 1, deferred: false, failed: 0 });
  assert.equal(calls.appends.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.appends[0][0])), '2026-09-09');
  assert.equal(calls.appends[0][1][0][20], 'recipient-1');
  assert.deepEqual(calls.deletes, [
    { column: 'document_recipient_id', value: 'recipient-1' },
    { column: 'revision', value: 'revision-1' },
  ]);
  assert.equal(calls.releases.length, 1);
});

test('คิวชีทอัปเดตแถวเดิมแทน append ซ้ำ', async () => {
  const { calls, queue } = createFixture({ rowExists: true });

  await queue.flushGoogleSheetsSyncQueue();

  assert.equal(calls.appends.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.updates[0].slice(0, 2))), ['2026-09-09', 2]);
});
