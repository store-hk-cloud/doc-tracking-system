import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync('supabase/migrations/20260909054516_atomic_cash_and_profile_guards.sql', 'utf8');
const ids = {
  actorA: '00000000-0000-0000-0000-000000000001',
  actorB: '00000000-0000-0000-0000-000000000002',
  branchA: '00000000-0000-0000-0000-000000000011',
  branchB: '00000000-0000-0000-0000-000000000012',
  bank: '00000000-0000-0000-0000-000000000021',
  jobA: '00000000-0000-0000-0000-000000000031',
  jobB: '00000000-0000-0000-0000-000000000032',
  handover: '00000000-0000-0000-0000-000000000041',
  secondHandover: '00000000-0000-0000-0000-000000000042',
  superA: '00000000-0000-0000-0000-000000000051',
  superB: '00000000-0000-0000-0000-000000000052',
  photo: '00000000-0000-0000-0000-000000000061',
  report: '00000000-0000-0000-0000-000000000071',
};

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE departments (id uuid PRIMARY KEY, code text NOT NULL);
    CREATE TABLE profiles (
      id uuid PRIMARY KEY, role text NOT NULL DEFAULT 'user', is_active boolean NOT NULL DEFAULT true,
      department_id uuid
    );
    CREATE TABLE messenger_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), assigned_to uuid NOT NULL REFERENCES profiles(id),
      job_kind text NOT NULL DEFAULT 'cash_handover', status text NOT NULL, picked_up_at timestamptz,
      deposited_at timestamptz, completed_at timestamptz, closed_at timestamptz, closed_by uuid,
      closer_signature text, branch_id uuid, created_by uuid
    );
    CREATE TABLE cash_handovers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), branch_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending',
      accepted_pickup_id uuid, accepted_by uuid, accepted_at timestamptz
    );
    CREATE TABLE cash_pickups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES messenger_jobs(id),
      branch_id uuid NOT NULL, handover_id uuid, cashier_profile_id uuid, cashier_name text NOT NULL,
      envelope_count integer NOT NULL, envelope_amount_satang bigint NOT NULL, envelope_photo_id uuid,
      picked_up_at timestamptz NOT NULL, lat numeric, lng numeric, gps_accuracy_m numeric,
      received_by uuid NOT NULL, receiver_signature text NOT NULL, deposit_id uuid
    );
    CREATE UNIQUE INDEX uq_cash_pickups_job_branch ON cash_pickups(job_id, branch_id);
    CREATE TABLE bank_deposits (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES messenger_jobs(id),
      status text NOT NULL, bank_id uuid NOT NULL, bank_branch_id uuid, bank_branch_name text NOT NULL,
      expected_total_satang bigint NOT NULL, actual_amount_satang bigint NOT NULL,
      reference_no text NOT NULL, reference_no_source text NOT NULL, slip_photo_id uuid,
      slip_status text NOT NULL, deposited_at timestamptz NOT NULL, submitted_by uuid NOT NULL,
      submitted_signature text NOT NULL, resolved_review_id uuid,
      variance_satang bigint GENERATED ALWAYS AS (actual_amount_satang - expected_total_satang) STORED
    );
    CREATE UNIQUE INDEX uq_bank_deposits_ref ON bank_deposits(bank_id, reference_no) WHERE status <> 'voided';
    CREATE TABLE cash_variance_reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), deposit_id uuid NOT NULL,
      variance_kind text NOT NULL, reported_by uuid NOT NULL, status text NOT NULL DEFAULT 'pending_review'
    );
    CREATE TABLE cash_variance_reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL, decision text NOT NULL,
      variance_satang_at_decision bigint NOT NULL, actual_amount_satang_at_decision bigint NOT NULL,
      reason text NOT NULL, slip_checked boolean NOT NULL, reviewed_by uuid NOT NULL,
      reviewer_signature text NOT NULL, reviewer_role text NOT NULL, reviewer_dept_code text
    );
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    INSERT INTO profiles (id) VALUES ('${ids.actorA}'), ('${ids.actorB}');
  `);
  await db.exec(migration);
  await db.exec(`
    CREATE OR REPLACE FUNCTION test_advance_variance_report()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public, pg_temp
    AS $$
    BEGIN
      UPDATE cash_variance_reports SET status = NEW.decision WHERE id = NEW.report_id;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER test_advance_variance_report_trg
      BEFORE INSERT ON cash_variance_reviews
      FOR EACH ROW EXECUTE FUNCTION test_advance_variance_report();
  `);
  return db;
}

async function recordPickup(db, overrides = {}) {
  const values = {
    jobId: ids.jobA,
    actorId: ids.actorA,
    branchId: ids.branchA,
    handoverId: ids.handover,
    cashierProfileId: null,
    cashierName: 'แคชเชียร์ทดสอบ',
    envelopeCount: 1,
    envelopeAmount: 10000,
    photoId: null,
    pickedAt: '2026-09-09T01:00:00.000Z',
    lat: null,
    lng: null,
    accuracy: null,
    signature: 'ผู้รับทดสอบ',
    ...overrides,
  };
  return db.query(
    `SELECT public.record_cash_pickup($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) AS result`,
    [
      values.jobId, values.actorId, values.branchId, values.handoverId, values.cashierProfileId,
      values.cashierName, values.envelopeCount, values.envelopeAmount, values.photoId, values.pickedAt,
      values.lat, values.lng, values.accuracy, values.signature,
    ]
  );
}

async function recordDeposit(db, overrides = {}) {
  const values = {
    jobId: ids.jobA,
    actorId: ids.actorA,
    bankId: ids.bank,
    branchId: null,
    branchName: 'สาขาทดสอบ',
    amount: 10000,
    reference: 'DUP-REF',
    source: 'bank',
    photoId: null,
    depositedAt: '2026-09-09T02:00:00.000Z',
    signature: 'ผู้ฝากทดสอบ',
    ...overrides,
  };
  return db.query(
    `SELECT public.record_bank_deposit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result`,
    [
      values.jobId, values.actorId, values.bankId, values.branchId, values.branchName,
      values.amount, values.reference, values.source, values.photoId, values.depositedAt, values.signature,
    ]
  );
}

test('atomic pickup leaves a handover pending when the pickup insert is rejected', async () => {
  const db = await fixture();
  try {
    await db.exec(`
      INSERT INTO messenger_jobs (id, assigned_to, status) VALUES ('${ids.jobA}', '${ids.actorA}', 'picked_up');
      INSERT INTO cash_pickups (job_id, branch_id, cashier_name, envelope_count, envelope_amount_satang, picked_up_at, received_by, receiver_signature)
      VALUES ('${ids.jobA}', '${ids.branchA}', 'ก่อนหน้า', 1, 10000, now(), '${ids.actorA}', 'ผู้รับ');
      INSERT INTO cash_handovers (id, branch_id) VALUES ('${ids.handover}', '${ids.branchA}');
    `);

    await assert.rejects(recordPickup(db), /uq_cash_pickups_job_branch|duplicate key/i);
    const { rows: [handover] } = await db.query('SELECT status, accepted_by, accepted_at, accepted_pickup_id FROM cash_handovers WHERE id=$1', [ids.handover]);
    const { rows: [job] } = await db.query('SELECT status FROM messenger_jobs WHERE id=$1', [ids.jobA]);
    assert.deepEqual(handover, { status: 'pending', accepted_by: null, accepted_at: null, accepted_pickup_id: null });
    assert.equal(job.status, 'picked_up');
  } finally { await db.close(); }
});

test('atomic pickup records the handover link and job transition together', async () => {
  const db = await fixture();
  try {
    await db.exec(`
      INSERT INTO messenger_jobs (id, assigned_to, status) VALUES ('${ids.jobA}', '${ids.actorA}', 'open');
      INSERT INTO cash_handovers (id, branch_id) VALUES ('${ids.handover}', '${ids.branchA}');
    `);
    const { rows: [result] } = await recordPickup(db);
    assert.ok(result.result.pickup.id);
    const { rows: [handover] } = await db.query('SELECT status, accepted_by, accepted_pickup_id FROM cash_handovers WHERE id=$1', [ids.handover]);
    const { rows: [job] } = await db.query('SELECT status FROM messenger_jobs WHERE id=$1', [ids.jobA]);
    assert.equal(handover.status, 'accepted');
    assert.equal(handover.accepted_by, ids.actorA);
    assert.equal(handover.accepted_pickup_id, result.result.pickup.id);
    assert.equal(job.status, 'picked_up');
  } finally { await db.close(); }
});

test('atomic deposit preserves the picked-up job when a duplicate reference is rejected', async () => {
  const db = await fixture();
  try {
    await db.exec(`
      INSERT INTO messenger_jobs (id, assigned_to, status) VALUES
        ('${ids.jobA}', '${ids.actorA}', 'picked_up'),
        ('${ids.jobB}', '${ids.actorB}', 'completed');
      INSERT INTO cash_pickups (job_id, branch_id, cashier_name, envelope_count, envelope_amount_satang, picked_up_at, received_by, receiver_signature)
      VALUES ('${ids.jobA}', '${ids.branchA}', 'แคชเชียร์', 1, 10000, now(), '${ids.actorA}', 'ผู้รับ');
      INSERT INTO bank_deposits (job_id, status, bank_id, bank_branch_name, expected_total_satang, actual_amount_satang, reference_no, reference_no_source, slip_status, deposited_at, submitted_by, submitted_signature)
      VALUES ('${ids.jobB}', 'recorded', '${ids.bank}', 'สาขาเดิม', 10000, 10000, 'DUP-REF', 'bank', 'pending', now(), '${ids.actorB}', 'ผู้ฝาก');
    `);

    await assert.rejects(recordDeposit(db), /uq_bank_deposits_ref|duplicate key/i);
    const { rows: [job] } = await db.query('SELECT status, deposited_at FROM messenger_jobs WHERE id=$1', [ids.jobA]);
    const { rows: [pickup] } = await db.query('SELECT deposit_id FROM cash_pickups WHERE job_id=$1', [ids.jobA]);
    const { rows: [{ count }] } = await db.query('SELECT COUNT(*)::int AS count FROM bank_deposits WHERE job_id=$1', [ids.jobA]);
    assert.deepEqual(job, { status: 'picked_up', deposited_at: null });
    assert.equal(pickup.deposit_id, null);
    assert.equal(count, 0);
  } finally { await db.close(); }
});

test('atomic deposit commits its final matched and completed states together', async () => {
  const db = await fixture();
  try {
    await db.exec(`
      INSERT INTO messenger_jobs (id, assigned_to, status) VALUES ('${ids.jobA}', '${ids.actorA}', 'picked_up');
      INSERT INTO cash_pickups (job_id, branch_id, cashier_name, envelope_count, envelope_amount_satang, picked_up_at, received_by, receiver_signature)
      VALUES ('${ids.jobA}', '${ids.branchA}', 'แคชเชียร์', 1, 10000, now(), '${ids.actorA}', 'ผู้รับ');
    `);
    const { rows: [result] } = await recordDeposit(db, { reference: 'MATCH-REF', photoId: ids.photo });
    assert.equal(result.result.deposit.status, 'matched');
    assert.equal(result.result.job.status, 'completed');
    const { rows: [persisted] } = await db.query('SELECT status, completed_at FROM messenger_jobs WHERE id=$1', [ids.jobA]);
    assert.equal(persisted.status, 'completed');
    assert.ok(persisted.completed_at);
  } finally { await db.close(); }
});

test('atomic deposit keeps a variance together with its pending-review job', async () => {
  const db = await fixture();
  try {
    await db.exec(`
      INSERT INTO messenger_jobs (id, assigned_to, status) VALUES ('${ids.jobA}', '${ids.actorA}', 'picked_up');
      INSERT INTO cash_pickups (job_id, branch_id, cashier_name, envelope_count, envelope_amount_satang, picked_up_at, received_by, receiver_signature)
      VALUES ('${ids.jobA}', '${ids.branchA}', 'แคชเชียร์', 1, 10000, now(), '${ids.actorA}', 'ผู้รับ');
    `);
    const { rows: [result] } = await recordDeposit(db, { reference: 'VAR-REF', amount: 9000 });
    assert.equal(result.result.deposit.status, 'variance_pending');
    assert.equal(result.result.job.status, 'pending_review');
  } finally { await db.close(); }
});

test('atomic slip attachment rolls back the image when matching the deposit is rejected', async () => {
  const db = await fixture();
  try {
    await db.exec(`
      INSERT INTO messenger_jobs (id, assigned_to, status) VALUES ('${ids.jobA}', '${ids.actorA}', 'completed');
      INSERT INTO bank_deposits (
        job_id, status, bank_id, bank_branch_name, expected_total_satang, actual_amount_satang,
        reference_no, reference_no_source, slip_status, deposited_at, submitted_by, submitted_signature
      ) VALUES (
        '${ids.jobA}', 'recorded', '${ids.bank}', 'สาขาทดสอบ', 10000, 10000,
        'SLIP-REF', 'bank', 'pending', now(), '${ids.actorA}', 'ผู้ฝาก'
      );
      CREATE OR REPLACE FUNCTION fail_matched_deposit()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status = 'matched' THEN RAISE EXCEPTION 'matched_is_blocked'; END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER fail_matched_deposit_trg
        BEFORE UPDATE ON bank_deposits
        FOR EACH ROW EXECUTE FUNCTION fail_matched_deposit();
    `);
    const { rows: [deposit] } = await db.query('SELECT id FROM bank_deposits WHERE job_id=$1', [ids.jobA]);
    await assert.rejects(
      db.query('SELECT public.attach_bank_deposit_slip($1,$2,$3)', [deposit.id, ids.actorA, ids.photo]),
      /matched_is_blocked/
    );
    const { rows: [persisted] } = await db.query('SELECT status, slip_photo_id, slip_status FROM bank_deposits WHERE id=$1', [deposit.id]);
    assert.deepEqual(persisted, { status: 'recorded', slip_photo_id: null, slip_status: 'pending' });
  } finally { await db.close(); }
});

test('atomic variance approval resolves the deposit and closes its job together', async () => {
  const db = await fixture();
  try {
    await db.exec(`
      INSERT INTO messenger_jobs (id, assigned_to, status) VALUES ('${ids.jobA}', '${ids.actorA}', 'pending_review');
      INSERT INTO bank_deposits (
        job_id, status, bank_id, bank_branch_name, expected_total_satang, actual_amount_satang,
        reference_no, reference_no_source, slip_photo_id, slip_status, deposited_at, submitted_by, submitted_signature
      ) VALUES (
        '${ids.jobA}', 'variance_pending', '${ids.bank}', 'สาขาทดสอบ', 10000, 9000,
        'APPROVE-REF', 'bank', '${ids.photo}', 'attached', now(), '${ids.actorB}', 'ผู้ฝาก'
      );
      INSERT INTO cash_variance_reports (id, deposit_id, variance_kind, reported_by)
      SELECT '${ids.report}', id, 'short', '${ids.actorB}' FROM bank_deposits WHERE job_id='${ids.jobA}';
    `);
    const { rows: [result] } = await db.query(
      'SELECT public.review_cash_variance($1,$2,$3,$4,$5) AS result',
      [ids.report, 'approved', 'ทดสอบการอนุมัติผลต่าง', ids.actorA, 'ผู้อนุมัติ']
    );
    assert.equal(result.result.review.decision, 'approved');
    assert.equal(result.result.deposit.status, 'variance_resolved');
    assert.equal(result.result.job.status, 'closed');
    const { rows: [report] } = await db.query('SELECT status FROM cash_variance_reports WHERE id=$1', [ids.report]);
    assert.equal(report.status, 'approved');
  } finally { await db.close(); }
});

test('atomic variance approval rolls back review and report when its deposit cannot resolve', async () => {
  const db = await fixture();
  try {
    await db.exec(`
      INSERT INTO messenger_jobs (id, assigned_to, status) VALUES ('${ids.jobA}', '${ids.actorA}', 'pending_review');
      INSERT INTO bank_deposits (
        job_id, status, bank_id, bank_branch_name, expected_total_satang, actual_amount_satang,
        reference_no, reference_no_source, slip_photo_id, slip_status, deposited_at, submitted_by, submitted_signature
      ) VALUES (
        '${ids.jobA}', 'variance_pending', '${ids.bank}', 'สาขาทดสอบ', 10000, 9000,
        'REVIEW-REF', 'bank', '${ids.photo}', 'attached', now(), '${ids.actorB}', 'ผู้ฝาก'
      );
      INSERT INTO cash_variance_reports (id, deposit_id, variance_kind, reported_by)
      SELECT '${ids.report}', id, 'short', '${ids.actorB}' FROM bank_deposits WHERE job_id='${ids.jobA}';
      CREATE OR REPLACE FUNCTION fail_variance_resolution()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status = 'variance_resolved' THEN RAISE EXCEPTION 'variance_resolution_blocked'; END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER fail_variance_resolution_trg
        BEFORE UPDATE ON bank_deposits
        FOR EACH ROW EXECUTE FUNCTION fail_variance_resolution();
    `);
    await assert.rejects(
      db.query(
        'SELECT public.review_cash_variance($1,$2,$3,$4,$5)',
        [ids.report, 'approved', 'ทดสอบการอนุมัติผลต่าง', ids.actorA, 'ผู้อนุมัติ']
      ),
      /variance_resolution_blocked/
    );
    const { rows: [report] } = await db.query('SELECT status FROM cash_variance_reports WHERE id=$1', [ids.report]);
    const { rows: [deposit] } = await db.query('SELECT status, resolved_review_id FROM bank_deposits WHERE reference_no=$1', ['REVIEW-REF']);
    const { rows: [job] } = await db.query('SELECT status FROM messenger_jobs WHERE id=$1', [ids.jobA]);
    const { rows: [{ count }] } = await db.query('SELECT COUNT(*)::int AS count FROM cash_variance_reviews WHERE report_id=$1', [ids.report]);
    assert.equal(report.status, 'pending_review');
    assert.deepEqual(deposit, { status: 'variance_pending', resolved_review_id: null });
    assert.equal(job.status, 'pending_review');
    assert.equal(count, 0);
  } finally { await db.close(); }
});

test('database guards keep one active cash run and one active super_admin', async () => {
  const db = await fixture();
  try {
    await db.exec(`
      INSERT INTO messenger_jobs (id, assigned_to, status) VALUES ('${ids.jobA}', '${ids.actorA}', 'open');
      INSERT INTO profiles (id, role) VALUES ('${ids.superA}', 'super_admin'), ('${ids.superB}', 'super_admin');
    `);
    await assert.rejects(
      db.query(`INSERT INTO messenger_jobs (assigned_to, status) VALUES ($1, 'open')`, [ids.actorA]),
      /uq_messenger_jobs_active_cash_handover|duplicate key/i
    );
    await db.query('UPDATE profiles SET role=$1 WHERE id=$2', ['user', ids.superA]);
    await assert.rejects(
      db.query('UPDATE profiles SET is_active=false WHERE id=$1', [ids.superB]),
      /last_active_super_admin/
    );
    await assert.rejects(db.query('DELETE FROM profiles WHERE id=$1', [ids.superB]), /last_active_super_admin/);
  } finally { await db.close(); }
});

test('atomic guards migration can be reapplied safely', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
  } finally { await db.close(); }
});
