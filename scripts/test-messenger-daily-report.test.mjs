import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './test-support/load-module.mjs';

const PAGE_SIZE = 1000;
const rows = {
  pickupsToday: Array.from({ length: 1001 }, (_, i) => ({ envelope_amount_satang: 100, job_id: `job-${i}` })),
  depositsToday: Array.from({ length: 1001 }, (_, i) => ({
    actual_amount_satang: 200,
    variance_satang: i % 2 ? -5 : 10,
    job_id: `job-${i}`,
  })),
  openPickups: Array.from({ length: 1001 }, () => ({
    envelope_amount_satang: 300,
    messenger_jobs: { status: 'picked_up' },
  })),
  pendingReports: Array.from({ length: 1001 }, (_, i) => ({ id: `report-${i}` })),
  awaitingSlip: Array.from({ length: 1001 }, (_, i) => ({ id: `slip-${i}` })),
  unconfirmed: Array.from({ length: 1001 }, (_, i) => ({ id: `pickup-${i}` })),
};

function createRoute({ failKey } = {}) {
  const ranges = [];
  const supabase = {
    from(table) {
      const state = { table, hasDate: false, slipPending: false, unconfirmed: false, noDeposit: false };
      const query = {
        select() { return query; },
        gte() { state.hasDate = true; return query; },
        lte() { state.hasDate = true; return query; },
        eq(column, value) {
          if (table === 'bank_deposits' && column === 'slip_status' && value === 'pending') state.slipPending = true;
          return query;
        },
        neq() { return query; },
        is(column, value) {
          if (table === 'cash_pickups' && column === 'deposit_id' && value === null) state.noDeposit = true;
          if (table === 'cash_pickups' && column === 'branch_confirmed_at' && value === null) state.unconfirmed = true;
          return query;
        },
        order() { return query; },
        range(from, to) {
          const key = table === 'cash_variance_reports'
            ? 'pendingReports'
            : table === 'bank_deposits'
              ? (state.slipPending ? 'awaitingSlip' : 'depositsToday')
              : state.hasDate
                ? 'pickupsToday'
                : state.noDeposit
                  ? 'openPickups'
                  : 'unconfirmed';
          ranges.push({ key, from, to });
          if (failKey === key) return Promise.resolve({ data: null, error: { message: `${key} unavailable` } });
          return Promise.resolve({ data: rows[key].slice(from, to + 1), error: null });
        },
      };
      return query;
    },
  };
  const route = loadModule('src/app/api/messenger/reports/daily/route.ts', {
    '@/lib/supabase/admin': { getServiceSupabase: () => supabase },
    '@/lib/supabase/auth-helpers': {
      requireCapability: async () => ({ context: { user: { id: 'actor' }, profile: {} }, response: null }),
      forbiddenResponse: () => new Response(JSON.stringify({ success: false }), { status: 403 }),
    },
    '@/lib/permissions': { canViewCash: async () => true },
    '@/lib/thai-date': { bangkokDate: () => '2026-09-09' },
  });
  return { route, ranges };
}

test('daily cash report paginates every source instead of silently truncating at 1,000 rows', async () => {
  const { route, ranges } = createRoute();
  const response = await route.GET(new Request('https://example.invalid/api/messenger/reports/daily?date=2026-09-09'));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.received_satang, 100100);
  assert.equal(body.data.deposited_satang, 200200);
  assert.equal(body.data.in_hand_satang, 300300);
  assert.equal(body.data.short_satang, 2500);
  assert.equal(body.data.over_satang, 5010);
  assert.equal(body.data.pending_review_count, 1001);
  assert.equal(body.data.awaiting_slip_count, 1001);
  assert.equal(body.data.awaiting_branch_confirm_count, 1001);
  assert.equal(body.data.job_count, 1001);

  for (const key of Object.keys(rows)) {
    assert.deepEqual(
      ranges.filter((range) => range.key === key).map((range) => range.from),
      [0, PAGE_SIZE],
      `${key} must fetch its second page`
    );
  }
});

for (const failKey of Object.keys(rows)) {
  test(`daily cash report returns an error when ${failKey} cannot be read`, async () => {
    const { route } = createRoute({ failKey });
    const response = await route.GET(new Request('https://example.invalid/api/messenger/reports/daily'));
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.success, false);
    assert.match(body.error, new RegExp(failKey));
  });
}
