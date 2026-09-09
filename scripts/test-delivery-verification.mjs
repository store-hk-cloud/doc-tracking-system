import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { transpileModule, ModuleKind } from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url);
const recipientId = '00000000-0000-0000-0000-000000000001';
const deliveryId = '00000000-0000-0000-0000-000000000002';
const missingId = '00000000-0000-0000-0000-000000000003';
const migration = readdirSync('supabase/migrations').find((name) => name.endsWith('_atomic_delivery_verification.sql'));

async function fixture({ sheetsFailure = false } = {}) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE document_recipients (
      id uuid PRIMARY KEY, document_id uuid, department_id uuid,
      status varchar(50) NOT NULL, updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE delivery_logs (
      id uuid PRIMARY KEY, document_recipient_id uuid NOT NULL REFERENCES document_recipients(id),
      is_verified boolean DEFAULT true, verified_by_admin boolean DEFAULT false,
      verified_by_admin_at timestamptz
    );
    ALTER TABLE document_recipients ENABLE ROW LEVEL SECURITY;
    ALTER TABLE delivery_logs ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, UPDATE ON document_recipients, delivery_logs TO service_role;
    INSERT INTO document_recipients (id, status) VALUES ('${recipientId}', 'signed');
    INSERT INTO delivery_logs (id, document_recipient_id) VALUES ('${deliveryId}', '${recipientId}');
  `);
  if (migration) await db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
  const sqlResult = async (sql, args) => {
    try { return { data: (await db.query(sql, args)).rows[0] ?? null, error: null }; }
    catch (error) { return { data: null, error }; }
  };
  // ทดสอบ route จริงโดยแทนเฉพาะขอบเขตเครือข่ายด้วย Postgres ในหน่วยความจำ
  const supabase = {
    rpc: async (name, args) => {
      assert.equal(name, 'verify_document_delivery');
      const result = await sqlResult('SELECT public.verify_document_delivery($1) AS result', [args.p_delivery_id]);
      return { data: result.data?.result ?? null, error: result.error };
    },
    from(table) {
      const filters = []; let updates;
      const query = {
        select: () => query,
        update(value) { updates = value; return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        async single() {
          if (table === 'documents') return { data: sheetsFailure ? { id: recipientId } : null, error: null };
          if (table === 'departments') return { data: null, error: null };
          if (table === 'profiles') return { data: { full_name: 'ผู้รับทดสอบ' }, error: null };
          assert.ok(['delivery_logs', 'document_recipients'].includes(table));
          // จำลองเครือข่ายขาดต่อเนื่อง: compensating request ใช้งานไม่ได้
          if (table === 'delivery_logs' && updates?.verified_by_admin === false) {
            return { data: null, error: new Error('network unavailable during compensation') };
          }
          const values = []; const param = (v) => { values.push(v); return `$${values.length}`; };
          const head = updates
            ? `UPDATE ${table} SET ${Object.entries(updates).map(([k, v]) => `${k} = ${param(v)}`).join(', ')}`
            : `SELECT * FROM ${table}`;
          const where = filters.map(([k, v]) => `${k} = ${param(v)}`).join(' AND ');
          return sqlResult(`${head} WHERE ${where}${updates ? ' RETURNING *' : ''}`, values);
        },
        then(resolve, reject) { return query.single().then(resolve, reject); },
      };
      return query;
    },
  };
  const source = readFileSync('src/app/api/deliveries/[id]/verify/route.ts', 'utf8');
  const output = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: 99 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports, console,
    require(name) {
      if (name === '@/lib/supabase/admin') return { getServiceSupabase: () => supabase };
      if (name === '@/lib/supabase/auth-helpers') return { requireRoles: async (roles) => {
        assert.deepEqual(Array.from(roles), ['super_admin', 'admin']);
        return { response: null };
      } };
      if (name === '@/lib/google-sheets') return { syncRowInSheet: async () => { if (sheetsFailure) throw new Error('Sheets unavailable'); } };
      if (name === '@/lib/document-no') return { documentNo: () => '' };
      return require(name);
    },
  });
  return {
    db,
    call: (id = deliveryId) => exports.PUT({}, { params: Promise.resolve({ id }) }),
    state: async () => (await db.query(`SELECT d.verified_by_admin, d.verified_by_admin_at, r.status FROM delivery_logs d JOIN document_recipients r ON r.id = d.document_recipient_id`)).rows[0],
  };
}

test('Sheets failure after commit still returns success and keeps the closed state', async () => {
  const f = await fixture({ sheetsFailure: true });
  try {
    assert.equal((await f.call()).status, 200);
    assert.equal((await f.state()).status, 'closed');
    assert.equal((await f.state()).verified_by_admin, true);
  } finally { await f.db.close(); }
});

test('recipient failure leaves both rows unchanged even when compensation cannot reach the database', async () => {
  const f = await fixture();
  try {
    await f.db.exec(`CREATE FUNCTION reject_close() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'recipient write failed'; END $$;
      CREATE TRIGGER reject_close BEFORE UPDATE ON document_recipients FOR EACH ROW EXECUTE FUNCTION reject_close();`);
    const response = await f.call();
    assert.equal(response.status, 500);
    assert.deepEqual(await f.state(), { verified_by_admin: false, verified_by_admin_at: null, status: 'signed' });
  } finally { await f.db.close(); }
});

test('successful close updates both rows and repeated close preserves its timestamp', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call()).status, 200);
    const first = await f.state();
    assert.equal(first.status, 'closed');
    assert.equal(first.verified_by_admin, true);
    assert.ok(first.verified_by_admin_at);
    assert.equal((await f.call()).status, 409);
    assert.deepEqual(await f.state(), first);
  } finally { await f.db.close(); }
});

test('missing and rejected deliveries do not close recipients', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call(missingId)).status, 404);
    await f.db.exec('UPDATE delivery_logs SET is_verified = false');
    assert.equal((await f.call()).status, 409);
    assert.equal((await f.state()).status, 'signed');
  } finally { await f.db.close(); }
});

test('only service_role can execute the RPC and the migration can be applied twice', async () => {
  const f = await fixture();
  try {
    assert.ok(migration, 'atomic delivery migration must exist');
    await f.db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
    for (const role of ['anon', 'authenticated']) {
      await f.db.exec(`SET ROLE ${role}`);
      await assert.rejects(f.db.query('SELECT public.verify_document_delivery($1)', [deliveryId]), /permission denied/);
      await f.db.exec('RESET ROLE');
    }
    await f.db.exec('SET ROLE service_role');
    const { rows } = await f.db.query('SELECT public.verify_document_delivery($1) AS result', [deliveryId]);
    assert.equal(rows[0].result.recipient.status, 'closed');
  } finally { await f.db.close(); }
});
