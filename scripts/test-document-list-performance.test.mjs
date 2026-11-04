import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './test-support/load-module.mjs';

function fixture(count = 1205, profile = { role: 'admin' }) {
  const tables = {
    documents: Array.from({ length: count }, (_, i) => ({ id: `d${i}`, running_no: count - i, recorded_by: 'other', subject: 'จดหมาย', received_date: '2026-11-04', sender: 'บริษัท' })),
    document_recipients: Array.from({ length: count }, (_, i) => ({ id: `r${String(i).padStart(5, '0')}`, document_id: `d${i}`, department_id: 'dept', status: 'closed' })),
    departments: [{ id: 'dept', name: 'ฝ่าย' }], profiles: [{ id: 'other', full_name: 'ผู้บันทึก' }], delivery_logs: [],
  };
  const calls = [];
  let failure;
  const supabase = { from(table) {
    let columns = '*', bounds = [0, 999];
    const filters = [], orders = [];
    const q = {
      select(value) { columns = value; return q; },
      eq(key, value) { filters.push(row => row[key] === value); return q; },
      in(key, values) { filters.push(row => values.includes(row[key])); return q; },
      gte(key, value) { filters.push(row => row[key] != null && row[key] >= value); return q; },
      lte(key, value) { filters.push(row => row[key] != null && row[key] <= value); return q; },
      or(expression) {
        const match = expression.match(/sender\.ilike\."%((?:\\.|[^"\\])*)%"/);
        assert.ok(match, expression);
        const keyword = match[1].replace(/\\(.)/g, '$1').toLowerCase();
        filters.push(row => ['sender', 'subject', 'doc_number', 'tax_invoice_no', 'display_no'].some(key => String(row[key] || '').toLowerCase().includes(keyword)));
        return q;
      },
      order(key, options) { orders.push([key, options?.ascending !== false]); return q; },
      range(from, to) { bounds = [from, to]; return q; },
      then(resolve, reject) {
        let rows = tables[table].filter(row => filters.every(filter => filter(row)));
        rows.sort((a, b) => { for (const [key, ascending] of orders) { if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * (ascending ? 1 : -1); } return 0; });
        rows = rows.slice(bounds[0], bounds[1] + 1);
        calls.push({ table, columns, rows: rows.length });
        if (columns !== '*') rows = rows.map(row => Object.fromEntries(columns.split(',').map(key => [key.trim(), row[key.trim()]])));
        return Promise.resolve({ data: failure === table ? null : rows, error: failure === table ? { message: 'database unavailable' } : null }).then(resolve, reject);
      },
    };
    return q;
  } };
  const route = loadModule('src/app/api/documents/route.ts', {
    '@/lib/supabase/admin': { getServiceSupabase: () => supabase },
    '@/lib/supabase/auth-helpers': { requireRoles: async () => ({ context: { user: { id: 'me' }, profile: { department_id: 'dept', department_code: 'OTHER', ...profile } } }) },
    '@/lib/google-sheets': { appendRows: async () => {} },
  });
  return { tables, calls, fail(table) { failure = table; }, async get(params = '') { const response = await route.GET({ url: `http://localhost/api/documents?${params}` }); return { status: response.status, ...await response.json() }; } };
}

for (const role of ['admin', 'super_admin']) test(`${role}: ten latest recipient rows do not load all document history`, async () => {
  const f = fixture(1205, { role }); const result = await f.get('limit=10');
  assert.equal(result.status, 200); assert.deepEqual(result.data.map(row => row.document_id), Array.from({ length: 10 }, (_, i) => `d${i}`));
  assert.ok(f.calls.filter(c => c.table === 'documents').reduce((n, c) => n + c.rows, 0) <= 200);
  assert.equal(result.data[0].recorded_by_name, 'ผู้บันทึก'); assert.equal(result.data[0].recipient_dept_name, 'ฝ่าย');
});

test('filtered pending list fetches full documents only for matching recipient candidates', async () => {
  const f = fixture(); f.tables.document_recipients[1100].status = 'delivered'; f.tables.document_recipients[1101].status = 'registered';
  const result = await f.get('status=delivered&status=registered');
  assert.deepEqual(result.data.map(row => row.document_id), ['d1100', 'd1101']);
  assert.equal(f.calls.filter(c => c.table === 'documents').reduce((n, c) => n + c.rows, 0), 2);
});

test('empty recipient candidates avoid fetching full documents', async () => {
  const f = fixture(); assert.deepEqual((await f.get('status=rejected')).data, []);
  assert.equal(f.calls.filter(c => c.table === 'documents').length, 0);
});

test('a missing keyword avoids reading broad recipient history', async () => {
  const f = fixture(); assert.deepEqual((await f.get('status=closed&keyword=missing')).data, []);
  assert.equal(f.calls.filter(c => c.table === 'document_recipients').length, 0);
});

test('received date narrows documents before reading broad recipient history', async () => {
  const f = fixture(); f.tables.documents[1100].received_date = '2026-11-05';
  assert.deepEqual((await f.get('status=closed&date_from=2026-11-05')).data.map(row => row.document_id), ['d1100']);
  assert.equal(f.calls.filter(c => c.table === 'document_recipients').reduce((n, c) => n + c.rows, 0), 1);
});

test('visibility is applied before limit across batches, retaining owners and prior signers', async () => {
  const f = fixture(450, { role: 'user' }); f.tables.document_recipients.forEach(row => { row.department_id = 'foreign'; });
  f.tables.documents[210].recorded_by = 'me'; f.tables.document_recipients[211].inspector_signed_by = 'me'; f.tables.document_recipients[212].purchasing_signed_by = 'me'; f.tables.document_recipients[213].department_id = 'dept';
  assert.deepEqual((await f.get('limit=4')).data.map(row => row.document_id), ['d210', 'd211', 'd212', 'd213']);
});

test('mine scope filters registered documents across departments before fetching history', async () => {
  const f = fixture(1205, { role: 'user' }); f.tables.documents[1100].recorded_by = 'me'; f.tables.document_recipients[1100].department_id = 'foreign';
  assert.deepEqual((await f.get('scope=mine&limit=10')).data.map(row => row.document_id), ['d1100']);
  assert.equal(f.calls.filter(c => c.table === 'documents').reduce((n, c) => n + c.rows, 0), 1);
  const admin = fixture(3); assert.equal((await admin.get('scope=mine')).data.length, 3);
});

for (const scope of ['status=registered', 'scope=mine']) for (const suffix of ['', '&limit=1']) {
  test(`duplicate running numbers retain original document chunks: ${scope}${suffix}`, async () => {
    const f = fixture(202, { role: scope === 'scope=mine' ? 'user' : 'admin' });
    f.tables.documents.forEach(row => { row.running_no = 1; });
    for (const [index, id] of [[0, 'z'], [99, 'a']]) {
      f.tables.documents[index].recorded_by = 'me';
      f.tables.document_recipients[index].status = 'registered';
      f.tables.document_recipients[index].id = id;
    }
    assert.deepEqual((await f.get(scope + suffix)).data.map(row => row.document_id), suffix ? ['d0'] : ['d0', 'd99']);
  });
}

test('mine limit retains a duplicate running number across the 200-document boundary', async () => {
  const f = fixture(202, { role: 'user' });
  f.tables.documents.forEach((row, index) => {
    row.id = `d${String(index).padStart(3, '0')}`;
    row.recorded_by = index === 0 ? 'other' : 'me';
    f.tables.document_recipients[index].document_id = row.id;
  });
  f.tables.documents[201].running_no = f.tables.documents[200].running_no;
  f.tables.document_recipients[200].id = 'z'; f.tables.document_recipients[201].id = 'a';
  const result = await f.get('scope=mine&limit=200');
  assert.equal(result.data.length, 200); assert.equal(result.data.at(-1).document_id, 'd201');
  assert.equal(result.data.some(row => row.document_id === 'd200'), false);
});

test('goods receipt visibility follows workflow rather than selected department', async () => {
  const f = fixture(3, { role: 'user', department_code: '0-ADM04' });
  f.tables.documents.forEach(row => { row.subject = 'ใบรับสินค้า'; });
  f.tables.document_recipients[0].status = 'closed'; f.tables.document_recipients[1].status = 'awaiting_inspector'; f.tables.document_recipients[2].status = 'awaiting_purchasing';
  assert.deepEqual((await f.get('limit=1')).data.map(row => row.document_id), ['d1']);
});

test('keyword quoting, document dates, recipient department and Thai delivery dates remain combined', async () => {
  const f = fixture(4); f.tables.documents[1].sender = 'บริษัท "ก", (ข)'; f.tables.document_recipients[1].admin_signed_at = '2026-11-04T00:00:00+07:00';
  const keyword = encodeURIComponent('"ก", (ข)');
  assert.deepEqual((await f.get(`keyword=${keyword}&dept_id=dept&date_field=delivered&date_from=2026-11-04&date_to=2026-11-04&limit=10`)).data.map(row => row.document_id), ['d1']);
  assert.deepEqual((await f.get('date_from=2026-11-05')).data, []);
});

test('limit counts recipient rows and hydration retains latest evidence and rejection mapping', async () => {
  const f = fixture(2); f.tables.document_recipients.push({ id: 'r99999', document_id: 'd0', department_id: 'dept', status: 'rejected', inspector_verified: false, inspector_verification_note: 'ผิด' });
  f.tables.delivery_logs.push({ id: 'old', document_recipient_id: 'r00000', created_at: '2026-01-01', recipient_signature: 'เก่า' }, { id: 'new', document_recipient_id: 'r00000', created_at: '2026-02-01', recipient_signature: 'ใหม่', is_verified: true });
  const result = await f.get('limit=2'); assert.deepEqual(result.data.map(row => row.id), ['r00000', 'r99999']);
  assert.equal(result.data[0].recipient_signature, 'ใหม่'); assert.equal(result.data[0].recipient_verified, true);
  assert.equal(result.data[1].rejection_stage, 'inspector'); assert.equal(result.data[1].rejection_note, 'ผิด'); assert.equal(result.data[1].recipient_signature, null);
});

test('unlimited lists and recipient candidates paginate beyond 1000 without losing rows', async () => {
  const f = fixture(); assert.equal((await f.get()).data.length, 1205);
  assert.equal((await f.get('status=closed')).data.length, 1205);
  assert.equal((await f.get('limit=invalid')).data.length, 1205);
});

for (const table of ['documents', 'document_recipients', 'delivery_logs']) test(`${table} errors are propagated`, async () => {
  const f = fixture(2); f.fail(table); const result = await f.get('status=closed&limit=1');
  assert.equal(result.status, 500); assert.equal(result.error, 'database unavailable');
});
