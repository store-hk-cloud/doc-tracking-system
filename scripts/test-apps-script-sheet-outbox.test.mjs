import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const path = 'supabase/migrations/20261110110000_apps_script_sheet_sync.sql';
const token = '4d2a03588be67e2c6dc8a6f77593f242c2919a154a1822fcc5295fe2302c1d68';
const first = '10000000-0000-0000-0000-000000000001';
const second = '10000000-0000-0000-0000-000000000002';
const doc = '20000000-0000-0000-0000-000000000001';
const db = new PGlite();

async function value(sql, args = []) {
  return (await db.query(sql, args)).rows[0].value;
}

const pull = (key = token, limit = 100) => value(
  'SELECT public.pull_apps_script_sheet_jobs($1, $2) AS value', [key, limit],
);
const finish = (job, success) => value(
  'SELECT public.finish_apps_script_sheet_job($1, $2, $3, $4) AS value',
  [token, job.id, job.revision, success],
);

before(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE profiles (id uuid PRIMARY KEY, full_name text);
    CREATE TABLE departments (id uuid PRIMARY KEY, name text);
    CREATE TABLE documents (
      id uuid PRIMARY KEY, display_no text, running_no bigint, received_date date,
      doc_number text, sender text, subject text, is_damaged boolean,
      damage_image_url text, note text, recorded_by uuid, tax_invoice_no text
    );
    CREATE TABLE document_recipients (
      id uuid PRIMARY KEY, document_id uuid REFERENCES documents ON DELETE CASCADE,
      department_id uuid, status text, admin_signature text, admin_signed_at timestamptz,
      inspector_verified boolean, purchasing_verified boolean, inspector_verification_note text,
      purchasing_verification_note text, updated_at timestamptz
    );
    CREATE TABLE delivery_logs (
      id uuid PRIMARY KEY, document_recipient_id uuid REFERENCES document_recipients ON DELETE CASCADE,
      created_at timestamptz, recipient_id uuid, recipient_signature text,
      recipient_signed_at timestamptz, is_verified boolean, verification_note text
    );
  `);
  if (existsSync(path)) await db.exec(readFileSync(path, 'utf8'));
});
after(() => db.close());

test('migration exposes the scoped pull RPC', async () => {
  assert.equal(await value(
    "SELECT to_regprocedure('public.pull_apps_script_sheet_jobs(text,integer)') IS NOT NULL AS value",
  ), true);
});

test('token configuration and activation require service access', async () => {
  assert.equal(await value('SELECT public.is_apps_script_sheet_sync_enabled() AS value'), false);
  await assert.rejects(pull(), { code: '42501' });
  await db.exec('SET ROLE service_role');
  try {
    await db.query('SELECT public.configure_apps_script_sheet_sync($1, false)', [token]);
    await db.query('SELECT public.configure_apps_script_sheet_sync(NULL, true)');
    assert.equal(await value('SELECT public.is_apps_script_sheet_sync_enabled() AS value'), true);
    await db.query('SELECT public.configure_apps_script_sheet_sync(NULL, false)');
  } finally {
    await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE anon');
  try {
    await assert.rejects(pull('wrong'), { code: '42501' });
    await assert.rejects(db.query('SELECT public.configure_apps_script_sheet_sync($1, true)', [token]), { code: '42501' });
    await assert.rejects(db.query('SELECT * FROM apps_script_sheet_private.settings'), { code: '42501' });
    await assert.rejects(db.query('SELECT * FROM apps_script_sheet_private.jobs'), { code: '42501' });
    await assert.rejects(db.query('SELECT public.enqueue_all_apps_script_sheet_jobs()'), { code: '42501' });
    assert.deepEqual(await pull(), []);
  } finally {
    await db.exec('RESET ROLE');
  }
});

test('projects canonical A:U, latest delivery, waiting and rejection variants', async () => {
  await db.query('SELECT public.configure_apps_script_sheet_sync(NULL, true)');
  await db.exec(`
    INSERT INTO departments VALUES ('30000000-0000-0000-0000-000000000001', 'Accounting');
    INSERT INTO profiles VALUES ('40000000-0000-0000-0000-000000000001', 'Recorder'),
      ('40000000-0000-0000-0000-000000000002', 'Recipient');
    INSERT INTO documents VALUES ('${doc}', '', 42, '2026-11-10', 'REF', 'Vendor', 'Subject',
      true, 'image', 'note', '40000000-0000-0000-0000-000000000001', 'TAX');
    INSERT INTO document_recipients VALUES
      ('${first}', '${doc}', '30000000-0000-0000-0000-000000000001', 'signed', 'admin-sign',
        '2026-11-10 08:00:00+00', NULL, NULL, NULL, NULL, '2026-11-10 10:00:00+00'),
      ('${second}', '${doc}', NULL, 'awaiting_inspector', NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    INSERT INTO delivery_logs VALUES
      ('50000000-0000-0000-0000-000000000002', '${first}', '2026-11-10', NULL, 'old', NULL, false, 'old'),
      ('50000000-0000-0000-0000-000000000001', '${first}', '2026-11-10',
        '40000000-0000-0000-0000-000000000002', 'recipient-sign', '2026-11-10 09:00:00+00', true, 'checked'),
      ('50000000-0000-0000-0000-000000000003', '${second}', '2026-11-10', NULL, 'hidden', NULL, false, 'hidden');
  `);
  const jobs = await pull();
  const signed = jobs.find((job) => job.id === first);
  const waiting = jobs.find((job) => job.id === second);
  assert.equal(typeof signed.revision, 'string');
  assert.equal(signed.sheet_name, '2026-11-10');
  assert.equal(signed.single_recipient, false);
  assert.deepEqual(signed.values, [
    '42', '2026-11-10', 'REF', 'Vendor', 'Subject', 'Accounting', 'signed', 'admin-sign',
    '2026-11-10T08:00:00+00:00', 'Recipient', 'recipient-sign', '2026-11-10T09:00:00+00:00',
    'ถูกต้อง', 'checked', 'ใช่', 'image', 'note', 'Recorder', '2026-11-10T10:00:00+00:00', 'TAX', first,
  ]);
  assert.deepEqual(waiting.values.slice(9, 14), ['', '', '', '', '']);
  await db.exec(`UPDATE document_recipients SET status = 'rejected', inspector_verified = false,
    inspector_verification_note = 'reason' WHERE id = '${second}'`);
  const rejected = (await pull()).find((job) => job.id === second);
  assert.deepEqual(rejected.values.slice(9, 14), ['', '', '', 'ไม่ถูกต้อง', 'ผู้ตรวจสอบ: reason']);
});

test('disabled consumer cannot read pending jobs and zero limit only checks credentials', async () => {
  const pending = await pull();
  assert.equal(pending.length, 2);
  assert.deepEqual(await pull(token, 0), []);
  await assert.rejects(pull('wrong', 0), { code: '42501' });
  await db.exec('BEGIN');
  await db.query('SELECT public.configure_apps_script_sheet_sync(NULL, false)');
  assert.deepEqual(await pull(), []);
  assert.equal(await finish(pending[0], true), true);
  await db.exec('ROLLBACK');
});

test('source writes roll back with their revision and document updates fan out', async () => {
  const prior = await pull();
  await db.exec("BEGIN; UPDATE documents SET subject = 'rolled back'; ROLLBACK;");
  assert.deepEqual(await pull(), prior);
  await db.exec("UPDATE documents SET subject = 'changed', display_no = '2026-11/042'");
  const changed = await pull();
  assert.equal(changed.length, 2);
  for (const job of changed) {
    assert.equal(job.values[0], '2026-11/042');
    assert.equal(job.values[4], 'changed');
    const old = prior.find((entry) => entry.id === job.id);
    assert.notEqual(job.revision, old.revision);
    assert.equal(await finish(old, true), false);
  }
});

test('failed jobs defer, newer edits reset delay, and delivery deletes reproject', async () => {
  const failed = (await pull()).find((job) => job.id === first);
  assert.equal(await finish(failed, false), true);
  assert.equal((await pull(token, 1))[0].id, second);
  await db.exec("UPDATE delivery_logs SET verification_note = 'corrected' WHERE id = '50000000-0000-0000-0000-000000000001'");
  const changed = (await pull()).find((job) => job.id === first);
  assert.equal(changed.values[13], 'corrected');
  assert.notEqual(changed.revision, failed.revision);
  await db.exec("DELETE FROM delivery_logs WHERE id = '50000000-0000-0000-0000-000000000001'");
  const remaining = (await pull()).find((job) => job.id === first);
  assert.equal(remaining.values[10], 'old');
  assert.equal(await finish(remaining, true), true);
  assert.equal(await finish(remaining, true), false);
});

test('service backfill queues existing recipients and cascaded deletes remove work', async () => {
  await db.exec('SET ROLE service_role');
  try {
    assert.equal(await value('SELECT public.enqueue_apps_script_sheet_jobs($1) AS value', [[first, first]]), 1);
    assert.equal(await value('SELECT public.enqueue_all_apps_script_sheet_jobs() AS value'), 2);
  } finally {
    await db.exec('RESET ROLE');
  }
  assert.equal((await pull()).length, 2);
  await db.exec(`DELETE FROM document_recipients WHERE id = '${second}'`);
  assert.equal((await pull())[0].single_recipient, true);
  await db.exec('DELETE FROM documents');
  assert.deepEqual(await pull(), []);
});
