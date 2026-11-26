import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { loadModule } from './test-support/load-module.mjs';

const u = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const dept = { adm03: u(1), adm04: u(2), pdt01: u(3), bsn10: u(4), ops: u(5), other: u(6) };
const people = { clerkA: u(11), clerkB: u(12), admin: u(13), ops: u(14), other: u(15), adm04: u(16),
  pdt01: u(17), bsn10: u(18), adm03: u(19), inactive: u(20) };
const migration = 'supabase/migrations/20261126100000_document_queue_order.sql';
const baseMigrations = [
  'supabase/migrations/20260908013605_atomic_delivery_verification.sql',
  'supabase/migrations/20261110110000_apps_script_sheet_sync.sql',
  'supabase/migrations/20261110121000_receive_document_worker.sql',
  'supabase/migrations/20261110123000_bulk_receipt_queue.sql',
];
const stamp = '2026-11-10T00:00:00Z';

// legacy คือแถวที่มีอยู่ก่อน migration (ยังไม่มี queue_rank) เพื่อทดสอบ backfill
async function fixture(t, { legacy = '' } = {}) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    SET TIME ZONE 'UTC';
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE FUNCTION update_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
    CREATE TABLE departments (id uuid PRIMARY KEY, code varchar(50) UNIQUE NOT NULL, name text);
    CREATE TABLE profiles (id uuid PRIMARY KEY, full_name varchar(255) NOT NULL,
      role varchar(50) NOT NULL, department_id uuid REFERENCES departments(id), is_active boolean DEFAULT true);
    CREATE TABLE documents (id uuid PRIMARY KEY, subject text NOT NULL, display_no text,
      running_no bigint, received_date date, doc_number text, sender text, is_damaged boolean,
      damage_image_url text, note text, recorded_by uuid, tax_invoice_no text);
    CREATE TABLE document_recipients (id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES documents(id),
      department_id uuid NOT NULL REFERENCES departments(id), status varchar(50) NOT NULL,
      admin_signature text, admin_signed_at timestamptz, inspector_verified boolean, purchasing_verified boolean,
      inspector_verification_note text, purchasing_verification_note text, updated_at timestamptz DEFAULT now());
    CREATE TRIGGER document_recipients_updated_at BEFORE UPDATE ON document_recipients
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    CREATE TABLE delivery_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      document_recipient_id uuid REFERENCES document_recipients(id), document_id uuid NOT NULL REFERENCES documents(id),
      recipient_id uuid NOT NULL REFERENCES profiles(id), recipient_signature text NOT NULL, recipient_signed_at timestamptz DEFAULT now(),
      is_verified boolean, verification_note text, verified_by_admin boolean DEFAULT false, verified_by_admin_at timestamptz,
      created_at timestamptz DEFAULT now());
    INSERT INTO departments (id, code) VALUES ('${dept.adm03}', '0-ADM03'), ('${dept.adm04}', '0-ADM04'),
      ('${dept.pdt01}', '0-PDT01'), ('${dept.bsn10}', '0-BSN10'), ('${dept.ops}', 'OPS'), ('${dept.other}', 'OTHER');
    INSERT INTO profiles VALUES
      ('${people.clerkA}', 'A', 'user', '${dept.ops}', true), ('${people.clerkB}', 'B', 'user', '${dept.ops}', true),
      ('${people.admin}', 'Admin', 'admin', '${dept.ops}', true), ('${people.ops}', 'Ops', 'user', '${dept.ops}', true),
      ('${people.other}', 'Other', 'user', '${dept.other}', true), ('${people.adm04}', 'Adm04', 'user', '${dept.adm04}', true),
      ('${people.pdt01}', 'Pdt01', 'user', '${dept.pdt01}', true), ('${people.bsn10}', 'Bsn10', 'user', '${dept.bsn10}', true),
      ('${people.adm03}', 'Adm03', 'user', '${dept.adm03}', true), ('${people.inactive}', 'Off', 'user', '${dept.ops}', false);
    ALTER TABLE document_recipients ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT INSERT, UPDATE ON document_recipients TO service_role;
  `);
  for (const path of baseMigrations) await db.exec(readFileSync(path, 'utf8'));
  await db.exec(legacy);
  await db.exec('DELETE FROM apps_script_sheet_private.jobs');
  const sql = readFileSync(migration, 'utf8');
  await db.exec(sql);

  let next = 100;
  const add = async ({ subject = 'จดหมาย', status = 'registered', department = dept.ops, recordedBy = people.clerkA } = {}) => {
    const n = next++;
    await db.query('INSERT INTO documents (id, subject, running_no, recorded_by) VALUES ($1,$2,$3,$4)', [u(n), subject, n, recordedBy]);
    await db.query('INSERT INTO document_recipients (id, document_id, department_id, status, updated_at) VALUES ($1,$1,$3,$2,$4)',
      [u(n), status, department, stamp]);
    return u(n);
  };
  return {
    db, sql, add,
    reorder: (actor, scope, ids) => db.query('SELECT public.reorder_document_recipients($1,$2,$3::uuid[]) AS result',
      [actor, scope, ids]).then((r) => r.rows[0].result),
    order: async () => (await db.query('SELECT id FROM document_recipients ORDER BY queue_rank DESC, id')).rows.map((r) => r.id),
    snapshot: async () => (await db.query('SELECT id, queue_rank::text AS queue_rank, updated_at FROM document_recipients ORDER BY id')).rows,
    jobs: async () => (await db.query('SELECT count(*)::int AS n FROM apps_script_sheet_private.jobs')).rows[0].n,
  };
}

test('backfill keeps the old running_no DESC order without touching updated_at or Sheets jobs', async (t) => {
  const legacy = `
    INSERT INTO documents (id, subject, running_no) VALUES ('${u(51)}', 'x', 10), ('${u(52)}', 'x', 30), ('${u(53)}', 'x', 20);
    INSERT INTO document_recipients (id, document_id, department_id, status, updated_at) VALUES
      ('${u(61)}', '${u(51)}', '${dept.ops}', 'registered', '${stamp}'),
      ('${u(63)}', '${u(52)}', '${dept.ops}', 'registered', '${stamp}'),
      ('${u(62)}', '${u(52)}', '${dept.other}', 'registered', '${stamp}'),
      ('${u(64)}', '${u(53)}', '${dept.ops}', 'registered', '${stamp}');`;
  const { db, order, jobs, add } = await fixture(t, { legacy });
  assert.deepEqual(await order(), [u(62), u(63), u(64), u(61)]);
  assert.deepEqual((await db.query('SELECT DISTINCT updated_at FROM document_recipients')).rows.map((r) => r.updated_at.toISOString()),
    ['2026-11-10T00:00:00.000Z']);
  assert.equal(await jobs(), 0);

  const fresh = await add();
  assert.equal((await order())[0], fresh, 'a new row lands on top, as before');
});

test('service_role can insert without queue_rank and anon/authenticated cannot use the sequence', async (t) => {
  const { db, order } = await fixture(t);
  await db.exec(`INSERT INTO documents (id, subject, running_no) VALUES ('${u(70)}', 'x', 1), ('${u(71)}', 'x', 2)`);
  await db.exec('SET ROLE service_role');
  await db.exec(`INSERT INTO document_recipients (id, document_id, department_id, status) VALUES ('${u(70)}', '${u(70)}', '${dept.ops}', 'registered')`);
  await db.exec(`INSERT INTO document_recipients (id, document_id, department_id, status) VALUES ('${u(71)}', '${u(71)}', '${dept.ops}', 'registered')`);
  await db.exec('RESET ROLE');
  assert.deepEqual(await order(), [u(71), u(70)]);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(db.query("SELECT nextval('public.document_recipients_queue_rank_seq')"), /permission denied/);
    await db.exec('RESET ROLE');
  }
});

test('delivery order stacks each clerk block on top in the order sent', async (t) => {
  const { db, add, reorder, order } = await fixture(t);
  const a = [await add(), await add(), await add()];
  assert.deepEqual(await reorder(people.clerkA, 'delivery', [a[0], a[1], a[2]]), { count: 3 });
  assert.deepEqual(await order(), [a[0], a[1], a[2]]);
  const b = [await add({ recordedBy: people.clerkB }), await add({ recordedBy: people.clerkB })];
  assert.deepEqual(await order(), [b[1], b[0], a[0], a[1], a[2]]);
  await reorder(people.clerkB, 'delivery', [b[0], b[1]]);
  assert.deepEqual(await order(), [b[0], b[1], a[0], a[1], a[2]]);
  await reorder(people.admin, 'delivery', [a[2], b[1]]);
  assert.deepEqual(await order(), [a[2], b[1], b[0], a[0], a[1]]);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM document_recipients WHERE queue_rank IS NULL")).rows[0].n, 0);
});

test('stage order swaps only the chosen slots and skips writes when nothing changes', async (t) => {
  const { db, add, reorder, order, snapshot } = await fixture(t);
  const rows = [];
  for (let index = 0; index < 5; index += 1) rows.push(await add({ status: 'delivered' }));
  // เรียงบนลงล่างเดิม: rows[4], rows[3], rows[2], rows[1], rows[0]
  const before = await snapshot();
  await reorder(people.ops, 'stage', [rows[0], rows[4]]);
  assert.deepEqual(await order(), [rows[0], rows[3], rows[2], rows[1], rows[4]]);
  const after = await snapshot();
  for (const id of [rows[1], rows[2], rows[3]]) {
    assert.deepEqual(after.find((r) => r.id === id), before.find((r) => r.id === id));
  }
  await db.exec(`CREATE TABLE writes (n int); CREATE FUNCTION count_write() RETURNS trigger LANGUAGE plpgsql
    AS $$ BEGIN INSERT INTO writes VALUES (1); RETURN NEW; END $$;
    CREATE TRIGGER count_write AFTER UPDATE ON document_recipients FOR EACH ROW EXECUTE FUNCTION count_write()`);
  const current = await order();
  assert.deepEqual(await reorder(people.ops, 'stage', [current[0], current[2]]), { count: 2 });
  assert.equal((await db.query('SELECT count(*)::int AS n FROM writes')).rows[0].n, 0);
});

test('reordering leaves updated_at and Sheets jobs alone, but real updates still touch both', async (t) => {
  const { db, add, reorder, snapshot, jobs } = await fixture(t);
  const ids = [await add({ status: 'delivered' }), await add({ status: 'delivered' })];
  await db.exec('DELETE FROM apps_script_sheet_private.jobs');
  const before = (await snapshot()).map((r) => r.updated_at.toISOString());
  await reorder(people.ops, 'stage', [ids[0], ids[1]]);
  assert.deepEqual((await snapshot()).map((r) => r.updated_at.toISOString()), before);
  assert.equal(await jobs(), 0);
  await db.query("UPDATE document_recipients SET status = 'signed' WHERE id = $1", [ids[0]]);
  assert.equal(await jobs(), 1);
  const [changed] = (await db.query('SELECT updated_at FROM document_recipients WHERE id = $1', [ids[0]])).rows;
  assert.ok(changed.updated_at > new Date(stamp));
  const [rest] = (await db.query('SELECT updated_at FROM document_recipients WHERE id = $1', [ids[1]])).rows;
  assert.equal(rest.updated_at.toISOString(), before[1]);
});

test('rejections write nothing', async (t) => {
  const { db, add, reorder, snapshot, jobs } = await fixture(t);
  const mine = await add({ recordedBy: people.clerkA });
  const theirs = await add({ recordedBy: people.clerkB });
  const delivered = await add({ status: 'delivered', recordedBy: people.clerkA });
  const goods = await add({ subject: 'ใบรับสินค้า', status: 'awaiting_purchasing', department: dept.adm03 });
  const goods2 = await add({ subject: 'ใบรับสินค้า', status: 'awaiting_inspector', department: dept.adm03 });
  const otherDept = await add({ status: 'delivered', department: dept.other });
  const ops = await add({ status: 'delivered' });
  await db.exec('DELETE FROM apps_script_sheet_private.jobs');
  const before = await snapshot();
  const cases = [
    ['cross department', people.ops, 'stage', [ops, otherDept], /order_forbidden/],
    ['wrong stage', people.adm04, 'stage', [goods], /order_stale/],
    ['stage mixed with wrong status', people.adm04, 'stage', [goods2, goods], /order_stale/],
    ['someone else registered doc', people.clerkA, 'delivery', [mine, theirs], /order_forbidden/],
    ['already delivered in delivery scope', people.clerkA, 'delivery', [mine, delivered], /order_stale/],
    ['unknown id', people.admin, 'delivery', [mine, u(999)], /order_stale/],
    ['duplicate ids', people.admin, 'delivery', [mine, mine], /order_invalid/],
    ['empty', people.admin, 'delivery', [], /order_invalid/],
    ['null element', people.admin, 'delivery', [mine, null], /order_invalid/],
    ['null array', people.admin, 'delivery', null, /order_invalid/],
    ['too many', people.admin, 'delivery', Array.from({ length: 501 }, (_, i) => u(2000 + i)), /order_invalid/],
    ['bad scope', people.admin, 'all', [mine], /order_invalid/],
    ['null scope', people.admin, null, [mine], /order_invalid/],
    ['inactive actor', people.inactive, 'delivery', [mine], /receipt_actor_not_authenticated/],
    ['unknown actor', u(998), 'delivery', [mine], /receipt_actor_not_authenticated/],
  ];
  for (const [name, actor, scope, ids, pattern] of cases) {
    await assert.rejects(reorder(actor, scope, ids), pattern, name);
  }
  await assert.rejects(reorder(people.admin, 'delivery', []), (error) => error.code === '22023');
  assert.deepEqual(await snapshot(), before);
  assert.equal(await jobs(), 0);

  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(reorder(people.admin, 'delivery', [mine]), /permission denied/);
    await db.exec('RESET ROLE');
  }
  assert.deepEqual(await snapshot(), before);
});

test('500 ids are accepted', async (t) => {
  const { db, reorder } = await fixture(t);
  await db.exec(`INSERT INTO documents (id, subject, running_no, recorded_by)
      SELECT gen_random_uuid(), 'x', g, '${people.clerkA}' FROM generate_series(1, 500) g;
    INSERT INTO document_recipients (id, document_id, department_id, status)
      SELECT gen_random_uuid(), id, '${dept.ops}', 'registered' FROM documents`);
  const ids = (await db.query('SELECT id FROM document_recipients ORDER BY queue_rank')).rows.map((r) => r.id);
  assert.deepEqual(await reorder(people.clerkA, 'delivery', ids), { count: 500 });
});

test('SQL stage permission matches getGoodsReceiptWorkflowAction for the stage waiting status', async (t) => {
  const { getGoodsReceiptWorkflowAction } = loadModule('src/lib/document-workflow.ts');
  const { db, add, reorder } = await fixture(t);
  const id = await add({ subject: 'ใบรับสินค้า', department: dept.adm03 });
  const actors = { '0-ADM04': people.adm04, '0-PDT01': people.pdt01, '0-BSN10': people.bsn10, '0-ADM03': people.adm03, OPS: people.ops };
  const waiting = { inspector: 'awaiting_inspector', purchasing: 'awaiting_purchasing', recipient: 'awaiting_recipient' };
  const statuses = ['registered', 'delivered', 'awaiting_inspector', 'awaiting_purchasing', 'awaiting_recipient', 'closed', 'signed', 'rejected'];
  for (const [code, actor] of Object.entries(actors)) {
    for (const status of statuses) {
      await db.query('UPDATE document_recipients SET status = $1 WHERE id = $2', [status, id]);
      const action = getGoodsReceiptWorkflowAction(code, status);
      const expected = action !== null && waiting[action] === status;
      const allowed = await reorder(actor, 'stage', [id]).then(() => true, () => false);
      assert.equal(allowed, expected, `${code} / ${status}`);
    }
  }
});

test('order survives moving to the next stage', async (t) => {
  const { db, add, reorder, order } = await fixture(t);
  const ids = [];
  for (let index = 0; index < 3; index += 1) {
    ids.push(await add({ subject: 'ใบรับสินค้า', status: 'awaiting_inspector', department: dept.adm03 }));
  }
  await reorder(people.adm04, 'stage', [ids[1], ids[2], ids[0]]);
  assert.deepEqual(await order(), [ids[1], ids[2], ids[0]]);
  await db.exec("UPDATE document_recipients SET status = 'awaiting_purchasing'");
  assert.deepEqual(await order(), [ids[1], ids[2], ids[0]]);
  await reorder(people.bsn10, 'stage', [ids[0], ids[1]]);
  assert.deepEqual(await order(), [ids[0], ids[2], ids[1]]);
});

test('migration is repeatable and keeps existing ranks, trigger names and grants', async (t) => {
  const { db, sql, add, reorder, snapshot, jobs, order } = await fixture(t);
  const ids = [await add({ status: 'delivered' }), await add({ status: 'delivered' }), await add({ status: 'delivered' })];
  await reorder(people.ops, 'stage', [ids[0], ids[1]]);
  const ranks = (await snapshot()).map((r) => r.queue_rank);
  await db.exec('DELETE FROM apps_script_sheet_private.jobs');
  await db.exec(sql);
  await db.exec(sql);
  assert.deepEqual((await snapshot()).map((r) => r.queue_rank), ranks);
  assert.equal(await jobs(), 0);
  const triggers = (await db.query(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'document_recipients'::regclass
    AND NOT tgisinternal ORDER BY tgname`)).rows.map((r) => r.tgname);
  assert.deepEqual(triggers, ['apps_script_sheet_recipient_inserted', 'apps_script_sheet_recipient_updated', 'document_recipients_updated_at']);
  const fresh = await add({ status: 'delivered' });
  assert.equal((await order())[0], fresh);
  await db.exec('SET ROLE service_role');
  assert.deepEqual(await reorder(people.ops, 'stage', [ids[0], fresh]), { count: 2 });
});
