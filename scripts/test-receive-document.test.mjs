import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { loadModule } from './test-support/load-module.mjs';

const id = '00000000-0000-0000-0000-000000000001';
const actor = '00000000-0000-0000-0000-000000000002';
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE documents (id uuid PRIMARY KEY, subject text);
    CREATE TABLE profiles (id uuid PRIMARY KEY, full_name text);
    CREATE TABLE document_recipients (id uuid PRIMARY KEY, document_id uuid REFERENCES documents(id), department_id uuid, status text);
    CREATE TABLE delivery_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      document_recipient_id uuid REFERENCES document_recipients(id), document_id uuid REFERENCES documents(id),
      recipient_id uuid REFERENCES profiles(id), recipient_signature text NOT NULL, recipient_signed_at timestamptz DEFAULT now(),
      is_verified boolean, verification_note text, verified_by_admin boolean DEFAULT false, verified_by_admin_at timestamptz);
    INSERT INTO documents VALUES ('${id}', 'จดหมาย');
    INSERT INTO profiles VALUES ('${actor}', 'ผู้รับ');
    INSERT INTO document_recipients VALUES ('${id}', '${id}', '${id}', 'delivered');
    ALTER TABLE document_recipients ENABLE ROW LEVEL SECURITY;
    ALTER TABLE delivery_logs ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO service_role;
  `);
  const migration = readdirSync('supabase/migrations').find((name) => name.endsWith('_atomic_delivery_verification.sql'));
  await db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
  const run = async (sql, params) => {
    try { return { data: (await db.query(sql, params)).rows[0] ?? null, error: null }; }
    catch (error) { return { data: null, error }; }
  };
  const supabase = {
    async rpc(name, args) {
      assert.equal(name, 'receive_document');
      const result = await run('SELECT public.receive_document($1,$2,$3,$4,$5,$6) AS result', [
        args.p_recipient_id, args.p_expected_status, args.p_actor_id, args.p_signature, args.p_is_verified, args.p_note,
      ]);
      return { data: result.data?.result, error: result.error };
    },
    from(table) {
      let values; let operation; const filters = [];
      const q = {
        select() { return q; },
        eq(key, value) { filters.push([key, value]); return q; },
        update(value) { operation = 'update'; values = value; return q; },
        insert(value) { operation = 'insert'; values = value; return q; },
        async single() {
          if (table === 'departments') return { data: null, error: null };
          assert.ok(['documents', 'profiles', 'document_recipients', 'delivery_logs'].includes(table));
          const params = []; const param = (v) => { params.push(v); return `$${params.length}`; };
          const head = operation === 'insert'
            ? `INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.values(values).map(param).join(',')})`
            : operation === 'update' ? `UPDATE ${table} SET ${Object.entries(values).map(([k,v]) => `${k}=${param(v)}`).join(',')}`
              : `SELECT * FROM ${table}`;
          const where = filters.length ? ` WHERE ${filters.map(([k,v]) => `${k}=${param(v)}`).join(' AND ')}` : '';
          return run(`${head}${where}${operation ? ' RETURNING *' : ''}`, params);
        },
      };
      return q;
    },
  };
  const route = loadModule('src/app/api/deliveries/route.ts', {
    '@/lib/supabase/admin': { getServiceSupabase: () => supabase },
    '@/lib/supabase/auth-helpers': {
      requireRoles: async () => ({ context: { user: { id: actor }, profile: { department_id: id } }, response: null }),
      canAccessDepartment: () => true,
    },
    '@/lib/google-sheets': { syncRowInSheet: async () => {} },
  });
  return { db, call: (body = {}) => route.POST({ json: async () => ({ document_recipient_id: id, is_verified: true, recipient_signature: 'ผู้รับ', ...body }) }) };
}

test('failure to save receipt evidence must leave the document ready to receive again', async () => {
  const f = await fixture();
  try {
    await f.db.exec(`CREATE FUNCTION reject_log() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'log unavailable'; END $$;
      CREATE TRIGGER reject_log BEFORE INSERT ON delivery_logs FOR EACH ROW EXECUTE FUNCTION reject_log();`);
    assert.equal((await f.call()).status, 500);
    assert.equal((await f.db.query('SELECT status FROM document_recipients')).rows[0].status, 'delivered');
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM delivery_logs')).rows[0].n, 0);
  } finally { await f.db.close(); }
});

test('receiving succeeds once with exactly one evidence row', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call()).status, 200);
    assert.equal((await f.call()).status, 409);
    assert.equal((await f.db.query('SELECT status FROM document_recipients')).rows[0].status, 'closed');
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM delivery_logs')).rows[0].n, 1);
  } finally { await f.db.close(); }
});

test('rejecting a delivery preserves its reason and permits only one receipt attempt', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call({ is_verified: false, verification_note: 'เอกสารไม่ครบ' })).status, 200);
    assert.equal((await f.call()).status, 409);
    assert.equal((await f.db.query('SELECT status FROM document_recipients')).rows[0].status, 'rejected');
    const { rows } = await f.db.query('SELECT is_verified, verification_note FROM delivery_logs');
    assert.deepEqual(rows, [{ is_verified: false, verification_note: 'เอกสารไม่ครบ' }]);
  } finally { await f.db.close(); }
});

test('receipt RPC is blocked for browser roles and usable by the service role', async () => {
  const f = await fixture();
  const sql = 'SELECT public.receive_document($1,$2,$3,$4,$5,$6) AS result';
  const args = [id, 'delivered', actor, 'ผู้รับ', true, null];
  try {
    for (const role of ['anon', 'authenticated']) {
      await f.db.exec(`SET ROLE ${role}`);
      await assert.rejects(f.db.query(sql, args), /permission denied/);
      await f.db.exec('RESET ROLE');
    }
    await f.db.exec('SET ROLE service_role');
    assert.equal((await f.db.query(sql, args)).rows[0].result.recipient.status, 'closed');
  } finally { await f.db.close(); }
});
