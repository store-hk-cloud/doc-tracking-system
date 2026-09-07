-- ============================================================
-- can_view_cash() อ้างรหัสแผนกที่ไม่มีอยู่จริง
--
-- migration 008 เขียนไว้ว่า:
--     current_dept_code() IN ('FIN', 'ACC')
-- แต่ตาราง departments ไม่มีรหัส 'FIN' หรือ 'ACC' เลย (บัญชีจริงคือ 0-ADM03
-- ส่วน "ACC" เป็นแค่คำในชื่อแผนก ไม่ใช่รหัส) ฟังก์ชันนี้จึงคืน true ให้
-- super_admin เท่านั้น และ policy ทุกตัวที่เรียกมันก็ปิดประตูใส่ฝ่ายบัญชี
-- ทั้งที่ policy เขียนกำกับไว้ว่า "การเงินเห็นทุกงาน"
--
-- ผลกระทบวันนี้: ไม่มี — ทุก API route ใช้ service-role ซึ่ง bypass RLS และ
-- ตรวจแล้วว่าไม่มีหน้าไหนอ่านตารางเงินจาก browser ตรง ๆ (client ใช้แค่
-- departments กับ auth) ที่แก้เพราะนี่คือชั้นสำรองที่ตั้งค่าไว้ผิด ถ้าวันหนึ่ง
-- มีใครเพิ่มการอ่านฝั่ง browser มันจะเงียบผิดทันทีโดยไม่มีสัญญาณ
--
-- แก้ให้อ่านจาก app_settings ผ่าน cash_setting_codes() ซึ่งเป็นกลไกเดียวกับที่
-- assert_variance_approver (015) ใช้อยู่แล้ว ทั้งสองชั้นจึงไม่หลุดจากกัน
-- ค่าเริ่มต้นตรงกับ DEFAULTS.cash_viewer_dept_codes ใน src/lib/cash-settings.ts
-- ============================================================

CREATE OR REPLACE FUNCTION can_view_cash()
RETURNS BOOLEAN AS $$
  SELECT current_role_name() = 'super_admin'
     OR current_dept_code() = ANY(
          cash_setting_codes('cash_viewer_dept_codes', '0-ADM03,0-ADM03-1,0-SDM01')
        );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION can_view_cash() IS
  'ใครดูข้อมูลเงินได้ — อ่านรหัสแผนกจาก app_settings.cash_viewer_dept_codes '
  'ห้าม hardcode รหัสแผนกที่นี่อีก (ดู 022)';
