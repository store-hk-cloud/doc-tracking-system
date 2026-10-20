import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './test-support/load-module.mjs';

const recipientId = '00000000-0000-0000-0000-000000000001';
const documentId = '00000000-0000-0000-0000-000000000002';
const departmentId = '00000000-0000-0000-0000-000000000003';
const actorId = '00000000-0000-0000-0000-000000000004';

function responseJson(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fixture(requiredReaders = 2) {
  let readers = 0;
  let releaseReaders;
  const bothReadersReady = new Promise((resolve) => { releaseReaders = resolve; });
  const state = { status: 'registered', adminSignature: null, notifications: 0, sheetSyncs: 0 };

  const supabase = {
    from(table) {
      let operation = 'select';
      let updateValues;
      let selected = '';
      const filters = [];
      const query = {
        select(columns) { selected = columns; return query; },
        eq(column, value) { filters.push([column, value]); return query; },
        update(values) { operation = 'update'; updateValues = values; return query; },
        async single() {
          if (table === 'document_recipients' && operation === 'select') {
            readers += 1;
            if (readers === requiredReaders) releaseReaders();
            await bothReadersReady;
            return {
              data: {
                status: 'registered', department_id: departmentId, document_id: documentId,
                inspector_signature: null, purchasing_signature: null,
                documents: { recorded_by: actorId, subject: 'เอกสารทั่วไป' },
              },
              error: null,
            };
          }
          if (table === 'document_recipients' && operation === 'update') {
            const requiredStatus = filters.find(([column]) => column === 'status')?.[1];
            if (requiredStatus && requiredStatus !== state.status) return { data: null, error: null };
            state.status = updateValues.status;
            state.adminSignature = updateValues.admin_signature;
            return {
              data: {
                id: recipientId, document_id: documentId, department_id: departmentId,
                status: state.status, admin_signature: state.adminSignature,
                admin_signed_at: '2026-09-09T00:00:00.000Z', updated_at: '2026-09-09T00:00:00.000Z',
              },
              error: null,
            };
          }
          if (table === 'documents') {
            return {
              data: {
                id: documentId, received_date: '2026-09-03', doc_number: 'DOC-1', sender: 'ผู้ส่ง',
                subject: 'เอกสารทั่วไป', is_damaged: false, damage_image_url: null, note: null,
                recorded_by: actorId, tax_invoice_no: null, running_no: 1,
              },
              error: null,
            };
          }
          if (table === 'departments') return { data: { name: 'หน่วยงานทดสอบ' }, error: null };
          if (table === 'profiles') return { data: { full_name: 'ผู้บันทึก' }, error: null };
          throw new Error(`Unexpected query: ${table} ${operation} ${selected}`);
        },
      };
      return query;
    },
  };

  const route = loadModule('src/app/api/documents/[id]/sign/route.ts', {
    'next/server': { NextResponse: { json: responseJson } },
    '@/lib/supabase/admin': { getServiceSupabase: () => supabase },
    '@/lib/supabase/auth-helpers': {
      requireRoles: async () => ({
        context: { user: { id: actorId, email: 'admin@example.com' }, profile: { role: 'admin', department_id: departmentId } },
        response: null,
      }),
      forbiddenResponse: () => responseJson({ success: false }, { status: 403 }),
    },
    '@/lib/google-sheets': { syncRowInSheet: async () => { state.sheetSyncs += 1; } },
    '@/lib/upstash': { notifyDepartment: async () => { state.notifications += 1; } },
    '@/lib/document-workflow': { isGoodsReceipt: () => false, getGoodsReceiptWorkflowAction: () => null },
    '@/lib/document-no': { documentNo: () => '2026-09/001' },
  });

  const call = (body) => route.PUT(
    new Request('https://example.invalid/api/documents/sign', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: recipientId }) },
  );
  return { call, state };
}

test('concurrent delivery signatures accept exactly one registered recipient', async () => {
  const f = fixture();

  const [first, second] = await Promise.all([
    f.call({ admin_signature: 'ลายเซ็นแรก' }),
    f.call({ admin_signature: 'ลายเซ็นที่สอง' }),
  ]);

  assert.deepEqual([first.status, second.status], [200, 409]);
  assert.equal(f.state.adminSignature, 'ลายเซ็นแรก');
  assert.equal(f.state.notifications, 1);
  assert.equal(f.state.sheetSyncs, 1);
});

test('ordinary documents reject approval-stage signatures before delivery', async () => {
  const f = fixture(1);

  const response = await f.call({ inspector_signature: 'ไม่ควรถูกบันทึก' });

  assert.equal(response.status, 400);
  assert.equal(f.state.status, 'registered');
  assert.equal(f.state.notifications, 0);
  assert.equal(f.state.sheetSyncs, 0);
});
