/**
 * ทดสอบกลไก "สองฝ่ายยืนยันยอดต้นทาง" หลัง migration 016
 *
 * ข้อที่สำคัญที่สุด: เมื่อซองมาจากการประกาศของแคชเชียร์ **แมสเซนเจอร์ต้องคีย์ยอด
 * ต่างจากที่แคชเชียร์ประกาศไม่ได้เลย** ต้องบังคับที่ฐานข้อมูล ไม่ใช่ที่หน้าจอ
 * เพราะทุก route ในโปรเจกต์นี้ใช้ service-role ซึ่ง bypass RLS ทั้งหมด
 *
 * รันในทรานแซกชันเดียวและ ROLLBACK เสมอ ฐานข้อมูลจริงไม่ถูกแตะ
 *
 *   node scripts/verify-cashier-handover.mjs
 */
import pg from 'pg';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    })
);

const url = new URL(env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL);
url.searchParams.delete('sslmode');
const client = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
};

async function expectFail(sql, params, label, pattern) {
  await client.query('SAVEPOINT sp');
  try {
    await client.query(sql, params);
    await client.query('ROLLBACK TO SAVEPOINT sp');
    ok(false, label, 'คำสั่งสำเร็จ ทั้งที่ต้องถูกปฏิเสธ');
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT sp');
    ok(pattern.test(e.message), label, e.message.slice(0, 120));
  }
}

async function expectOk(sql, params, label) {
  await client.query('SAVEPOINT sp');
  try {
    const r = await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT sp');
    ok(true, label);
    return r;
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT sp');
    ok(false, label, e.message.slice(0, 150));
    return null;
  }
}

await client.connect();
await client.query('BEGIN');

try {
  // ── เตรียมข้อมูล: สาขาที่ผูกหน่วยงาน + คนในหน่วยงานนั้น (แคชเชียร์) + แมสเซนเจอร์
  const { rows: [branch] } = await client.query(
    `SELECT b.id, b.name, b.department_id FROM branches b
     WHERE b.is_active AND b.department_id IS NOT NULL LIMIT 1`
  );
  if (!branch) throw new Error('ต้องมีสาขาที่ผูกหน่วยงานอย่างน้อยหนึ่งแห่ง');

  // สร้างโปรไฟล์ชั่วคราวในทรานแซกชัน (rollback ทิ้งทั้งหมด)
  const mkProfile = async (name, deptId) => {
    const { rows: [u] } = await client.query(
      `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, created_at, updated_at)
       VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', gen_random_uuid() || '@qa.invalid', 'x', now(), now(), now())
       RETURNING id`
    );
    await client.query(
      `INSERT INTO profiles (id, email, full_name, role, department_id, is_active)
       VALUES ($1, gen_random_uuid() || '@qa.invalid', $2, 'user', $3, true)`,
      [u.id, name, deptId]
    );
    return u.id;
  };

  const { rows: [msgDept] } = await client.query(`SELECT id FROM departments WHERE code = 'MSG'`);
  const cashierId = await mkProfile('QA แคชเชียร์', branch.department_id);
  const otherDeptId = (
    await client.query(`SELECT id FROM departments WHERE id <> $1 LIMIT 1`, [branch.department_id])
  ).rows[0].id;
  const outsiderId = await mkProfile('QA คนนอกสาขา', otherDeptId);
  const messengerId = await mkProfile('QA แมสเซนเจอร์', msgDept?.id || otherDeptId);

  console.log(`\nสาขาทดสอบ: ${branch.name}`);

  console.log('\n1) แคชเชียร์ประกาศยอดหน้าซอง (ส่งซอง)');
  const declared = 2500075; // 25,000.75 บาท
  const h = await expectOk(
    `INSERT INTO cash_handovers (branch_id, declared_amount_satang, envelope_count,
        declared_by, declarer_signature)
     VALUES ($1, $2, 2, $3, 'QA แคชเชียร์') RETURNING id, handover_no, status`,
    [branch.id, declared, cashierId],
    'แคชเชียร์ของสาขานั้นส่งซองได้'
  );
  if (!h) throw new Error('ส่งซองไม่สำเร็จ หยุดทดสอบ');
  const handoverId = h.rows[0].id;
  ok(h.rows[0].status === 'pending', `สถานะเริ่มต้นเป็น pending (ได้ ${h.rows[0].status})`);

  console.log('\n2) คนที่ไม่ได้อยู่หน่วยงานของสาขา ส่งซองในนามสาขานั้นไม่ได้');
  await expectFail(
    `INSERT INTO cash_handovers (branch_id, declared_amount_satang, envelope_count,
        declared_by, declarer_signature)
     VALUES ($1, 1000, 1, $2, 'QA คนนอก')`,
    [branch.id, outsiderId],
    'คนนอกหน่วยงานถูกปฏิเสธ',
    /does not belong to the department/
  );

  console.log('\n3) ยอดที่ประกาศแล้วแก้ไม่ได้');
  await expectFail(
    `UPDATE cash_handovers SET declared_amount_satang = 1 WHERE id = $1`,
    [handoverId],
    'UPDATE ยอดที่ประกาศถูกปฏิเสธ',
    /declared_amount_satang is write-once/
  );
  await expectFail(
    `DELETE FROM cash_handovers WHERE id = $1`,
    [handoverId],
    'ลบใบประกาศไม่ได้',
    /append-only|not permitted/i
  );

  // เตรียมทริปของแมสเซนเจอร์ + รูปซอง
  const { rows: [job] } = await client.query(
    `INSERT INTO messenger_jobs (job_kind, status, branch_id, assigned_to, created_by)
     VALUES ('cash_handover', 'open', NULL, $1, $1) RETURNING id`,
    [messengerId]
  );
  const mkPhoto = async (seed) => {
    const { rows: [p] } = await client.query(
      `INSERT INTO messenger_job_photos (job_id, photo_kind, view_link, content_sha256,
          uploaded_by, uploader_signature)
       VALUES ($1, 'cash_envelope', 'https://example.invalid/x', $2, $3, 'ทดสอบ') RETURNING id`,
      [job.id, String(seed).padEnd(64, 'e'), messengerId]
    );
    return p.id;
  };
  const photo1 = await mkPhoto('h1');

  console.log('\n4) จุดรับต้องอ้างซองที่ถูก accept แล้วเท่านั้น');
  await expectFail(
    `INSERT INTO cash_pickups (job_id, branch_id, handover_id, cashier_name, envelope_count,
        envelope_amount_satang, envelope_photo_id, received_by, receiver_signature)
     VALUES ($1, $2, $3, 'QA แคชเชียร์', 2, $4, $5, $6, 'ทดสอบ')`,
    [job.id, branch.id, handoverId, declared, photo1, messengerId],
    'รับซองที่ยังเป็น pending ตรง ๆ ถูกปฏิเสธ (ต้อง accept ก่อน)',
    /must be accepted before a pickup/
  );

  // จำลองขั้น "จับจอง" ที่ route ทำ
  await client.query(
    `UPDATE cash_handovers SET status='accepted', accepted_by=$2, accepted_at=now() WHERE id=$1`,
    [handoverId, messengerId]
  );

  console.log('\n5) *** หัวใจ: แมสเซนเจอร์คีย์ยอดต่างจากที่แคชเชียร์ประกาศไม่ได้ ***');
  await expectFail(
    `INSERT INTO cash_pickups (job_id, branch_id, handover_id, cashier_name, envelope_count,
        envelope_amount_satang, envelope_photo_id, received_by, receiver_signature)
     VALUES ($1, $2, $3, 'QA แคชเชียร์', 2, $4, $5, $6, 'ทดสอบ')`,
    [job.id, branch.id, handoverId, declared - 500000, photo1, messengerId],
    'คีย์ยอดต่ำกว่าที่แคชเชียร์ประกาศ 5,000 บาท → ถูกปฏิเสธ',
    /must equal the amount declared by the cashier/
  );
  await expectFail(
    `INSERT INTO cash_pickups (job_id, branch_id, handover_id, cashier_name, envelope_count,
        envelope_amount_satang, envelope_photo_id, received_by, receiver_signature)
     VALUES ($1, $2, $3, 'QA แคชเชียร์', 5, $4, $5, $6, 'ทดสอบ')`,
    [job.id, branch.id, handoverId, declared, photo1, messengerId],
    'แจ้งจำนวนซองต่างจากที่ประกาศ → ถูกปฏิเสธ',
    /must equal the declared count/
  );

  console.log('\n6) รับซองด้วยยอดที่ตรงกันเป๊ะ → ผ่าน');
  const pickup = await expectOk(
    `INSERT INTO cash_pickups (job_id, branch_id, handover_id, cashier_name, cashier_profile_id,
        envelope_count, envelope_amount_satang, envelope_photo_id, received_by, receiver_signature)
     VALUES ($1, $2, $3, 'QA แคชเชียร์', $4, 2, $5, $6, $7, 'ทดสอบ') RETURNING id`,
    [job.id, branch.id, handoverId, cashierId, declared, photo1, messengerId],
    'ยอดตรงกันทุกสตางค์ → บันทึกจุดรับได้'
  );

  console.log('\n7) ซองใบเดียวถูกรับซ้ำไม่ได้');
  if (pickup) {
    await client.query(
      `UPDATE cash_handovers SET accepted_pickup_id = $2 WHERE id = $1`,
      [handoverId, pickup.rows[0].id]
    );
    const photo2 = await mkPhoto('h2');
    await expectFail(
      `INSERT INTO cash_pickups (job_id, branch_id, handover_id, cashier_name, envelope_count,
          envelope_amount_satang, envelope_photo_id, received_by, receiver_signature)
       VALUES ($1, $2, $3, 'ซ้ำ', 2, $4, $5, $6, 'ทดสอบ')`,
      [job.id, branch.id, handoverId, declared, photo2, messengerId],
      'อ้างซองใบเดิมอีกครั้งถูกปฏิเสธ',
      /uq_cash_pickups_handover|duplicate key|uq_cash_pickups_job_branch/i
    );
  }

  console.log('\n8) สถานะปลายทางดัดกลับไม่ได้');
  await expectFail(
    `UPDATE cash_handovers SET status='pending' WHERE id=$1`,
    [handoverId],
    'accepted → pending ถูกปฏิเสธ',
    /illegal cash_handovers status transition/
  );

  console.log('\n9) แจ้งยอดไม่ตรง (dispute) ต้องมีเหตุผล');
  const h2 = await client.query(
    `INSERT INTO cash_handovers (branch_id, declared_amount_satang, envelope_count,
        declared_by, declarer_signature)
     VALUES ($1, 5000, 1, $2, 'QA แคชเชียร์') RETURNING id`,
    [branch.id, cashierId]
  );
  await expectFail(
    `UPDATE cash_handovers SET status='disputed' WHERE id=$1`,
    [h2.rows[0].id],
    'ตั้งสถานะ disputed โดยไม่ระบุเหตุผล ถูกปฏิเสธ',
    /cash_handovers_dispute_needs_reason|violates check/i
  );
  await expectOk(
    `UPDATE cash_handovers SET status='disputed', dispute_reason='หน้าซองเขียน 4,900 ไม่ตรงกับระบบ',
        disputed_at=now() WHERE id=$1`,
    [h2.rows[0].id],
    'แจ้งยอดไม่ตรงพร้อมเหตุผล → ผ่าน'
  );

  console.log('\n10) จุดรับที่ไม่มีใบประกาศยังทำได้ (สาขาที่ยังไม่มีบัญชีแคชเชียร์)');
  const { rows: [branch2] } = await client.query(
    `SELECT id FROM branches WHERE is_active AND id <> $1 LIMIT 1`,
    [branch.id]
  );
  const photo3 = await mkPhoto('h3');
  await expectOk(
    `INSERT INTO cash_pickups (job_id, branch_id, cashier_name, envelope_count,
        envelope_amount_satang, envelope_photo_id, received_by, receiver_signature)
     VALUES ($1, $2, 'พิมพ์ชื่อเอง', 1, 100000, $3, $4, 'ทดสอบ')`,
    [job.id, branch2.id, photo3, messengerId],
    'จุดรับแบบคีย์ยอดเอง (handover_id เป็น NULL) ยังบันทึกได้'
  );
} catch (e) {
  fail++;
  console.log(`\n❌ ทดสอบหยุดกลางทาง: ${e.message}`);
} finally {
  await client.query('ROLLBACK');
  await client.end();
}

console.log(`\n${pass} ผ่าน / ${fail} ไม่ผ่าน`);
process.exit(fail ? 1 : 0);
