import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './test-support/load-module.mjs';

test('failed sibling count must not delete the shared parent and cascade other departments', async () => {
  const deleted = [];
  const supabase = { from(table) {
    let countQuery = false; let deleting = false;
    const q = {
      select(_columns, options) { countQuery = !!options?.head; return q; },
      eq() { return q; },
      delete() { deleting = true; return q; },
      single: async () => ({ data: { document_id: 'parent' }, error: null }),
      then(resolve) {
        if (deleting) deleted.push(table);
        return Promise.resolve(countQuery
          ? { count: null, error: new Error('count timed out') }
          : { error: null }).then(resolve);
      },
    };
    return q;
  } };
  const route = loadModule('src/app/api/documents/[id]/route.ts', {
    '@/lib/supabase/admin': { getServiceSupabase: () => supabase },
    '@/lib/supabase/auth-helpers': { requireRoles: async () => ({ response: null }) },
    '@/lib/google-sheets': {},
  });
  const response = await route.DELETE({}, { params: Promise.resolve({ id: 'one-department' }) });
  assert.equal(response.status, 500);
  assert.deepEqual(deleted, ['document_recipients']);
});
