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

  const call = async (sql, args = []) => (await db.query(sql, args)).rows[0].result;
  return {
    db,
    enqueue: ({ batchId = batch, actorId = actor, signature = 'signed', items = [item] } = {}) =>
      call('SELECT public.enqueue_document_receipts($1,$2,$3,$4::jsonb,$5) AS result',
        [actorId, batchId, signature, JSON.stringify(items), email]),
    list: (actorId = actor) => call('SELECT public.list_document_receipt_batches($1) AS result', [actorId]),
    process: () => call('SELECT public.process_document_receipt_queue() AS result'),
  };
}

const batch = '00000000-0000-0000-0000-000000000004';
const nextBatch = '00000000-0000-0000-0000-000000000005';
const item = { recipient_id: id, expected_updated_at: '2026-11-10T00:00:00Z' };

test('private queue, owner-only idempotency, one item per process, and transactional outbox', async (t) => {
  const { db, enqueue, list, process } = await fixture(t);
  await db.exec(`INSERT INTO profiles VALUES ('${otherDepartment}', 'Other', 'user', '${id}', true)`);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(enqueue(), /permission denied/);
    await assert.rejects(list(), /permission denied/);
    await assert.rejects(process(), /permission denied/);
  }
  await db.exec('SET ROLE service_role');
  const initial = await enqueue({ items: [item, { ...item, recipient_id: actor }] });
  assert.deepEqual(initial.items, [
    { recipient_id: id, expected_updated_at: '2026-11-10T00:00:00+00:00', document_no: 'DOC-01', status: 'queued', error: null },
    { recipient_id: actor, expected_updated_at: '2026-11-10T00:00:00+00:00', document_no: null, status: 'failed', error: 'document_recipient_not_found' },
  ]);
  assert.deepEqual(await enqueue({ items: [item, { ...item, recipient_id: actor }] }), initial);
  await assert.rejects(enqueue({ signature: 'changed' }), /receipt_batch_conflict/);
  await assert.rejects(enqueue({ actorId: otherDepartment }), /receipt_batch_conflict/);
  assert.deepEqual(await list(otherDepartment), []);
  assert.deepEqual(await list(), [initial]);
  assert.equal((await enqueue({ batchId: nextBatch })).items[0].error, 'receipt_duplicate');
  assert.equal((await process()).status, 'succeeded');
  assert.equal((await process()).status, 'idle');
  assert.equal((await list()).find((b) => b.id === batch).items[0].status, 'succeeded');
  await db.exec('RESET ROLE');
  assert.deepEqual((await db.query('SELECT recipient_signature, is_verified FROM delivery_logs')).rows,
    [{ recipient_signature: 'signed', is_verified: true }]);
  assert.deepEqual((await db.query('SELECT recipient_id FROM apps_script_sheet_private.jobs')).rows, [{ recipient_id: id }]);
});

test('validates input and checks goods routing, authorization and exact receipt round', async (t) => {
  const { db, enqueue, list, process } = await fixture(t);
  await assert.rejects(enqueue({ items: [] }), /receipt_invalid_batch/);
  await assert.rejects(enqueue({ items: Array(51).fill(item) }), /receipt_invalid_batch/);
  await assert.rejects(enqueue({ items: [{ recipient_id: id }] }), /receipt_invalid_batch/);
  await assert.rejects(enqueue({ items: [item, item] }), /receipt_invalid_batch/);
  await db.exec(`UPDATE documents SET subject = 'ใบรับสินค้า'; UPDATE departments SET code = 'OTHER' WHERE id = '${id}'`);
  const forbidden = (await enqueue({ batchId: nextBatch })).items[0];
  assert.equal(forbidden.error, 'receipt_forbidden');
  assert.equal(forbidden.document_no, null);
  await db.exec(`UPDATE departments SET code = '0-ADM03' WHERE id = '${id}';
    UPDATE document_recipients SET status = 'awaiting_recipient'`);
  assert.equal((await enqueue()).items[0].status, 'queued');
  await db.exec("UPDATE document_recipients SET updated_at = '2026-11-10T00:00:01Z'");
  assert.equal((await process()).status, 'failed');
  assert.equal((await list()).find((b) => b.id === batch).items[0].error, 'receipt_stale');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM delivery_logs')).rows[0].n, 0);
});

test('processing rechecks actor, keeps receipts atomic, and bounds transient retries', async (t) => {
  const { db, enqueue, list, process } = await fixture(t);
  await enqueue();
  await db.exec('UPDATE profiles SET is_active = false');
  await assert.rejects(list(), /receipt_actor_not_authenticated/);
  assert.equal((await process()).status, 'failed');
  await db.exec(`UPDATE profiles SET is_active = true;
    CREATE FUNCTION unavailable_log() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'private details'; END $$;
    CREATE TRIGGER unavailable_log BEFORE INSERT ON delivery_logs FOR EACH ROW EXECUTE FUNCTION unavailable_log();`);
  assert.equal((await list())[0].items[0].error, 'receipt_actor_not_authenticated');
  await enqueue({ batchId: nextBatch });
  for (const status of ['queued', 'queued', 'failed']) {
    assert.equal((await process()).status, status);
  }
  assert.equal((await list()).find((b) => b.id === nextBatch).items[0].error, 'receipt_processing_failed');
  assert.equal((await db.query('SELECT status FROM document_recipients')).rows[0].status, 'delivered');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM apps_script_sheet_private.jobs')).rows[0].n, 0);
});


test('processes receipts in queue order and prioritizes active batches in the ten-batch history', async (t) => {
  const { db, enqueue, list, process } = await fixture(t);
  await db.exec(`INSERT INTO document_recipients (id, document_id, department_id, status, updated_at)
    VALUES ('${otherDepartment}', '${id}', '${id}', 'delivered', '${item.expected_updated_at}')`);
  const secondItem = { ...item, recipient_id: otherDepartment };
  await enqueue({ items: [item, secondItem] });
  for (let index = 10; index < 20; index += 1) {
    const batchId = `00000000-0000-0000-0000-0000000000${index}`;
    assert.equal((await enqueue({ batchId })).items[0].error, 'receipt_duplicate');
  }

  const history = await list();
  assert.equal(history.length, 10);
  assert.equal(history[0].id, batch);
  assert.equal((await process()).status, 'succeeded');
  assert.deepEqual((await list())[0].items.map(({ status }) => status), ['succeeded', 'queued']);
  assert.equal((await process()).status, 'succeeded');
  assert.equal((await list())[0].id, batch, 'a batch stays visible when it finishes after newer failed batches');
  assert.deepEqual((await db.query('SELECT document_recipient_id FROM delivery_logs ORDER BY created_at')).rows,
    [{ document_recipient_id: id }, { document_recipient_id: otherDepartment }]);
});

test('limits active batches without blocking an idempotent retry or the next batch after completion', async (t) => {
  const { db, enqueue, list, process } = await fixture(t);
  const jobs = Array.from({ length: 6 }, (_, index) => ({
    batchId: `00000000-0000-0000-0000-0000000001${index}0`,
    items: [{ ...item, recipient_id: `00000000-0000-0000-0000-0000000002${index}0` }],
  }));
  for (const job of jobs) {
    await db.query('INSERT INTO document_recipients (id, document_id, department_id, status, updated_at) VALUES ($1, $2, $2, $3, $4)',
      [job.items[0].recipient_id, id, 'delivered', item.expected_updated_at]);
  }
  for (const job of jobs.slice(0, 5)) assert.equal((await enqueue(job)).items[0].status, 'queued');
  assert.equal((await enqueue(jobs[0])).id, jobs[0].batchId);
  await assert.rejects(enqueue(jobs[5]), /receipt_queue_busy/);
  assert.equal((await list()).length, 5);
  assert.equal((await process()).status, 'succeeded');
  assert.equal((await enqueue(jobs[5])).items[0].status, 'queued');
});
