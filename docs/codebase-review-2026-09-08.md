# ผลตรวจ codebase รอบเพิ่มเติม

ขอบเขต: แก้และตรวจไฟล์ในโปรเจกต์เท่านั้น ไม่รัน migration กับฐานข้อมูลจริง ไม่เปลี่ยนแพ็กเกจบริการ ไม่ push หรือ deploy ในรอบนี้

## สิ่งที่แก้

- ป้องกันผลโหลด session/profile เก่ากลับมาเติมข้อมูลหลังออกจากระบบ และยุติสถานะโหลดเมื่ออ่าน session ล้มเหลว
- ทำ client และ callback ที่ใช้ใน React effects ให้มี dependency ชัดเจน เก็บรูป preview ด้วย Next Image แบบไม่ส่งรูปในเครื่องไปยัง image optimizer
- แก้สคริปต์ตั้ง environment ให้ส่งค่าทาง stdin ตรวจชื่อก่อนประกอบคำสั่ง และไม่ใช้ fallback ที่รันไม่ได้หรืออาจตีความค่าลับเป็นคำสั่ง
- แก้ตัวสร้าง schema ให้ใช้ Postgres transaction แทน REST endpoint ที่ไม่รองรับ SQL และไม่รายงานสำเร็จเมื่อเกิดข้อผิดพลาด
- เลิกใช้ SQL ซ่อม RLS รุ่นเก่าที่เปิดสิทธิ์กว้าง ให้ตัวรันอ้าง security lockdown migration ปัจจุบัน และไม่แยก SQL ด้วย semicolon ซึ่งทำลาย function bodies
- เปลี่ยนสคริปต์ที่ข้ามการตรวจใบรับรองให้ตรวจ TLS หากใช้ CA ส่วนตัวต้องกำหนด CA ที่เชื่อถือได้ เช่น NODE_EXTRA_CA_CERTS; ไม่ทดสอบการเชื่อมต่อจริงในรอบนี้
- เลื่อนการสร้าง Redis client ไปเมื่อเรียกใช้งาน เพื่อไม่สร้าง client ที่ไม่มี configuration ระหว่าง build
- ลบตัวแปรที่ไม่ใช้ แก้ warnings โดยไม่ปิดกฎ และตั้ง lint ให้ไม่ผ่านเมื่อมี warning

## หลักฐานและวิธีตรวจซ้ำ

`npm run check` รัน lint, tests, build และ typecheck ตามลำดับ ผ่านครบในรอบนี้ โดย lint ไม่มี errors หรือ warnings และ build สร้าง static pages 41 หน้า

เพิ่มการทดสอบ authentication boundary ของ API 34 ไฟล์ รวม cron, username validation, role/department checks, session race, สคริปต์ดูแลระบบ และการสร้าง Redis client เฉพาะเมื่อใช้งาน ทดสอบ SQL ที่ยกเลิกด้วย PGlite และจำลองขอบเขตเครือข่าย/ฐานข้อมูลในชุดทดสอบ ไม่เขียนข้อมูลจริง

ตรวจ syntax ของสคริปต์ `.mjs` ทั้งโฟลเดอร์ผ่าน; `npm audit` ไม่พบช่องโหว่ที่เครื่องมือรู้จัก; `git diff --check` ผ่าน

## ตรวจรอบสุดท้ายเพิ่มเติม

- พบคำขอค้นหาถูกส่งเองเมื่อแก้คำค้นระหว่างโหลดแท็บปิดงานครั้งแรก เพราะ effect ทำงานซ้ำตาม callback ที่เปลี่ยน โดยยังไม่ได้กดค้นหา
- เพิ่ม regression test กับหน้า React จริง ยืนยันก่อนแก้พบ 2 คำขอแทน 1; หลังแก้ให้ effect รอคำขอแรกจบ การพิมพ์ไม่ส่งคำขอเอง และกดค้นหายังค้นด้วยค่าล่าสุดได้
- ทดสอบเฉพาะหน้ารับเอกสารผ่าน 4 กรณี รวมผลตอบกลับผิดลำดับและการค้นหาล้มเหลว
- หลังแก้ รัน `npm run check` ใหม่จบด้วย exit code 0: lint ไม่มี warnings, tests ผ่าน 74 + money 26 = 100 กรณี, build 41 static pages และ typecheck ผ่าน; `npm audit` พบ 0 vulnerabilities และ `git diff --check` ผ่าน

## ข้อจำกัดการรับรอง

ผลผ่านไม่ได้หมายถึง test coverage 100% หรือพิสูจน์ว่าไม่มีบั๊กทุกกรณี การทดสอบ authentication boundary ยืนยันเฉพาะผู้ไม่ล็อกอินและกรณีสิทธิ์ที่ระบุ ไม่แทนการทดสอบทุก workflow ของทุกบทบาท ไม่ได้ตรวจ visual rendering ทุกหน้าใน browser, native Android หรือบริการจริง เช่น Sheets/Drive/Redis/Blob

## บทเรียนตรวจซ้ำ

- Trigger: มีสคริปต์ซ่อมสิทธิ์รุ่นเก่าค้างอยู่แม้ migration ปัจจุบันปลอดภัยแล้ว
- Action: ตรวจ entry point เก่าด้วย ไม่ตรวจเฉพาะ API; เลิกใช้ SQL ที่เปิดสิทธิ์เกินจำเป็นและมี regression test ยืนยันว่ารันแล้วปฏิเสธ
- Evidence: พบ permissive policies และตัวรันที่แบ่ง SQL ด้วย semicolon/กลืน error ใน `apply-rls-fix.mjs`; เพิ่มการทดสอบใน `test-maintenance-security.test.mjs`
- Scope: local; Status: validated; Reviewed: 2026-09-08

บทเรียนนี้บันทึกตาม continuous-improvement เฉพาะเอกสารโปรเจกต์ ไม่เปลี่ยน AGENTS.md หรือ skill ส่วนกลาง
