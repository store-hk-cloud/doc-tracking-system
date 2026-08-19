-- 010_admin_action_log.sql
--
-- บันทึกการกระทำของผู้ดูแลระบบที่กระทบสิทธิ์การเข้าถึงบัญชีผู้อื่น
--
-- ที่มา: บัญชีแมสเซนเจอร์ล็อกอินด้วยชื่อผู้ใช้ ไม่มีอีเมลจริงให้ส่งลิงก์รีเซ็ต
-- จึงต้องมีปุ่มตั้งรหัสผ่านใหม่ให้ผู้ดูแลกดแทนได้ แต่ความสามารถนั้นแปลว่า
-- ผู้ดูแลเข้าใช้บัญชีแมสเซนเจอร์แทนตัวจริงได้ ซึ่งในโมดูลเงินสดคือช่องที่ใช้
-- สร้างรายการรับ-ฝากเงินในนามคนอื่นได้ ถ้าไม่บันทึกไว้จะไม่มีใครรู้ว่าเกิดขึ้น
--
-- ตารางนี้จึงเป็น append-only เหมือน messenger_job_audit: แก้ไม่ได้ ลบไม่ได้
-- แม้ด้วย service-role เพราะทุก route ในโปรเจกต์นี้ใช้ service-role client
--
-- ใช้ forbid_mutation() ที่สร้างไว้แล้วใน 007

CREATE TABLE IF NOT EXISTS admin_action_log (
  -- BIGSERIAL: id ที่กระโดดเป็นหลักฐานว่ามีการพยายามลบ
  id BIGSERIAL PRIMARY KEY,
  action VARCHAR(50) NOT NULL,

  -- ON DELETE SET NULL เพื่อไม่ให้การลบบัญชีลบประวัติทิ้งไปด้วย
  target_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- snapshot ชื่อ/ชื่อผู้ใช้ ณ เวลานั้น อ่านได้แม้บัญชีถูกลบภายหลัง
  target_label VARCHAR(255) NOT NULL,

  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- เขียนจาก profiles.full_name ฝั่ง server เท่านั้น ไม่รับจาก body
  actor_signature VARCHAR(255) NOT NULL,
  actor_role VARCHAR(30),

  request_ip VARCHAR(64),
  user_agent TEXT,
  -- ห้ามเก็บรหัสผ่านหรือ token ลงคอลัมน์นี้เด็ดขาด
  detail JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_action_log_target
  ON admin_action_log(target_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_action_log_created
  ON admin_action_log(created_at DESC);

DROP TRIGGER IF EXISTS admin_action_log_no_update ON admin_action_log;
CREATE TRIGGER admin_action_log_no_update
  BEFORE UPDATE OR DELETE ON admin_action_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DROP TRIGGER IF EXISTS admin_action_log_no_truncate ON admin_action_log;
CREATE TRIGGER admin_action_log_no_truncate
  BEFORE TRUNCATE ON admin_action_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- เปิด RLS โดยไม่ประกาศ policy ใด = อ่านตรงจาก browser ไม่ได้เลย
-- ต้องผ่าน route ที่ตรวจสิทธิ์ก่อนเท่านั้น
ALTER TABLE admin_action_log ENABLE ROW LEVEL SECURITY;
