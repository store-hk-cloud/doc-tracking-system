import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { loadModule } from './test-support/load-module.mjs';

const actor = '00000000-0000-0000-0000-000000000001';
const job = '00000000-0000-0000-0000-000000000002';
const deposit = '00000000-0000-0000-0000-000000000003';
const migration = readFileSync('supabase/migrations/20261020053000_atomic_void_cash_run.sql', 'utf8');

async function fixture({ failAt, status = 'pending_review', role = 'super_admin' } = {}) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE departments (id uuid PRIMARY KEY, code text);
    CREATE TABLE profiles (id uuid PRIMARY KEY, role text, is_active boolean, department_id uuid, full_name text, email text);
    CREATE TABLE messenger_jobs (id uuid PRIMARY KEY, status text, cancelled_at timestamptz,
      cancelled_by uuid, cancel_reason text, closed_at timestamptz, closed_by uuid, closer_signature text);
    CREATE TABLE bank_deposits (id uuid PRIMARY KEY, job_id uuid REFERENCES messenger_jobs(id), status text,
      void_reason text, actual_amount_satang bigint, variance_satang bigint);
    CREATE TABLE messenger_job_audit (job_id uuid, entity text, entity_id text, action text, from_status text,
      to_status text, amount_satang bigint, variance_satang bigint, reason text, actor_id uuid,
      actor_signature text, actor_role text, actor_dept_code text, request_ip text, user_agent text);
    INSERT INTO profiles VALUES ('${actor}', '${role}', true, null, 'ผู้ตรวจ', 'test@example.invalid');
    INSERT INTO messenger_jobs (id,status) VALUES ('${job}', '${status}');
    INSERT INTO bank_deposits VALUES ('${deposit}', '${job}', 'variance_pending', null, 9900, -100);
  `);
  if (failAt === 'job') await db.exec("ALTER TABLE messenger_jobs ADD CHECK (status <> 'closed')");
  if (failAt === 'audit') await db.exec("ALTER TABLE messenger_job_audit ADD CHECK (action <> 'void_run')");
  await db.exec(migration);
  const supabase = {
    from() { throw new Error('void must use one database transaction'); },
    async rpc(name, args) {
      assert.equal(name, 'void_cash_run');
      try {
        const result = await db.query('SELECT public.void_cash_run($1,$2,$3,$4,$5) AS result', [
          args.p_job_id, args.p_actor_id, args.p_reason, args.p_request_ip, args.p_user_agent,
        ]);
        return { data: result.rows[0].result, error: null };
      } catch (error) { return { data: null, error }; }
    },
  };
  const route = loadModule('src/app/api/messenger/runs/[id]/void/route.ts', {
    '@/lib/supabase/admin': { getServiceSupabase: () => supabase },
    '@/lib/supabase/auth-helpers': {
      requireCapability: async () => ({ context: { user: { id: actor }, profile: { role } } }),
      forbiddenResponse: () => Response.json({ success: false, error: 'Forbidden' }, { status: 403 }),
    },
  });
  const call = () => route.POST(new Request('https://example.invalid/api/void', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '127.0.0.1', 'user-agent': 'regression-test' },
    body: JSON.stringify({ void_reason: 'บันทึกยอดผิดต้องยกเลิก' }),
  }), { params: Promise.resolve({ id: job }) });
  return { db, call };
}

for (const failAt of ['job', 'audit']) {
  test(`void rolls back the deposit and job together when ${failAt} write fails`, async () => {
    const { db, call } = await fixture({ failAt });
    try {
      assert.equal((await call()).status, 500);
      assert.equal((await db.query('SELECT status FROM bank_deposits')).rows[0].status, 'variance_pending');
      assert.equal((await db.query('SELECT status FROM messenger_jobs')).rows[0].status, 'pending_review');
      assert.equal((await db.query('SELECT * FROM messenger_job_audit')).rows.length, 0);
    } finally { await db.close(); }
  });
}

for (const status of ['open', 'picked_up', 'deposited', 'completed', 'pending_review']) {
  test(`void ${status} commits its final state and audit once`, async () => {
    const { db, call } = await fixture({ status });
    try {
      assert.equal((await call()).status, 200);
      assert.equal((await db.query('SELECT status FROM bank_deposits')).rows[0].status, 'voided');
      assert.equal((await db.query('SELECT status FROM messenger_jobs')).rows[0].status, ['open', 'picked_up'].includes(status) ? 'cancelled' : 'closed');
      assert.equal((await call()).status, 409);
      assert.equal((await db.query('SELECT * FROM messenger_job_audit')).rows.length, 1);
      await db.exec(migration);
      assert.equal((await db.query("SELECT has_function_privilege('authenticated', 'public.void_cash_run(uuid,uuid,text,text,text)', 'execute') AS allowed")).rows[0].allowed, false);
    } finally { await db.close(); }
  });
}

test('void RPC rechecks the active super_admin instead of trusting the caller', async () => {
  const { db, call } = await fixture({ role: 'user' });
  try {
    assert.equal((await call()).status, 403);
    assert.equal((await db.query('SELECT status FROM bank_deposits')).rows[0].status, 'variance_pending');
  } finally { await db.close(); }
});
