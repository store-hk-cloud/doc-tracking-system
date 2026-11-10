import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const id = '00000000-0000-0000-0000-000000000001';
const actor = '00000000-0000-0000-0000-000000000002';
const otherDepartment = '00000000-0000-0000-0000-000000000003';
const email = 'verified@example.com';

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE departments (id uuid PRIMARY KEY, code varchar(50) UNIQUE NOT NULL, name text);
    CREATE TABLE profiles (id uuid PRIMARY KEY, full_name varchar(255) NOT NULL,
      role varchar(50) NOT NULL, department_id uuid REFERENCES departments(id), is_active boolean DEFAULT true);
    CREATE TABLE documents (id uuid PRIMARY KEY, subject text NOT NULL, display_no text,
      running_no bigint, received_date date, doc_number text, sender text, is_damaged boolean,
      damage_image_url text, note text, recorded_by uuid, tax_invoice_no text);
    CREATE TABLE document_recipients (id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES documents(id),
      department_id uuid NOT NULL REFERENCES departments(id), status varchar(50) NOT NULL,
      admin_signature text, admin_signed_at timestamptz, inspector_verified boolean, purchasing_verified boolean,
      inspector_verification_note text, purchasing_verification_note text, updated_at timestamptz);
    CREATE TABLE delivery_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      document_recipient_id uuid REFERENCES document_recipients(id), document_id uuid NOT NULL REFERENCES documents(id),
      recipient_id uuid NOT NULL REFERENCES profiles(id), recipient_signature text NOT NULL, recipient_signed_at timestamptz DEFAULT now(),
      is_verified boolean, verification_note text, verified_by_admin boolean DEFAULT false, verified_by_admin_at timestamptz,
      created_at timestamptz DEFAULT now());
    INSERT INTO departments (id, code) VALUES ('${id}', '0-ADM03'), ('${otherDepartment}', 'OPS');
    INSERT INTO profiles VALUES ('${actor}', 'ชื่อในบัญชี', 'user', '${id}', true);
    INSERT INTO documents (id, subject) VALUES ('${id}', 'จดหมาย');
    INSERT INTO document_recipients (id, document_id, department_id, status) VALUES ('${id}', '${id}', '${id}', 'delivered');
    ALTER TABLE document_recipients ENABLE ROW LEVEL SECURITY;
    ALTER TABLE delivery_logs ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT UPDATE ON document_recipients TO service_role;
    GRANT INSERT ON delivery_logs TO service_role;
  `);
  const paths = [
    'supabase/migrations/20260908013605_atomic_delivery_verification.sql',
    'supabase/migrations/20261110110000_apps_script_sheet_sync.sql',
    'supabase/migrations/20261110121000_receive_document_worker.sql',
  ];
  for (const path of paths) await db.exec(readFileSync(path, 'utf8'));
  return {
    db,
    async receive({ recipient = id, actorId = actor, signature = null, verified = true, note = null } = {}) {
      const { rows } = await db.query('SELECT public.receive_document_worker($1,$2,$3,$4,$5,$6) AS result',
        [recipient, actorId, signature, verified, note, email]);
      return rows[0].result;
    },
  };
}

test('only the service role can invoke the receipt RPC', async (t) => {
  const { db, receive } = await fixture(t);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(receive(), /permission denied/);
  }
  await db.exec('SET ROLE service_role');
  const result = await receive();
  assert.equal(result.recipient.status, 'closed');
  assert.equal(result.delivery.recipient_id, actor);
  assert.equal(result.delivery.recipient_signature, 'ชื่อในบัญชี');
  await db.exec('RESET ROLE');
  assert.deepEqual((await db.query('SELECT recipient_id FROM apps_script_sheet_private.jobs')).rows, [{ recipient_id: id }]);
});

test('fresh actor permissions reject missing, inactive and cross-department profiles', async (t) => {
  const { db, receive } = await fixture(t);
  await assert.rejects(receive({ actorId: id }), /receipt_actor_not_authenticated/);
  await db.exec('UPDATE profiles SET is_active = false');
  await assert.rejects(receive(), /receipt_actor_not_authenticated/);
  await db.exec(`UPDATE profiles SET is_active = true, role = 'unknown'`);
  await assert.rejects(receive(), /receipt_forbidden/);
  await db.exec(`UPDATE profiles SET role = 'super_admin', department_id = '${otherDepartment}'`);
  await assert.rejects(receive(), /receipt_forbidden/);
  await db.exec('UPDATE profiles SET department_id = NULL');
  await assert.rejects(receive(), /receipt_forbidden/);
  assert.equal((await db.query('SELECT status FROM document_recipients')).rows[0].status, 'delivered');
});

test('goods receipts require the accounting department and awaiting_recipient status', async (t) => {
  const { db, receive } = await fixture(t);
  await db.exec(`UPDATE documents SET subject = 'ใบรับสินค้า'`);
  await assert.rejects(receive(), /recipient_already_processed/);
  await db.exec(`UPDATE document_recipients SET status = 'awaiting_recipient'; UPDATE departments SET code = 'OTHER' WHERE id = '${id}'`);
  await assert.rejects(receive(), /receipt_forbidden/);
  await db.exec(`UPDATE departments SET code = '0-ADM03' WHERE id = '${id}'`);
  const result = await receive({ verified: false, signature: 'ผู้รับจริง', note: 'สินค้าไม่ครบ' });
  assert.equal(result.recipient.status, 'rejected');
  assert.equal(result.delivery.recipient_signature, 'ผู้รับจริง');
  assert.equal(result.delivery.is_verified, false);
  assert.equal(result.delivery.verification_note, 'สินค้าไม่ครบ');
});

test('near-match subjects use the ordinary workflow and an empty profile name falls back to the verified email', async (t) => {
  const { db, receive } = await fixture(t);
  await db.exec(`UPDATE documents SET subject = 'ใบรับสินค้า '; UPDATE departments SET code = 'OTHER' WHERE id = '${id}';
    UPDATE profiles SET full_name = '', role = 'admin', is_active = NULL`);
  assert.equal((await receive({ signature: '' })).delivery.recipient_signature, email);
});

test('missing recipient and null verification leave the receipt ready', async (t) => {
  const { db, receive } = await fixture(t);
  await assert.rejects(receive({ recipient: actor }), /document_recipient_not_found/);
  await assert.rejects(receive({ verified: null }), /receipt_invalid_verification/);
  assert.equal((await db.query('SELECT status FROM document_recipients')).rows[0].status, 'delivered');
});

test('competing receipt requests only record one delivery', async (t) => {
  const { db, receive } = await fixture(t);
  const attempts = await Promise.allSettled([receive(), receive()]);
  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  assert.match(attempts.find((attempt) => attempt.status === 'rejected').reason.message, /recipient_already_processed/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM delivery_logs')).rows[0].n, 1);
});

test('a failed delivery insert rolls back the recipient update', async (t) => {
  const { db, receive } = await fixture(t);
  await db.exec(`CREATE FUNCTION reject_log() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'log unavailable'; END $$;
    CREATE TRIGGER reject_log BEFORE INSERT ON delivery_logs FOR EACH ROW EXECUTE FUNCTION reject_log();`);
  await assert.rejects(receive(), /log unavailable/);
  assert.equal((await db.query('SELECT status FROM document_recipients')).rows[0].status, 'delivered');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM delivery_logs')).rows[0].n, 0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM apps_script_sheet_private.jobs')).rows[0].n, 0);
});
