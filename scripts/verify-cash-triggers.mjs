/**
 * ทดสอบว่าชั้นป้องกันของโมดูลเงินสดทำงานจริง โดยยิง SQL ตรงด้วย service-role
 * ซึ่ง bypass RLS ทั้งหมด — จุดประสงค์คือพิสูจน์ว่า CHECK constraint + TRIGGER
 * (ไม่ใช่ RLS) เป็นสิ่งที่บล็อกการแก้ยอดเงินได้จริง
 *
 * ต้องมี DATABASE_URL (Postgres connection string จาก Supabase:
 *   Dashboard -> Project Settings -> Database -> Connection string -> URI)
 * เพราะ Supabase REST API รัน DDL/SQL ดิบไม่ได้
 *
 * รัน: DATABASE_URL="postgresql://..." node scripts/verify-cash-triggers.mjs
 *
 * สคริปต์นี้สร้างข้อมูลทดสอบใน transaction แล้ว ROLLBACK เสมอ
 * จึงไม่ทิ้งข้อมูลค้างในฐานข้อมูล (และเป็นทางเดียวที่ลบข้อมูลทดสอบได้
 * เพราะ trigger ห้าม DELETE ทุกตาราง)
 */
import pg from 'pg';

const { Client } = pg;
const rawConnectionString = process.env.DATABASE_URL;
if (!rawConnectionString) {
  console.error('❌ ต้องตั้ง DATABASE_URL ก่อน (Supabase -> Settings -> Database -> Connection string)');
  process.exit(1);
}

// ตัด sslmode ออกจาก URL: pg เวอร์ชันใหม่แปลง sslmode=require เป็น verify-full
// ซึ่งจะ reject ใบรับรองของ Supabase (self-signed chain) และ override ค่า ssl
// ที่ส่งเข้ามาทาง option ด้วย จึงต้องเอาออกแล้วกำหนด ssl เองข้างล่าง
const url = new URL(rawConnectionString);
url.searchParams.delete('sslmode');
const connectionString = url.toString();

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

let pass = 0;
let fail = 0;

/** คาดว่าคำสั่งนี้ต้อง error — ถ้าสำเร็จแปลว่าชั้นป้องกันรั่ว */
async function mustFail(name, sql, params = []) {
  try {
    await client.query('SAVEPOINT sp');
    await client.query(sql, params);
    await client.query('ROLLBACK TO SAVEPOINT sp');
    fail++;
    console.log(`  ❌ ${name} → คำสั่งสำเร็จ ทั้งที่ต้องถูกบล็อก`);
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT sp');
    pass++;
    console.log(`  ✅ ${name} → ถูกบล็อก: ${String(e.message).split('\n')[0].slice(0, 90)}`);
  }
}

/** คาดว่าคำสั่งนี้ต้องสำเร็จ — พิสูจน์ว่าไม่ได้ล็อกเกินจำเป็น */
async function mustPass(name, sql, params = []) {
  try {
    await client.query('SAVEPOINT sp');
    const res = await client.query(sql, params);
    await client.query('ROLLBACK TO SAVEPOINT sp');
    pass++;
    console.log(`  ✅ ${name} → สำเร็จ (${res.rowCount} แถว)`);
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT sp');
    fail++;
    console.log(`  ❌ ${name} → ถูกบล็อกทั้งที่ควรผ่าน: ${String(e.message).split('\n')[0].slice(0, 120)}`);
  }
}

async function main() {
  await client.connect();
  await client.query('BEGIN');

  try {
    // ── เตรียมข้อมูลทดสอบ ──
    // ใช้ profiles ที่มีอยู่จริง เพราะ profiles.id อ้าง auth.users
    const { rows: people } = await client.query(`
      SELECT p.id, p.role, d.code AS dept_code
      FROM profiles p LEFT JOIN departments d ON d.id = p.department_id
      WHERE p.is_active = true
    `);
    // รหัสแผนกผู้อนุมัติไม่ hardcode แล้ว อ่านจาก app_settings ชุดเดียวกับที่ trigger ใช้
    const { rows: settingRows } = await client.query(
      `SELECT key, value FROM app_settings WHERE key LIKE 'cash_%' OR key = 'messenger_dept_codes'`
    );
    const settings = Object.fromEntries(settingRows.map((r) => [r.key, r.value]));
    const list = (k, fb) => String(settings[k] ?? fb).split(',').map((s) => s.trim()).filter(Boolean);
    const approverCodes = list('cash_approver_dept_codes', '0-ADM03');
    const shortageCodes = list('cash_shortage_dept_codes', '0-ADM03');
    const msgCodes = list('messenger_dept_codes', 'MSG');
    console.log(`รหัสแผนกจาก app_settings: อนุมัติเงินเกิน=[${approverCodes}] ปิดเงินขาด=[${shortageCodes}] แมส=[${msgCodes}]
`);

    const superAdmin = people.find((p) => p.role === 'super_admin');
    const finAdmin = people.find((p) => p.role === 'admin' && approverCodes.includes(p.dept_code));
    const finUser = people.find((p) => p.role === 'user' && shortageCodes.includes(p.dept_code));
    const otherAdmin = people.find((p) => p.role === 'admin' && !approverCodes.includes(p.dept_code));
    const messenger = people.find((p) => msgCodes.includes(p.dept_code))
      || people.find((p) => p.role === 'user' && !shortageCodes.includes(p.dept_code))
      || people.find((p) => p.role === 'user');

    if (!superAdmin || !messenger) {
      console.error('❌ ต้องมีผู้ใช้ super_admin และผู้ใช้อีกอย่างน้อย 1 คนในระบบก่อนรันสคริปต์นี้');
      process.exit(1);
    }
    console.log('ผู้ใช้ที่ใช้ทดสอบ:');
    console.log(`  super_admin       : ${superAdmin.id}`);
    console.log(`  แมสเซนเจอร์        : ${messenger.id} (${messenger.dept_code || 'ไม่มีแผนก'})`);
    console.log(`  admin ผู้อนุมัติ    : ${finAdmin?.id || '— ไม่มี (ข้ามบางเทส)'}`);
    console.log(`  user แผนกการเงิน  : ${finUser?.id || '— ไม่มี (ข้ามบางเทส)'}`);
    console.log(`  admin นอกแผนก     : ${otherAdmin?.id || '— ไม่มี (ข้ามบางเทส)'}`);

    const { rows: [branch] } = await client.query(`SELECT id FROM branches LIMIT 1`);
    const { rows: [bank] } = await client.query(`SELECT id FROM approved_banks LIMIT 1`);

    // helper: สร้างงาน 1 ใบพร้อม pickup + deposit ตามยอดที่กำหนด
    async function makeRun(payinSatang, actualSatang, tag, actorId = messenger.id) {
      const { rows: [job] } = await client.query(
        `INSERT INTO messenger_jobs (job_kind, status, branch_id, assigned_to, created_by)
         VALUES ('cash_handover', 'open', $1, $2, $2) RETURNING *`,
        [branch.id, actorId]
      );
      const { rows: [photo] } = await client.query(
        `INSERT INTO messenger_job_photos (job_id, photo_kind, view_link, content_sha256, uploaded_by, uploader_signature)
         VALUES ($1, 'payin_slip', 'https://example.test/payin', $2, $3, 'ทดสอบ') RETURNING *`,
        [job.id, `payin${tag}`.padEnd(64, '0'), actorId]
      );
      await client.query(`UPDATE messenger_jobs SET status='picked_up', picked_up_at=now() WHERE id=$1`, [job.id]);
      const { rows: [pickup] } = await client.query(
        `INSERT INTO cash_pickups (job_id, branch_id, cashier_name, envelope_count, payin_amount_satang,
                                   payin_photo_id, received_by, receiver_signature)
         VALUES ($1, $2, 'แคชเชียร์ทดสอบ', 2, $3, $4, $5, 'ทดสอบ') RETURNING *`,
        [job.id, branch.id, payinSatang, photo.id, actorId]
      );
      const { rows: [slip] } = await client.query(
        `INSERT INTO messenger_job_photos (job_id, photo_kind, view_link, content_sha256, uploaded_by, uploader_signature)
         VALUES ($1, 'deposit_slip', 'https://example.test/slip', $2, $3, 'ทดสอบ') RETURNING *`,
        [job.id, `slip${tag}`.padEnd(64, '0'), actorId]
      );
      await client.query(`UPDATE messenger_jobs SET status='deposited', deposited_at=now() WHERE id=$1`, [job.id]);
      const { rows: [deposit] } = await client.query(
        `INSERT INTO bank_deposits (job_id, bank_id, bank_branch_name, expected_total_satang, actual_amount_satang,
                                    reference_no, slip_photo_id, slip_status, submitted_by, submitted_signature)
         VALUES ($1, $2, 'สาขาทดสอบ', $3, $4, $5, $6, 'attached', $7, 'ทดสอบ') RETURNING *`,
        [job.id, bank.id, payinSatang, actualSatang, `REF-${tag}-${Date.now()}`, slip.id, actorId]
      );
      return { job, pickup, deposit, photo, slip };
    }

    // งานยอดเกิน 1,200.00 บาท
    const over = await makeRun(4500000, 4620000, 'over');
    // งานยอดขาด 500.00 บาท
    const short = await makeRun(4500000, 4450000, 'shrt');

    console.log(`\nงานทดสอบ: เงินเกิน variance=${over.deposit.variance_satang} / เงินขาด variance=${short.deposit.variance_satang}\n`);

    await client.query(
      `UPDATE bank_deposits SET status='variance_pending' WHERE id IN ($1,$2)`,
      [over.deposit.id, short.deposit.id]
    );
    await client.query(`UPDATE messenger_jobs SET status='pending_review' WHERE id IN ($1,$2)`, [
      over.job.id, short.job.id,
    ]);

    const { rows: [overReport] } = await client.query(
      `INSERT INTO cash_variance_reports (deposit_id, variance_satang_snapshot, variance_kind, cause_code,
                                          cause_detail, reported_by, reporter_signature)
       VALUES ($1, $2, 'over', 'mixed_envelope', 'ซองเงินปนกันระหว่างขนส่ง ทดสอบระบบ', $3, 'ทดสอบ') RETURNING *`,
      [over.deposit.id, over.deposit.variance_satang, messenger.id]
    );
    const { rows: [shortReport] } = await client.query(
      `INSERT INTO cash_variance_reports (deposit_id, variance_satang_snapshot, variance_kind, cause_code,
                                          cause_detail, reported_by, reporter_signature)
       VALUES ($1, $2, 'short', 'bank_fee', 'ค่าธรรมเนียมธนาคารหักจากยอดฝาก ทดสอบระบบ', $3, 'ทดสอบ') RETURNING *`,
      [short.deposit.id, short.deposit.variance_satang, messenger.id]
    );

    console.log('── 1-2. ยอดเงินเป็น write-once / variance เป็น generated column ──');
    await mustFail('แก้ actual_amount_satang ของรายการที่บันทึกแล้ว',
      `UPDATE bank_deposits SET actual_amount_satang = 4500000 WHERE id = $1`, [over.deposit.id]);
    await mustFail('แก้ expected_total_satang ย้อนหลังให้ตรงกับยอดฝาก',
      `UPDATE bank_deposits SET expected_total_satang = 4620000 WHERE id = $1`, [over.deposit.id]);
    await mustFail('เขียนทับ variance_satang โดยตรง',
      `UPDATE bank_deposits SET variance_satang = 0 WHERE id = $1`, [over.deposit.id]);
    await mustFail('แก้ reference_no',
      `UPDATE bank_deposits SET reference_no = 'REF-FAKE' WHERE id = $1`, [over.deposit.id]);

    console.log('\n── 3-4. ลบข้อมูลไม่ได้ แม้ด้วย service-role ──');
    await mustFail('DELETE messenger_jobs', `DELETE FROM messenger_jobs WHERE id = $1`, [over.job.id]);
    await mustFail('DELETE bank_deposits', `DELETE FROM bank_deposits WHERE id = $1`, [over.deposit.id]);
    await mustFail('DELETE messenger_job_photos', `DELETE FROM messenger_job_photos WHERE id = $1`, [over.slip.id]);
    await mustFail('DELETE cash_pickups', `DELETE FROM cash_pickups WHERE id = $1`, [over.pickup.id]);

    // ต้องมีแถว audit จริงก่อน ไม่งั้น DELETE/UPDATE จะ match 0 แถว
    // แล้ว trigger FOR EACH ROW ไม่ทำงานเลย = เทสผ่านแบบไร้ความหมาย
    const { rows: [auditRow] } = await client.query(
      `INSERT INTO messenger_job_audit (job_id, entity, entity_id, action, amount_satang, actor_id,
                                        actor_signature, actor_role)
       VALUES ($1, 'deposit', $2, 'record_deposit', $3, $4, 'ทดสอบ', 'user') RETURNING *`,
      [over.job.id, over.deposit.id, over.deposit.actual_amount_satang, messenger.id]
    );
    console.log(`  (สร้างแถว audit id=${auditRow.id} เพื่อให้มีของจริงให้ลอง)`);
    await mustFail('DELETE messenger_job_audit', `DELETE FROM messenger_job_audit WHERE id = $1`, [auditRow.id]);
    await mustFail('UPDATE messenger_job_audit (แก้เหตุผล)',
      `UPDATE messenger_job_audit SET reason = 'แก้ไขย้อนหลัง' WHERE id = $1`, [auditRow.id]);
    await mustFail('UPDATE messenger_job_audit (แก้ยอดเงิน)',
      `UPDATE messenger_job_audit SET amount_satang = 0 WHERE id = $1`, [auditRow.id]);
    await mustFail('UPDATE messenger_job_audit (แก้ชื่อผู้ทำ)',
      `UPDATE messenger_job_audit SET actor_signature = 'คนอื่น' WHERE id = $1`, [auditRow.id]);
    await mustFail('TRUNCATE messenger_job_audit', `TRUNCATE messenger_job_audit`);

    console.log('\n── 5-6. สิทธิ์อนุมัติเงินเกิน + แยกหน้าที่ ──');
    if (otherAdmin) {
      await mustFail('admin นอกแผนกผู้อนุมัติ อนุมัติเงินเกิน',
        `INSERT INTO cash_variance_reviews (report_id, decision, variance_satang_at_decision,
            actual_amount_satang_at_decision, reason, slip_checked, reviewed_by, reviewer_signature, reviewer_role)
         VALUES ($1, 'approved', $2, $3, 'ตรวจสอบแล้วเห็นควรอนุมัติ', true, $4, 'ทดสอบ', 'admin')`,
        [overReport.id, over.deposit.variance_satang, over.deposit.actual_amount_satang, otherAdmin.id]);
    } else {
      console.log('  ⏭  ข้าม (ไม่มี admin นอกแผนกผู้อนุมัติในระบบ)');
    }
    if (finUser) {
      await mustFail('user (ไม่ใช่ admin) ในแผนกการเงิน อนุมัติเงินเกิน',
        `INSERT INTO cash_variance_reviews (report_id, decision, variance_satang_at_decision,
            actual_amount_satang_at_decision, reason, slip_checked, reviewed_by, reviewer_signature, reviewer_role)
         VALUES ($1, 'approved', $2, $3, 'ตรวจสอบแล้วเห็นควรอนุมัติ', true, $4, 'ทดสอบ', 'user')`,
        [overReport.id, over.deposit.variance_satang, over.deposit.actual_amount_satang, finUser.id]);
    } else {
      console.log('  ⏭  ข้าม (ไม่มี user ในแผนกการเงินในระบบ)');
    }
    await mustFail('แมสเซนเจอร์ผู้ฝากเงินอนุมัติงานตัวเอง (segregation)',
      `INSERT INTO cash_variance_reviews (report_id, decision, variance_satang_at_decision,
          actual_amount_satang_at_decision, reason, slip_checked, reviewed_by, reviewer_signature, reviewer_role)
       VALUES ($1, 'approved', $2, $3, 'อนุมัติงานของตัวเอง ทดสอบ', true, $4, 'ทดสอบ', 'user')`,
      [overReport.id, over.deposit.variance_satang, over.deposit.actual_amount_satang, messenger.id]);
    await mustFail('อนุมัติด้วย snapshot ยอดที่ไม่ตรงกับความจริง',
      `INSERT INTO cash_variance_reviews (report_id, decision, variance_satang_at_decision,
          actual_amount_satang_at_decision, reason, slip_checked, reviewed_by, reviewer_signature, reviewer_role)
       VALUES ($1, 'approved', 0, $2, 'อนุมัติด้วยยอดปลอม ทดสอบ', true, $3, 'ทดสอบ', 'super_admin')`,
      [overReport.id, over.deposit.actual_amount_satang, superAdmin.id]);
    await mustFail('เหตุผลสั้นกว่า 10 ตัวอักษร',
      `INSERT INTO cash_variance_reviews (report_id, decision, variance_satang_at_decision,
          actual_amount_satang_at_decision, reason, slip_checked, reviewed_by, reviewer_signature, reviewer_role)
       VALUES ($1, 'approved', $2, $3, 'ok', true, $4, 'ทดสอบ', 'super_admin')`,
      [overReport.id, over.deposit.variance_satang, over.deposit.actual_amount_satang, superAdmin.id]);
    await mustFail('ไม่ติ๊กยืนยันว่าตรวจสลิปแล้ว',
      `INSERT INTO cash_variance_reviews (report_id, decision, variance_satang_at_decision,
          actual_amount_satang_at_decision, reason, slip_checked, reviewed_by, reviewer_signature, reviewer_role)
       VALUES ($1, 'approved', $2, $3, 'ตรวจสอบแล้วเห็นควรอนุมัติ', false, $4, 'ทดสอบ', 'super_admin')`,
      [overReport.id, over.deposit.variance_satang, over.deposit.actual_amount_satang, superAdmin.id]);

    console.log('\n── 7. เงินเกินไปสถานะจบไม่ได้ถ้าไม่มีใบอนุมัติ ──');
    await mustFail('ปิดรายการเงินเกินโดยไม่มี resolved_review_id',
      `UPDATE bank_deposits SET status='variance_resolved' WHERE id = $1`, [over.deposit.id]);
    await mustFail('ตั้งรายการเงินเกินเป็น matched',
      `UPDATE bank_deposits SET status='matched' WHERE id = $1`, [over.deposit.id]);

    console.log('\n── 8. รูปสลิปใช้ซ้ำสองงานไม่ได้ ──');
    await mustFail('อัปรูป deposit_slip ที่มี sha256 ซ้ำ',
      `INSERT INTO messenger_job_photos (job_id, photo_kind, view_link, content_sha256, uploaded_by, uploader_signature)
       VALUES ($1, 'deposit_slip', 'https://example.test/dup', $2, $3, 'ทดสอบ')`,
      [short.job.id, over.slip.content_sha256, messenger.id]);
    await mustFail('เปลี่ยนรูปสลิปของรายการที่แนบแล้ว',
      `UPDATE bank_deposits SET slip_photo_id = $1 WHERE id = $2`, [short.slip.id, over.deposit.id]);
    await mustFail('แก้ view_link ของรูป (append-only)',
      `UPDATE messenger_job_photos SET view_link = 'https://evil.test' WHERE id = $1`, [over.slip.id]);

    console.log('\n── 9. ยอดตามใบ Pay-in เป็น write-once ──');
    await mustFail('แก้ payin_amount_satang',
      `UPDATE cash_pickups SET payin_amount_satang = 4620000 WHERE id = $1`, [over.pickup.id]);
    await mustFail('แก้ envelope_count',
      `UPDATE cash_pickups SET envelope_count = 99 WHERE id = $1`, [over.pickup.id]);
    await mustFail('เปลี่ยนรูปใบ Pay-in',
      `UPDATE cash_pickups SET payin_photo_id = $1 WHERE id = $2`, [short.photo.id, over.pickup.id]);

    console.log('\n── ชั้นป้องกันเพิ่มเติม ──');
    await mustFail('บันทึก deposit ด้วย expected ที่ไม่ตรงกับผลรวม pay-in',
      `INSERT INTO bank_deposits (job_id, bank_id, bank_branch_name, expected_total_satang, actual_amount_satang,
                                  reference_no, submitted_by, submitted_signature)
       VALUES ($1, $2, 'สาขาปลอม', 1, 1, 'REF-FAKE-EXPECTED', $3, 'ทดสอบ')`,
      [short.job.id, bank.id, messenger.id]);
    await mustFail('รายงานผลต่างด้วย snapshot ที่ไม่ตรงกับ variance จริง',
      `INSERT INTO cash_variance_reports (deposit_id, variance_satang_snapshot, variance_kind, cause_code,
                                          cause_detail, reported_by, reporter_signature)
       VALUES ($1, -1, 'short', 'other', 'ทดสอบ snapshot ปลอม', $2, 'ทดสอบ')`,
      [over.deposit.id, messenger.id]);
    // สร้างงานสถานะ open ขึ้นมาจริง ๆ ไม่งั้น UPDATE จะ match 0 แถวและผ่านแบบไร้ความหมาย
    const { rows: [freshJob] } = await client.query(
      `INSERT INTO messenger_jobs (job_kind, status, branch_id, assigned_to, created_by)
       VALUES ('cash_handover', 'open', $1, $2, $2) RETURNING *`,
      [branch.id, messenger.id]
    );
    await mustFail('สถานะงานกระโดดข้ามขั้น (open -> closed)',
      `UPDATE messenger_jobs SET status='closed', closed_by=$1, closer_signature='x' WHERE id=$2`,
      [superAdmin.id, freshJob.id]);
    await mustFail('สถานะงานกระโดดข้ามขั้น (open -> deposited)',
      `UPDATE messenger_jobs SET status='deposited' WHERE id=$1`, [freshJob.id]);
    await mustFail('ยกเลิกงานโดยไม่ระบุเหตุผล',
      `UPDATE messenger_jobs SET status='cancelled', cancelled_by=$1 WHERE id=$2`, [superAdmin.id, freshJob.id]);
    await mustFail('โยนงานให้คนอื่นหลังรับเงินไปแล้ว',
      `UPDATE messenger_jobs SET assigned_to=$1 WHERE id=$2`, [superAdmin.id, over.job.id]);
    await mustPass('ขั้นตอนที่ถูกต้อง (open -> picked_up) ต้องผ่าน',
      `UPDATE messenger_jobs SET status='picked_up', picked_up_at=now() WHERE id=$1`, [freshJob.id]);

    // แยกหน้าที่: ให้ super_admin เป็นผู้ฝากเงินเอง แล้วลองอนุมัติงานตัวเอง
    // (เทสก่อนหน้าถูกบล็อกด้วยเรื่อง role/แผนก จึงยังไม่ได้พิสูจน์ segregation จริง)
    await client.query('SAVEPOINT segregation');
    const selfRun = await makeRun(4500000, 4620000, 'self', superAdmin.id);
    await client.query(`UPDATE bank_deposits SET status='variance_pending' WHERE id=$1`, [selfRun.deposit.id]);
    await client.query(`UPDATE messenger_jobs SET status='pending_review' WHERE id=$1`, [selfRun.job.id]);
    const { rows: [selfReport] } = await client.query(
      `INSERT INTO cash_variance_reports (deposit_id, variance_satang_snapshot, variance_kind, cause_code,
                                          cause_detail, reported_by, reporter_signature)
       VALUES ($1, $2, 'over', 'mixed_envelope', 'ทดสอบการอนุมัติงานของตัวเอง', $3, 'ทดสอบ') RETURNING *`,
      [selfRun.deposit.id, selfRun.deposit.variance_satang, superAdmin.id]
    );
    await mustFail('super_admin อนุมัติงานที่ตัวเองเป็นผู้ฝากเงิน (segregation)',
      `INSERT INTO cash_variance_reviews (report_id, decision, variance_satang_at_decision,
          actual_amount_satang_at_decision, reason, slip_checked, reviewed_by, reviewer_signature, reviewer_role)
       VALUES ($1, 'approved', $2, $3, 'อนุมัติงานของตัวเอง ทดสอบระบบ', true, $4, 'ทดสอบ', 'super_admin')`,
      [selfReport.id, selfRun.deposit.variance_satang, selfRun.deposit.actual_amount_satang, superAdmin.id]);
    await client.query('ROLLBACK TO SAVEPOINT segregation');

    console.log('\n── 10. ต้องไม่ล็อกเกินจำเป็น: เส้นทางที่ถูกต้องต้องผ่าน ──');
    if (finUser) {
      await mustPass('user ในแผนกการเงิน ปิดยอดขาดได้',
        `INSERT INTO cash_variance_reviews (report_id, decision, variance_satang_at_decision,
            actual_amount_satang_at_decision, reason, slip_checked, reviewed_by, reviewer_signature, reviewer_role)
         VALUES ($1, 'approved', $2, $3, 'ค่าธรรมเนียมธนาคาร ตรวจสอบแล้วถูกต้อง', true, $4, 'ทดสอบ', 'user')`,
        [shortReport.id, short.deposit.variance_satang, short.deposit.actual_amount_satang, finUser.id]);
    } else {
      console.log('  ⏭  ข้าม (ไม่มี user ในแผนกการเงิน)');
    }
    if (finAdmin) {
      await mustPass('admin ในแผนกผู้อนุมัติ อนุมัติเงินเกินได้',
        `INSERT INTO cash_variance_reviews (report_id, decision, variance_satang_at_decision,
            actual_amount_satang_at_decision, reason, slip_checked, reviewed_by, reviewer_signature, reviewer_role)
         VALUES ($1, 'approved', $2, $3, 'ตรวจสลิปแล้ว ยอดเกินมาจากซองปนกัน', true, $4, 'ทดสอบ', 'admin')`,
        [overReport.id, over.deposit.variance_satang, over.deposit.actual_amount_satang, finAdmin.id]);
    } else {
      console.log('  ⏭  ข้าม (ไม่มี admin ในแผนกผู้อนุมัติ)');
    }
    await mustPass('super_admin อนุมัติเงินเกินได้',
      `INSERT INTO cash_variance_reviews (report_id, decision, variance_satang_at_decision,
          actual_amount_satang_at_decision, reason, slip_checked, reviewed_by, reviewer_signature, reviewer_role)
       VALUES ($1, 'approved', $2, $3, 'ตรวจสลิปแล้ว ยอดเกินมาจากซองปนกัน', true, $4, 'ทดสอบ', 'super_admin')`,
      [overReport.id, over.deposit.variance_satang, over.deposit.actual_amount_satang, superAdmin.id]);

    // เส้นทางที่ถูกต้องเต็มรูปแบบ: อนุมัติแล้วปิดรายการได้
    await client.query('SAVEPOINT happy');
    const { rows: [review] } = await client.query(
      `INSERT INTO cash_variance_reviews (report_id, decision, variance_satang_at_decision,
          actual_amount_satang_at_decision, reason, slip_checked, reviewed_by, reviewer_signature, reviewer_role)
       VALUES ($1, 'approved', $2, $3, 'ตรวจสลิปแล้ว อนุมัติตามระเบียบ', true, $4, 'ทดสอบ', 'super_admin') RETURNING *`,
      [overReport.id, over.deposit.variance_satang, over.deposit.actual_amount_satang, superAdmin.id]
    );
    await mustPass('ปิดรายการเงินเกินด้วยใบอนุมัติที่ถูกต้อง',
      `UPDATE bank_deposits SET status='variance_resolved', resolved_review_id=$1 WHERE id=$2`,
      [review.id, over.deposit.id]);
    await mustFail('ปิดรายการเงินเกินด้วยใบอนุมัติของ "รายการอื่น"',
      `UPDATE bank_deposits SET status='variance_resolved', resolved_review_id=$1 WHERE id=$2`,
      [review.id, short.deposit.id]);
    await client.query('ROLLBACK TO SAVEPOINT happy');

    console.log(`\nสรุป: ผ่าน ${pass} / ไม่ผ่าน ${fail}`);
    console.log('(ข้อมูลทดสอบทั้งหมดถูก ROLLBACK ไม่มีอะไรค้างในฐานข้อมูล)\n');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('เกิดข้อผิดพลาด:', e.message);
  process.exit(1);
});
