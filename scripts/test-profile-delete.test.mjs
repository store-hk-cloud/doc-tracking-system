import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './test-support/load-module.mjs';

for (const failedTable of ['documents', 'delivery_logs']) {
  test(`profile deletion stops before Auth deletion when ${failedTable} history is unreadable`, async () => {
    let deleted = false;
    const supabase = {
      auth: { admin: { deleteUser: async () => { deleted = true; return { error: null }; } } },
      from(table) {
        const q = {
          select: () => q, eq: () => q,
          single: async () => ({ data: { id: 'target', role: 'user', is_active: true }, error: null }),
          then: (resolve) => Promise.resolve({ count: null, error: table === failedTable ? { message: 'history unavailable' } : null }).then(resolve),
        };
        return q;
      },
    };
    const route = loadModule('src/app/api/profiles/[id]/route.ts', {
      '@/lib/supabase/admin': { getServiceSupabase: () => supabase },
      '@/lib/supabase/auth-helpers': { requireRoles: async () => ({ context: { user: { id: 'actor' }, profile: { role: 'super_admin' } } }) },
    });
    const response = await route.DELETE({}, { params: Promise.resolve({ id: 'target' }) });
    assert.equal(response.status, 500);
    assert.equal(deleted, false);
  });
}
