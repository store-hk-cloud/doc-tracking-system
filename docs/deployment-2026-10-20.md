# ผลการปล่อยระบบ 20 ตุลาคม 2026

- Source commit: `c6a0812dfaaf98ca21e526d4ad9b3264f5682fe5`
- Git branch: `codex/firebase-apphosting-migration` — push ไป `origin` แล้ว
- Production: https://doc-tracking-system.store-hk.workers.dev
- App Worker version: `5e162f98-dea3-444c-a57c-48e3a2d8716c` ใช้ traffic 100%; deployment สร้างเวลา 11:55 น. ตามเวลาไทย
- Cron Worker version: `eca792ab-d321-452a-b5b0-93c3add8db48`
- Cron schedule: `0 1 * * *` = ทุกวัน 08:00 น. ตามเวลาไทย
- Next build ID: `r6m9fKWeXwfwR9MPNE0bP` — อ่านจาก production แล้วตรงกับ artifact ในเครื่อง

## การตรวจผ่านก่อนปล่อย

`npm run check` จบด้วย exit code 0: lint ไม่มี warnings/errors, tests ผ่าน 146 กรณีและ money tests อีก 26 กรณี, build และ typecheck ผ่าน รวมทั้ง `git diff --cached --check` และ production dependency audit ไม่พบช่องโหว่ที่เครื่องมือตรวจรู้จักในรอบนี้

`npm run deploy` สร้าง OpenNext bundle และ deploy สำเร็จ ส่วน `npm run deploy:cron` deploy Cron Worker และ schedule สำเร็จ ยืนยัน KV namespace และ secrets ที่ต้องมีด้วยการอ่านชื่อเท่านั้น ไม่เปลี่ยนค่าลับ

ตรวจไฟล์ public JavaScript/JSON/CSS 81 ไฟล์กับค่าลับ server ที่กำหนดใน environment: ไม่พบค่าดังกล่าวใน public artifact

ลง migration `20261020053000_atomic_void_cash_run.sql` แล้วก่อนปล่อย code; ตรวจสิทธิ์ RPC, ทดสอบข้อจำกัดจริงด้วยข้อมูลจำลองแล้ว rollback ทั้งหมด และยืนยันว่า Supabase API มองเห็นฟังก์ชัน

## Smoke checks หลัง deploy

| รายการ | ผล |
|---|---|
| หน้า `/` และข้อความชื่อระบบ | 200 |
| `/BUILD_ID` | 200 และตรงกับ build ในเครื่อง |
| JavaScript 3 ไฟล์ที่หน้าแรกอ้างอิง | 200 และ cache header มี immutable |
| `/api/profile`, `/api/documents`, `/api/notifications`, `/api/messenger/runs`, `/api/admin/backfill-sheets` เมื่อไม่ล็อกอิน | 401 พร้อม `success: false` |
| `/api/cron/overdue-documents` เมื่อไม่มี secret | 401 |
| `/recipient` เมื่อไม่ล็อกอิน | 307 ไปหน้าเข้าสู่ระบบ |
| username-login input รูปแบบไม่ถูกต้อง | 400 |
| Cron Worker health endpoint | 200 |

ไม่ได้กดรับเอกสาร ส่งอีเมล อัปโหลดหลักฐาน หรือเปลี่ยนยอดเงินจริงในการ smoke test ไม่ได้ทดสอบ browser ทุกบทบาทหรือ Android binary ผลนี้จึงไม่ใช่การรับรอง workflow ทุกกรณี

ข้อจำกัดและ advisory ที่ยังเหลืออยู่ใน dev tools ดู [รายงาน code review](code-review-2026-10-20.md)

## Version ก่อนปล่อยเพื่ออ้างอิงเมื่อ rollback

- App: `8e3981a9-f2e5-4587-a5bd-5596898930f7`
- Cron: `e5fe4e4a-e054-49b2-91cf-2a7fb830dbec`
- migration เพิ่มเฉพาะฟังก์ชัน ไม่ลบหรือแก้ประวัติธุรกิจ จึงไม่ต้องลบฟังก์ชันเมื่อ rollback app version เก่า
