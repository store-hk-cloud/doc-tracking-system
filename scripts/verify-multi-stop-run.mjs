/**
 * ทดสอบตัวแบบข้อมูลหลัง migration 012 — หลายจุดรับ ฝากรวมครั้งเดียว
 *
 * ยิง SQL ตรงด้วยสิทธิ์ระดับฐานข้อมูล (เหมือน service-role ที่ทุก route ใช้)
 * เพื่อพิสูจน์ว่ากลไกป้องกันอยู่ที่ CHECK/TRIGGER จริง ไม่ได้อยู่แค่ในโค้ด route
 *
 * ทุกอย่างรันในทรานแซกชันเดียวและ ROLLBACK เสมอ ฐานข้อมูลจริงไม่ถูกแตะ
 *
 *   node scripts/verify-multi-stop-run.mjs
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

// pg v8 แปลง sslmode=require เป็น verify-full ซึ่ง override ตัวเลือก ssl ที่ส่งมา
// ต้องถอด sslmode ออกจาก URL ก่อน ไม่งั้นได้ self-signed certificate error
const url = new URL(env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL);
url.searchParams.delete('sslmode');

const client = new pg.Client({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: false },
});

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`);
  }
};

/** คาดว่าคำสั่งนี้ต้อง error และข้อความต้องเข้ากับ pattern */
async function expectFail(sql, params, label, pattern) {
  await client.query('SAVEPOINT sp');
  try {
    await client.query(sql, params);
    await client.query('ROLLBACK TO SAVEPOINT sp');
    ok(false, label, 'คำสั่งสำเร็จ ทั้งที่ต้องถูกปฏิเสธ');
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT sp');
    ok(pattern.test(e.message), label, e.message.slice(0, 110));
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
    ok(false, label, e.message.slice(0, 140));
    return null;
  }
}

await client.connect();
await client.query('BEGIN');

try {
  // ── เตรียมข้อมูลชั่วคราว ──
  const { rows: [msgr] } = await client.query(
    `SELECT id FROM profiles WHERE is_active ORDER BY created_at LIMIT 1`
  );
  const { rows: branchRows } = await client.query(
    `SELECT id, name FROM branches WHERE is_active ORDER BY code LIMIT 3`
  );
  const { rows: [bank] } = await client.query(
    `SELECT id FROM approved_banks WHERE is_active LIMIT 1`
  );
  if (branchRows.length < 3) throw new Error('ต้องมีสาขาที่เปิดใช้งานอย่างน้อย 3 แห่งเพื่อทดสอบ');

  const { rows: [job] } = await client.query(
    `INSERT INTO messenger_jobs (job_kind, status, branch_id, assigned_to, created_by)
     VALUES ('cash_handover', 'open', NULL, $1, $1) RETURNING id, job_no`,
    [msgr.id]
  );

  console.log('\n1) เปิดทริปโดยไม่ระบุสาขาได้ (branch_id = NULL)');
  ok(!!job.id, `สร้างทริป #${job.job_no} สำเร็จ`);

  // helper: สร้างรูปซองแล้วคืน id
  let hashSeed = 0;
  const makePhoto = async (kind) => {
    hashSeed++;
    const { rows: [p] } = await client.query(
      `INSERT INTO messenger_job_photos
         (job_id, photo_kind, view_link, content_sha256, uploaded_by, uploader_signature)
       VALUES ($1, $2, 'https://example.invalid/x', $3, $4, 'ทดสอบ') RETURNING id`,
      [job.id, kind, String(hashSeed).padStart(64, 'a'), msgr.id]
    );
    return p.id;
  };

  const addPickup = async (branchId, baht) => {
    const photoId = await makePhoto('cash_envelope');
    return client.query(
      `INSERT INTO cash_pickups
         (job_id, branch_id, cashier_name, envelope_count, envelope_amount_satang,
          envelope_photo_id, received_by, receiver_signature)
       VALUES ($1, $2, 'แคชเชียร์ทดสอบ', 1, $3, $4, $5, 'ทดสอบ') RETURNING id`,
      [job.id, branchId, baht * 100, photoId, msgr.id]
    );
  };

  console.log('\n2) รับซองได้หลายสาขาในทริปเดียว');
  const p1 = await expectOk(
    `SELECT 1`, [], `เตรียมรับจุดที่ 1 (${branchRows[0].name})`
  );
  await addPickup(branchRows[0].id, 10000);
  await client.query(`UPDATE messenger_jobs SET status='picked_up', picked_up_at=now() WHERE id=$1`, [job.id]);
  await addPickup(branchRows[1].id, 15000);
  await addPickup(branchRows[2].id, 500.25);
  const { rows: [{ cnt, total }] } = await client.query(
    `SELECT COUNT(*)::int AS cnt, SUM(envelope_amount_satang)::bigint AS total
     FROM cash_pickups WHERE job_id = $1`,
    [job.id]
  );
  ok(cnt === 3, `เก็บได้ 3 จุดในทริปเดียว (ได้ ${cnt})`);
  ok(Number(total) === 2550025, `ยอดรวม 25,500.25 บาท = 2550025 สตางค์ (ได้ ${total})`);

  console.log('\n3) กันรับซ้ำสาขาเดิมในทริปเดียวกัน (กันกดสองครั้ง/เน็ตกระตุก)');
  const dupPhoto = await makePhoto('cash_envelope');
  await expectFail(
    `INSERT INTO cash_pickups
       (job_id, branch_id, cashier_name, envelope_count, envelope_amount_satang,
        envelope_photo_id, received_by, receiver_signature)
     VALUES ($1, $2, 'ซ้ำ', 1, 100, $3, $4, 'ทดสอบ')`,
    [job.id, branchRows[0].id, dupPhoto, msgr.id],
    'รับซ้ำสาขาเดิมถูกปฏิเสธ',
    /uq_cash_pickups_job_branch|duplicate key/i
  );

  console.log('\n4) รูปที่แนบตอนรับต้องเป็นรูปซองจริง');
  const slipPhoto = await makePhoto('deposit_slip');
  await expectFail(
    `INSERT INTO cash_pickups
       (job_id, branch_id, cashier_name, envelope_count, envelope_amount_satang,
        envelope_photo_id, received_by, receiver_signature)
     VALUES ($1, (SELECT id FROM branches WHERE is_active AND id <> ALL($2::uuid[]) LIMIT 1),
             'ผิดชนิด', 1, 100, $3, $4, 'ทดสอบ')`,
    [job.id, branchRows.map((b) => b.id), slipPhoto, msgr.id],
    'ใช้รูปใบนำฝากมาอ้างเป็นรูปซองไม่ได้',
    /cash_envelope/i
  );

  console.log('\n5) ยอดหน้าซองแก้ย้อนหลังไม่ได้');
  await expectFail(
    `UPDATE cash_pickups SET envelope_amount_satang = 1 WHERE job_id = $1`,
    [job.id],
    'UPDATE ยอดหน้าซองถูกปฏิเสธ',
    /envelope_amount_satang is write-once/
  );

  console.log('\n6) ยอดที่ควรฝากต้องเท่ากับผลรวมทุกจุดรับ');
  const depSlip = await makePhoto('deposit_slip');
  await expectFail(
    `INSERT INTO bank_deposits
       (job_id, bank_id, bank_branch_name, expected_total_satang, actual_amount_satang,
        reference_no, reference_no_source, slip_photo_id, slip_status, submitted_by, submitted_signature)
     VALUES ($1, $2, 'สาขาทดสอบ', 1000000, 1000000, 'FAKE-1', 'bank', $3, 'attached', $4, 'ทดสอบ')`,
    [job.id, bank.id, depSlip, msgr.id],
    'ส่งยอดที่ควรฝากปลอม (แค่จุดเดียว) ถูกปฏิเสธ',
    /does not match the sum of envelope amounts/
  );

  console.log('\n7) เลขอ้างอิงอัตโนมัติ');
  const { rows: [{ r1 }] } = await client.query(`SELECT next_deposit_auto_ref() AS r1`);
  const { rows: [{ r2 }] } = await client.query(`SELECT next_deposit_auto_ref() AS r2`);
  ok(/^AUTO-\d{6}-\d{5}$/.test(r1), `รูปแบบถูกต้อง: ${r1}`);
  ok(r1 !== r2, `เรียกสองครั้งได้เลขไม่ซ้ำ (${r1} / ${r2})`);

  console.log('\n8) ฝากรวมครั้งเดียวด้วยยอดรวมที่ถูกต้อง');
  const deposit = await expectOk(
    `INSERT INTO bank_deposits
       (job_id, bank_id, bank_branch_name, expected_total_satang, actual_amount_satang,
        reference_no, reference_no_source, slip_photo_id, slip_status, submitted_by, submitted_signature)
     VALUES ($1, $2, 'สาขาทดสอบ', $3, $3, next_deposit_auto_ref(), 'auto', $4, 'attached', $5, 'ทดสอบ')
     RETURNING id, variance_satang, reference_no`,
    [job.id, bank.id, total, depSlip, msgr.id],
    'บันทึกการฝากยอดรวม 25,500.25 บาท สำเร็จ'
  );
  if (deposit) {
    ok(Number(deposit.rows[0].variance_satang) === 0, 'ผลต่างเป็นศูนย์เมื่อฝากตรงยอดรวม');
    ok(/^AUTO-/.test(deposit.rows[0].reference_no), `ใช้เลขที่ระบบออก: ${deposit.rows[0].reference_no}`);

    const depositId = deposit.rows[0].id;

    console.log('\n9) ทุกจุดรับถูกผูกกับใบฝากใบเดียว');
    await client.query(`UPDATE cash_pickups SET deposit_id = $1 WHERE job_id = $2`, [depositId, job.id]);
    const { rows: [{ linked }] } = await client.query(
      `SELECT COUNT(*)::int AS linked FROM cash_pickups WHERE job_id=$1 AND deposit_id=$2`,
      [job.id, depositId]
    );
    ok(linked === 3, `ผูกครบ 3 จุด (ได้ ${linked})`);

    console.log('\n10) reference_no_source แก้ย้อนหลังไม่ได้');
    await expectFail(
      `UPDATE bank_deposits SET reference_no_source = 'bank' WHERE id = $1`,
      [depositId],
      'เปลี่ยนเลขที่ระบบออกให้กลายเป็นเลขธนาคารไม่ได้',
      /reference_no_source is write-once/
    );

    console.log('\n11) เพิ่มจุดรับหลังฝากแล้วต้องไม่ทำให้ผลต่างที่บันทึกไว้เป็นเท็จ');
    // route บล็อกไว้ที่ชั้นแอป ตรงนี้ยืนยันว่า snapshot ใน DB ไม่เปลี่ยนตาม
    const lateBranch = await client.query(
      `SELECT id FROM branches WHERE is_active AND id <> ALL($1::uuid[]) LIMIT 1`,
      [branchRows.map((b) => b.id)]
    );
    if (lateBranch.rows.length) {
      const latePhoto = await makePhoto('cash_envelope');
      await client.query(
        `INSERT INTO cash_pickups
           (job_id, branch_id, cashier_name, envelope_count, envelope_amount_satang,
            envelope_photo_id, received_by, receiver_signature)
         VALUES ($1, $2, 'มาช้า', 1, 999900, $3, $4, 'ทดสอบ')`,
        [job.id, lateBranch.rows[0].id, latePhoto, msgr.id]
      );
      const { rows: [d2] } = await client.query(
        `SELECT expected_total_satang, variance_satang FROM bank_deposits WHERE id=$1`,
        [depositId]
      );
      ok(
        Number(d2.expected_total_satang) === Number(total) && Number(d2.variance_satang) === 0,
        'ยอดที่ควรฝากที่ snapshot ไว้ไม่ขยับตามจุดรับที่เพิ่มมาทีหลัง'
      );
    }
  }

  console.log('\n12) รูปซองใช้ซ้ำข้ามทริปไม่ได้');
  const { rows: [job2] } = await client.query(
    `INSERT INTO messenger_jobs (job_kind, status, branch_id, assigned_to, created_by)
     VALUES ('cash_handover', 'open', NULL, $1, $1) RETURNING id`,
    [msgr.id]
  );
  await expectFail(
    `INSERT INTO messenger_job_photos
       (job_id, photo_kind, view_link, content_sha256, uploaded_by, uploader_signature)
     VALUES ($1, 'cash_envelope', 'https://example.invalid/y', $2, $3, 'ทดสอบ')`,
    [job2.id, String(1).padStart(64, 'a'), msgr.id],
    'อัปรูปซองไบต์เดิมในอีกทริปถูกปฏิเสธ',
    /uq_msg_photos_evidence_hash|duplicate key/i
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
