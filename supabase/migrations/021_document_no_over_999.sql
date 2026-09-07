-- ============================================================
-- แก้เลขที่เอกสารพังเมื่อเดือนหนึ่งมีเอกสารเกิน 999 ใบ
--
-- migration 020 ออกเลขด้วย lpad(v_seq::TEXT, 3, '0') แต่ lpad ของ Postgres
-- "ตัดปลายทิ้ง" เมื่อสตริงยาวเกิน length ที่ระบุ ไม่ใช่ขยายให้:
--     lpad('999',  3, '0') = '999'
--     lpad('1000', 3, '0') = '100'   <-- ตัดเหลือ 3 ตัว
--     lpad('1001', 3, '0') = '100'
--
-- ผลคือใบที่ 1000 ของเดือนได้เลขซ้ำกับใบที่ 100 แล้วชน unique index
-- documents_display_no_key ทำให้ INSERT ล้ม = ลงทะเบียนเอกสารไม่ได้อีกเลย
-- ตลอดเดือนนั้น (ตัวนับเดินหน้าไปแล้ว ใบถัดไปก็ยังได้ '100' ซ้ำอยู่)
--
-- ไม่ใช่เรื่องอนาคตไกล: ตัวนับเดือน 2026-09 อยู่ที่ 298 เมื่อวันที่ 7
-- (~42 ใบ/วัน) จะแตะ 999 ราวกลางเดือนเดียวกัน
--
-- วิธีแก้: เติมศูนย์ให้ครบ 3 หลักเหมือนเดิมเมื่อยังไม่ถึง 1000 และปล่อยให้
-- ยาวขึ้นเองตามจริงเมื่อเกิน (2026-09/1000) — ห้ามตัดทิ้งในทุกกรณี
--
-- การเรียง "ล่าสุด" ทุกหน้าใช้ running_no ไม่ได้ใช้ display_no (ดู
-- api/documents/route.ts) การที่ display_no ยาวไม่เท่ากันจึงไม่กระทบลำดับ
-- ============================================================

CREATE OR REPLACE FUNCTION next_document_display_no(p_received_date DATE)
RETURNS TEXT AS $$
DECLARE
  v_period TEXT := to_char(p_received_date, 'YYYY-MM');
  v_seq INTEGER;
  v_seq_text TEXT;
BEGIN
  INSERT INTO document_no_counters AS c (period, last_no)
  VALUES (v_period, 1)
  ON CONFLICT (period) DO UPDATE SET last_no = c.last_no + 1
  RETURNING last_no INTO v_seq;

  v_seq_text := v_seq::TEXT;
  -- lpad เฉพาะตอนที่สั้นกว่า 3 หลัก ไม่งั้นมันจะตัดปลายทิ้ง
  IF length(v_seq_text) < 3 THEN
    v_seq_text := lpad(v_seq_text, 3, '0');
  END IF;

  RETURN v_period || '/' || v_seq_text;
END;
$$ LANGUAGE plpgsql VOLATILE;

COMMENT ON FUNCTION next_document_display_no(DATE) IS
  'ออกเลขที่เอกสารรูปแบบ YYYY-MM/NNN นับใหม่ทุกเดือน — เกิน 999 ใบจะยาวเป็น 4 หลักเอง ไม่ตัดทิ้ง';
