# ผลตรวจโค้ดและการทดสอบ 20 ตุลาคม 2026

## ขอบเขต

ตรวจ source และการเปลี่ยนแปลงทั้งหมดใน workspace โดยเน้น authentication/authorization ของ API, workflow เอกสาร, ธุรกรรมเงินสด, ซิงก์ Google Sheets, การอัปโหลด, notification และการ deploy Cloudflare รวมงานที่ค้างจากการย้าย hosting เดิม ใช้ชุดทดสอบ Node/React และ Postgres ใน PGlite ร่วมกับ lint, TypeScript และ production build

ไม่ได้เปลี่ยนลำดับการรับของ ACC: ใบรับสินค้ายังต้องผ่านผู้ตรวจสอบและจัดซื้อก่อนบัญชีรับปิดงาน

## ข้อผิดพลาดที่แก้ในรอบนี้

| ความสำคัญ | ปัญหาและผลกระทบ | การแก้และหลักฐาน |
|---|---|---|
| P1 | การยกเลิกทริปเขียนใบฝากและทริปคนละคำขอ และไม่ตรวจผล update ทริป อาจตอบสำเร็จทั้งที่ข้อมูลเปลี่ยนไม่ครบ | `void_cash_run` ล็อกทริปแล้วเขียนใบฝาก ทริป และ audit ใน transaction เดียว; ทดสอบ rollback เมื่อเขียนทริปหรือ audit ล้มเหลว และป้องกันการยกเลิกซ้ำ |
| P1 | KV notification ใช้ read-modify-write ที่ key เดียว ข้อความที่มาพร้อมกันเขียนทับกันและชนข้อจำกัดการเขียน | แยก key ต่อข้อความด้วย UUID และเวลาสำหรับเรียงล่าสุด อ่านและล้างตาม prefix ของแผนก พร้อมรองรับรายการรูปแบบเดิม; ทดสอบส่งพร้อมกัน 12 รายการ |
| P1 | ดัชนีตำแหน่งแถว Sheets ที่กำลังอ่านอาจกลับมาใช้เลขแถวเก่าหลังการซ่อมหัวตาราง | ใช้ generation ตรวจ snapshot และอ่านดัชนีใหม่เมื่อมีการเลื่อนแถวระหว่างอ่าน; ทดสอบการซ่อมแทรกระหว่าง request |
| P2 | backfill แสดงลายเซ็นจากรอบปฏิเสธเดิม หลังเอกสารถูกส่งใหม่ | ล้างคอลัมน์การรับใน mirror ตามสถานะรอรับ เช่นเดียวกับ API รายการเอกสาร; มี regression test |
| P2 | backfill อาจเขียนชื่อแผนกหรือผู้ใช้ว่างเมื่อ query lookup ล้มเหลว | ตรวจข้อผิดพลาดก่อนเริ่มเขียนแถวข้อมูล; มี regression test |
| P2 | การลบผู้ใช้ตีความการอ่านประวัติที่ล้มเหลวเป็นศูนย์ | ปฏิเสธการลบเมื่ออ่าน count ไม่ได้ และตรวจ error ของ count ผู้ดูแลที่ยัง active; ทดสอบทั้งประวัติเอกสารและการรับ |
| P2 | หน้าเซ็นรายใบไม่คืนสถานะปุ่มเมื่อ fetch/JSON ล้มเหลว | ใช้ try/finally และแสดงข้อผิดพลาดพร้อมเปิดให้ลองใหม่; ทดสอบทั้งผู้รับและผู้ตรวจสอบกับ network/invalid JSON |
| P2 | รูปที่ชื่อเดียวกันและอัปโหลดในมิลลิวินาทีเดียวกันชน object path | เติม UUID ใน path โดยคง `upsert: false`; ทดสอบอัปโหลดพร้อมกันด้วยชื่อเดียว |
| P2 | ค่า fallback `none` ไม่ใช่ UUID ทำให้ query lookup ของรายการว่างล้มเหลว | ใช้ UUID ศูนย์ตาม pattern ที่มีอยู่ในระบบ |
| P2 | บาง test mock ใช้การอ่าน Sheets แบบเก่า หรือไม่แทน relative import ทำให้พยายามอ่าน environment จริง | ปรับ fixture ให้รองรับ batchGet และแทน dependency alias/relative ตัวเดียวกัน โดยยังทดสอบ route และ SQL จริง |
| P2 | lint/TypeScript ไล่ generated Cloudflare output จนหน่วยความจำหมด | ข้าม `.open-next`, `.wrangler`, standalone output และ generated runtime types ในการตรวจ source; คง lint warnings เป็นข้อผิดพลาด |

## Dependency และ runtime

- อัปเดต lockfile ด้วย `npm audit fix` โดยไม่ใช้ `--force` และไม่เปลี่ยน major: Next.js 15.5.28, Capacitor Android 7.6.9, Wrangler 4.151.2 และ sharp 0.35.5
- `npm audit --omit=dev --audit-level=moderate` ผ่าน: production dependency ไม่มี advisory ที่ audit ตรวจพบในรอบนี้
- full audit ยังรายงาน 5 รายการใน dependency tree ของเครื่องมือ lint ซึ่งโยงถึง `braces` advisory เดียวกัน ไม่บังคับ downgrade `eslint-config-next` เป็น 14 เพราะจะเปลี่ยน configuration/รุ่นหลักของเครื่องมือ รายการนี้ไม่ใช่ production dependency
- กำหนด account_id ใน Wrangler ให้ตรง Worker ตัวจริง ป้องกัน cache บัญชีเก่าหลังสลับ login
- ตัด generated output ออกจาก lint; การ reload เต็มหน้าหลังเปลี่ยน session คงไว้พร้อมอธิบายข้อยกเว้น lint เฉพาะบรรทัด เนื่องจาก AuthProvider โหลด profile เมื่อเริ่ม mount

## หลักฐานการตรวจ

- `npm test`: 146 tests ผ่าน และ money tests อีก 26 กรณี
- `npm run lint`: ผ่าน ไม่มี warnings/errors
- `npm run typecheck`: ผ่าน
- `npm run build`: ผ่าน สร้าง static pages 41 หน้า
- `opennextjs-cloudflare build`: สร้าง Worker bundle ได้บน Windows; รันใหม่ก่อน deploy จาก source สุดท้าย
- `git diff --check`: ผ่านด้วย Git line-ending configuration ของ repository
- ลง migration `20261020053000_atomic_void_cash_run.sql` ผ่านการเชื่อมต่อ TLS ที่ตรวจ CA ของ Supabase แล้ว ยืนยันว่าเฉพาะ service_role เรียก RPC ได้
- ทดลอง void กับทริปจำลองในฐานข้อมูลจริงภายใน transaction: สถานะยกเลิกและ audit ถูกต้อง จากนั้น rollback ข้อมูลจำลองทั้งหมด
- เรียก RPC ผ่าน Supabase API ด้วย actor ที่ไม่มีอยู่ ได้ `void_forbidden` ยืนยันว่า API เห็นฟังก์ชันและไม่ข้ามการตรวจสิทธิ์

## ข้อจำกัด

- ผลผ่านไม่ใช่การรับรอง coverage 100% หรือไม่มีบัคทุกกรณี ไม่ได้ทดสอบ Android binary และทุก workflow ของทุกบทบาทผ่าน browser
- Google Sheets ยังเป็น mirror แบบ best-effort; การเรียง sync ปกติป้องกันคำขอของ reference เดียวกันภายใน instance และ backfill lease ป้องกัน backfill พร้อมกัน การทำ durable queue ข้ามทุก instance ยังไม่ถูกเปิดใช้
- `google-sheets-sync-queue.ts` เป็น helper ที่ค้างอยู่เดิมและยังไม่มี production caller/ฐานข้อมูล queue จึงไม่ได้อ้างว่า release นี้เปิดใช้ durable queue
- KV เป็น eventually consistent การแจ้งเตือนข้าม location อาจเห็นช้า แม้การเขียนพร้อมกันจะไม่ทับ key เดียวกันแล้ว
- รายงาน deployment และ smoke checks บันทึกแยกหลัง deploy สำเร็จ

## บทเรียนที่ยืนยันแล้ว

- Trigger: ย้ายจาก Redis list ไป Cloudflare KV หรือเปลี่ยน API การอ่านบริการใน test fixture
- Action: ทดสอบ concurrent writes ด้วยข้อจำกัดของ storage จริง และให้ mock รองรับ API รุ่นปัจจุบันโดยยังตรวจผลลัพธ์ที่ผู้ใช้เห็น
- Evidence: notification 12 คำขอล้มเหลว/สูญหายก่อนแก้ ผ่านหลังแยก key; regression การเลื่อนแถว Sheets ล้มเหลวก่อนแก้และผ่านเมื่อทิ้ง snapshot เก่า
- Scope: local; Status: validated; Reviewed: 2026-10-20

อ้างอิง: [Cloudflare KV concurrent writes](https://developers.cloudflare.com/kv/api/write-key-value-pairs/#concurrent-writes-to-the-same-key), [KV list API](https://developers.cloudflare.com/kv/api/list-keys/), [OpenNext Cloudflare](https://opennext.js.org/cloudflare/get-started)
