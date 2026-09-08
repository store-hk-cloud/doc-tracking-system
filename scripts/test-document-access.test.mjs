import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './test-support/load-module.mjs';

function routeFor({ role = 'user', owner = false, signed = false, subject = 'จดหมาย' } = {}) {
  const context = { user: { id: 'viewer' }, profile: { role, department_id: 'other', department_code: 'HR' } };
  const records = {
    document_recipients: { id: 'recipient', document_id: 'document', department_id: 'recipient-dept', status: 'closed', inspector_signed_by: signed ? 'viewer' : null },
    documents: { id: 'document', recorded_by: owner ? 'viewer' : 'another-user', subject },
    document_department_tags: [],
  };
  const route = loadModule('src/app/api/documents/[id]/route.ts', {
    '@/lib/supabase/admin': { getServiceSupabase: () => ({
      from(table) {
        const result = { data: records[table] ?? null, error: null };
        const q = { select: () => q, eq: () => q, single: async () => result, then: (resolve) => Promise.resolve(result).then(resolve) };
        return q;
      },
    }) },
    '@/lib/supabase/auth-helpers': {
      requireRoles: async () => ({ context, response: null }),
      canAccessDepartment: (ctx, departmentId) => ctx.profile.department_id === departmentId,
      forbiddenResponse: () => Response.json({ success: false }, { status: 403 }),
    },
    '@/lib/google-sheets': {},
  });
  return () => route.GET({}, { params: Promise.resolve({ id: 'recipient' }) });
}

for (const options of [{ role: 'admin' }, { role: 'super_admin' }, { owner: true }, { signed: true, subject: 'ใบรับสินค้า' }]) {
  test(`document visible in the list remains readable in detail: ${JSON.stringify(options)}`, async () => {
    assert.equal((await routeFor(options)()).status, 200);
  });
}
test('an unrelated user still cannot read another department document', async () => {
  assert.equal((await routeFor()()).status, 403);
});
