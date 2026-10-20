import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './test-support/load-module.mjs';

function responseJson(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('registering a historical document appends to its received-date tab', async () => {
  const appends = [];
  const document = {
    id: 'document-1', display_no: '2026-09/001', received_date: '2026-09-03',
    doc_number: 'ย้อนหลัง-001', sender: 'ผู้ส่ง', subject: 'เอกสารทั่วไป',
    is_damaged: false, damage_image_url: null, note: null, recorded_by: 'user-1', tax_invoice_no: null,
  };
  const recipients = [{ id: 'recipient-1', department_id: 'department-1', status: 'registered' }];
  const supabase = {
    rpc(name) {
      assert.equal(name, 'register_document');
      return Promise.resolve({ data: { document, recipients }, error: null });
    },
    from(table) {
      const query = {
        select() { return query; },
        eq() { return query; },
        single() {
          if (table === 'profiles') return Promise.resolve({ data: { full_name: 'ผู้บันทึก' }, error: null });
          throw new Error(`Unexpected single table: ${table}`);
        },
        in() {
          if (table === 'departments') return Promise.resolve({ data: [{ id: 'department-1', name: 'ACC/บัญชี' }], error: null });
          throw new Error(`Unexpected in table: ${table}`);
        },
      };
      return query;
    },
  };
  const route = loadModule('src/app/api/documents/route.ts', {
    'next/server': { NextResponse: { json: responseJson } },
    '@/lib/supabase/admin': { getServiceSupabase: () => supabase },
    '@/lib/google-sheets': { appendRows: async (sheet, rows) => { appends.push({ sheet, rows }); } },
    '@/lib/supabase/auth-helpers': { requireRoles: async () => ({ context: { user: { id: 'user-1' } }, response: null }) },
    '@/lib/document-workflow': {
      accountingDestinationFor: () => null,
      canViewGoodsReceiptWorkflow: () => false,
      GOODS_RECEIPT_SUBJECT: 'ใบรับสินค้า',
      isGoodsReceipt: () => false,
    },
    '@/lib/document-no': { documentNo: () => '2026-09/001' },
    '@/lib/thai-date': { bangkokDate: () => '2026-09-09' },
  });

  const response = await route.POST(new Request('https://example.invalid/api/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: 'ผู้ส่ง', subject: 'เอกสารทั่วไป', recipient_dept_ids: ['department-1'], received_date: '2026-09-03',
    }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(appends.map((append) => append.sheet), ['2026-09-03']);
  assert.equal(appends[0].rows[0][1], '2026-09-03');
});
