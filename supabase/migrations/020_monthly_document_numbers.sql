-- ============================================================
-- เลขที่เอกสารแบบนับใหม่ทุกเดือน: 2026-08/001
--
-- running_no (SERIAL) ยังอยู่เหมือนเดิมและยังเดินหน้าไม่ซ้ำ ใช้เป็นลำดับเวลาภายใน
-- ของระบบ (การเรียง "ล่าสุด" ทุกหน้าอิงค่านี้) ห้าม RESTART sequence เด็ดขาด
-- เพราะจะทำให้เอกสารเดือนใหม่ไปอยู่ท้ายรายการและเลขซ้ำกันข้ามเดือน
--
-- display_no คือเลขที่ "คนอ่าน" — นับใหม่ทุกเดือนตามวันที่รับเอกสาร
-- ============================================================

ALTER TABLE documents ADD COLUMN IF NOT EXISTS display_no TEXT;

-- ตัวนับต่อเดือน แยกตารางเพื่อให้จองเลขถัดไปได้แบบ atomic โดยไม่ต้องล็อกทั้งตาราง
-- documents (การนับ COUNT(*) แล้ว +1 จะชนกันเมื่อลงทะเบียนพร้อมกันหลายเครื่อง)
CREATE TABLE IF NOT EXISTS document_no_counters (
  period TEXT PRIMARY KEY,
  last_no INTEGER NOT NULL DEFAULT 0
);

-- backfill เอกสารเดิมทั้งหมด: เรียงตาม running_no ภายในเดือนของ received_date
-- เพื่อให้ลำดับที่ได้ตรงกับลำดับที่ลงทะเบียนจริง
WITH numbered AS (
  SELECT
    id,
    to_char(received_date, 'YYYY-MM') AS period,
    row_number() OVER (
      PARTITION BY to_char(received_date, 'YYYY-MM')
      ORDER BY running_no
    ) AS seq
  FROM documents
)
UPDATE documents d
SET display_no = numbered.period || '/' || lpad(numbered.seq::TEXT, 3, '0')
FROM numbered
WHERE d.id = numbered.id
  AND d.display_no IS NULL;

-- ตั้งค่าตัวนับให้ต่อจากเลขสูงสุดของแต่ละเดือนที่ backfill ไป
INSERT INTO document_no_counters (period, last_no)
SELECT to_char(received_date, 'YYYY-MM'), count(*)
FROM documents
GROUP BY to_char(received_date, 'YYYY-MM')
ON CONFLICT (period) DO UPDATE SET last_no = GREATEST(document_no_counters.last_no, EXCLUDED.last_no);

CREATE UNIQUE INDEX IF NOT EXISTS documents_display_no_key ON documents (display_no);

-- จองเลขถัดไปของเดือนนั้นแบบ atomic: UPSERT คืนค่าใหม่ในคำสั่งเดียว สองคำขอ
-- พร้อมกันจึงได้คนละเลขเสมอ
CREATE OR REPLACE FUNCTION next_document_display_no(p_received_date DATE)
RETURNS TEXT AS $$
DECLARE
  v_period TEXT := to_char(p_received_date, 'YYYY-MM');
  v_seq INTEGER;
BEGIN
  INSERT INTO document_no_counters AS c (period, last_no)
  VALUES (v_period, 1)
  ON CONFLICT (period) DO UPDATE SET last_no = c.last_no + 1
  RETURNING last_no INTO v_seq;

  RETURN v_period || '/' || lpad(v_seq::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql VOLATILE;

COMMENT ON FUNCTION next_document_display_no(DATE) IS
  'ออกเลขที่เอกสารรูปแบบ YYYY-MM/NNN โดยนับใหม่ทุกเดือนตามวันที่รับเอกสาร';

COMMENT ON COLUMN documents.display_no IS
  'เลขที่เอกสารที่ใช้สื่อสารกับคน นับใหม่ทุกเดือน — running_no ยังเป็นลำดับภายในที่ไม่ซ้ำทั้งระบบ';
