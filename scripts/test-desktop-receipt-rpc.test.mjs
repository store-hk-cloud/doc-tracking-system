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
    SET TIME ZONE 'UTC';
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
  await db.exec(`UPDATE document_recipients SET updated_at = '2026-11-10T00:00:00Z';
    UPDATE documents SET display_no = 'DOC-01';`);
  const paths = [
    'supabase/migrations/20260908013605_atomic_delivery_verification.sql',
    'supabase/migrations/20261110110000_apps_script_sheet_sync.sql',
    'supabase/migrations/20261110121000_receive_document_worker.sql',
    'supabase/migrations/20261110123000_bulk_receipt_queue.sql',
  ];
  for (const path of paths) await db.exec(readFileSync(path, 'utf8'));
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$
      SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb
    $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT (auth.jwt()->>'sub')::uuid
    $$;
  `);
  const migration = new URL('../supabase/migrations/20261110123200_desktop_receipts.sql', import.meta.url);
  await db.exec(readFileSync(migration, 'utf8'));
  const call = async (sql, args = []) => (await db.query(sql, args)).rows[0].result;
  return {
    db,
    login: async (user = actor, role = 'authenticated') => {
      await db.exec(`SET ROLE ${role}`);
      await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: user, email })]);
    },
    pending: (search = '') => call('SELECT public.list_desktop_pending_receipts($1) AS result', [search]),
    enqueue: (items = [item], name = ' ผู้ลงนาม ') =>
      call('SELECT public.enqueue_desktop_receipts($1,$2,$3::jsonb) AS result', [batch, name, JSON.stringify(items)]),
    list: () => call('SELECT public.list_desktop_receipt_batches() AS result'),
  };
}

const batch = '00000000-0000-0000-0000-000000000004';
const otherRecipient = '00000000-0000-0000-0000-000000000005';
const item = { recipientId: id, expectedUpdatedAt: '2026-11-10T00:00:00.123456Z' };

test('lists matching current receipt stages for the authenticated department only', async (t) => {
  const { db, login, pending } = await fixture(t);
  await db.exec(`
    UPDATE departments SET name = 'ACC/บัญชี' WHERE id = '${id}';
    UPDATE documents SET sender = 'Supplier 100%';
    UPDATE document_recipients SET updated_at = '${item.expectedUpdatedAt}', admin_signed_at = '2026-11-10T02:00:00Z';
    INSERT INTO document_recipients (id, document_id, department_id, status, updated_at)
      VALUES ('${otherRecipient}', '${id}', '${otherDepartment}', 'delivered', now());
  `);
  await login();
  assert.deepEqual(await pending('100%'), [{
    recipient_id: id, updated_at: '2026-11-10T00:00:00.123456+00:00', document_no: 'DOC-01',
    sender: 'Supplier 100%', subject: 'จดหมาย', delivery_date: '2026-11-10T02:00:00+00:00',
    department: 'ACC/บัญชี', stage: 'delivered',
  }]);
  assert.deepEqual(await pending('%x'), []);
  assert.deepEqual(await pending('missing'), []);
  await db.exec("RESET ROLE; UPDATE documents SET subject = 'ใบรับสินค้า'");
  await login();
  assert.deepEqual(await pending(), []);
  await db.exec("RESET ROLE; UPDATE document_recipients SET status = 'awaiting_recipient'");
  await login();
  assert.equal((await pending())[0].stage, 'awaiting_recipient');
  await db.exec(`RESET ROLE; UPDATE departments SET code = 'OTHER' WHERE id = '${id}'`);
  await login();
  assert.deepEqual(await pending(), []);
});

test('wraps the service queue using the JWT actor, checks eligibility and keeps private permissions', async (t) => {
  const { db, login, pending, enqueue, list } = await fixture(t);
  await db.exec(`
    INSERT INTO profiles VALUES ('${otherDepartment}', 'Other', 'user', '${otherDepartment}', true);
    UPDATE document_recipients SET updated_at = '${item.expectedUpdatedAt}';
    INSERT INTO document_recipients (id, document_id, department_id, status, updated_at)
      VALUES ('${otherRecipient}', '${id}', '${otherDepartment}', 'delivered', '${item.expectedUpdatedAt}');
  `);
  await login(actor, 'anon');
  for (const rpc of [pending, enqueue, list]) await assert.rejects(rpc(), /permission denied/);
  await login(null);
  for (const rpc of [pending, enqueue, list]) await assert.rejects(rpc(), /receipt_actor_not_authenticated/);
  await login();
  await assert.rejects(db.query('SELECT * FROM document_receipt_private.jobs'), /permission denied/);
  await assert.rejects(db.query('SELECT public.list_document_receipt_batches($1)', [actor]), /permission denied/);
  await assert.rejects(enqueue([]), /receipt_invalid_batch/);
  await assert.rejects(enqueue([item], 'x'.repeat(256)), /receipt_invalid_signature/);
  await assert.rejects(enqueue([item], '   '), /receipt_invalid_signature/);
  await assert.rejects(enqueue([item], null), /receipt_invalid_signature/);
  const items = [{ ...item, actor_id: otherDepartment }, { ...item, recipientId: otherRecipient }];
  const result = await enqueue(items);
  assert.deepEqual(result.items.map(({ status, error, document_no }) => ({ status, error, document_no })), [
    { status: 'queued', error: null, document_no: 'DOC-01' },
    { status: 'failed', error: 'receipt_forbidden', document_no: null },
  ]);
  assert.deepEqual(await enqueue(items), result);
  assert.deepEqual(await list(), [result]);
  assert.deepEqual(await pending(), []);
  await login(otherDepartment);
  assert.deepEqual(await list(), []);
  await db.exec('RESET ROLE');
  assert.deepEqual((await db.query('SELECT actor_id, actor_email, signature FROM document_receipt_private.batches')).rows,
    [{ actor_id: actor, actor_email: email, signature: 'ผู้ลงนาม' }]);
  await db.exec('SET ROLE service_role');
  assert.equal((await db.query('SELECT public.process_document_receipt_queue() AS result')).rows[0].result.status, 'succeeded');
  await login();
  assert.equal((await list())[0].items[0].status, 'succeeded');
  await db.exec('RESET ROLE');
  assert.deepEqual((await db.query('SELECT recipient_id, recipient_signature FROM delivery_logs')).rows,
    [{ recipient_id: actor, recipient_signature: 'ผู้ลงนาม' }]);
  await db.exec('UPDATE profiles SET is_active = false');
  await login();
  for (const rpc of [pending, enqueue, list]) await assert.rejects(rpc(), /receipt_actor_not_authenticated/);
});
