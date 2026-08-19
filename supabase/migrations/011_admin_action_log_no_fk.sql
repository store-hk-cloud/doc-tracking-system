-- 011_admin_action_log_no_fk.sql
--
-- แก้ข้อบกพร่องของ 010: FK ที่ตั้ง ON DELETE SET NULL ทำให้ลบผู้ใช้ไม่ได้เลย
--
-- อาการที่เจอจากการทดสอบจริง: ลบบัญชีที่เคยปรากฏใน admin_action_log แล้วได้
--   ERROR: table public.admin_action_log is append-only; UPDATE is not permitted
-- ทั้งจาก DELETE FROM profiles และจาก supabase.auth.admin.deleteUser (ซึ่ง
-- cascade ลง profiles อีกทอด) ผลคือ DELETE /api/profiles/[id] พังด้วยข้อความ
-- ที่ไม่มีใครเดาได้ว่าเกี่ยวอะไรกับการลบผู้ใช้
--
-- สาเหตุ: ON DELETE SET NULL คือคำสั่ง UPDATE ที่ Postgres ยิงเอง ซึ่งชนกับ
-- trigger forbid_mutation() ที่ตั้งใจให้ตารางนี้แก้ไม่ได้ สองข้อนี้อยู่ร่วมกันไม่ได้
--
-- ทางแก้: ตัด FK ออก เก็บเป็น UUID เปล่า
--   - ประวัติต้องอยู่รอดแม้บัญชีถูกลบ (นั่นคือเหตุผลที่เลือก SET NULL แต่แรก)
--     ตัด FK ได้ผลนั้นโดยไม่ต้องแก้แถวเดิมเลย
--   - ตัวตนที่อ่านได้อยู่ใน target_label / actor_signature ซึ่งเป็น snapshot
--     ข้อความ ณ เวลานั้น อ่านรู้เรื่องแม้บัญชีหายไปแล้ว
--   - ห้ามเปลี่ยนเป็น RESTRICT: การเคยถูกตั้งรหัสผ่านใหม่ ไม่ควรทำให้บัญชีนั้น
--     ลบไม่ได้ตลอดไป
--
-- หมายเหตุ: ตารางเงินใน 007 ใช้ FK แบบ NO ACTION (ค่าเริ่มต้น) ซึ่งถูกต้องแล้ว
-- และไม่กระทบ เพราะ NO ACTION บล็อกการลบตรง ๆ ไม่ได้ยิง UPDATE ย้อนกลับมา

ALTER TABLE admin_action_log
  DROP CONSTRAINT IF EXISTS admin_action_log_target_profile_id_fkey;

ALTER TABLE admin_action_log
  DROP CONSTRAINT IF EXISTS admin_action_log_actor_id_fkey;

COMMENT ON COLUMN admin_action_log.target_profile_id IS
  'UUID ของบัญชีเป้าหมาย ไม่มี FK โดยเจตนา — บัญชีถูกลบได้ แต่ประวัติต้องคงอยู่ (ดู 011)';
COMMENT ON COLUMN admin_action_log.actor_id IS
  'UUID ของผู้กระทำ ไม่มี FK โดยเจตนา — ชื่อที่อ่านได้อยู่ใน actor_signature (ดู 011)';
