# ย้าย Google Sheets ออกจาก Cloudflare

Apps Script อ่านคิวผ่าน Supabase RPC โดยตรง แล้วเขียนข้อมูลคอลัมน์ A:U แบบ RAW ในแท็บรายวัน ใช้รหัสผู้รับเอกสารในคอลัมน์ U เพื่อหาแถวเดิม หากมีแถวเก่าที่จับคู่ไม่ได้อย่างชัดเจน งานจะค้างไว้เพื่อให้ตรวจสอบ ส่วนคอลัมน์ V เป็นต้นไปยังใช้สำหรับข้อมูลที่ทีมกรอกเองได้

## ตั้งค่าก่อนเปิดใช้งาน

1. ใช้ migration `20261110110000_apps_script_sheet_sync.sql` ใน Supabase โปรเจกต์ `doc-tracking` คิวจะเริ่มเก็บรายการใหม่ ส่วนตัวอ่านคิวเริ่มในสถานะปิด
2. ตั้ง `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` และ `SHEETS_SYNC_TOKEN` ใน **Project Settings → Script properties** ของ Apps Script ให้ตรงกับ token ที่ลงทะเบียนใน Supabase ผ่าน `configure_apps_script_sheet_sync` ใช้เฉพาะ publishable key กับ token สำหรับคิวนี้ เก็บค่าใน Script Properties ของโปรเจกต์และจำกัดผู้แก้ไขสคริปต์
3. ใช้บัญชีเจ้าของเดิมเปิด Apps Script Editor เลือก `installSheetSync` แล้วกด **Run** อนุญาตสิทธิ์ของ Google เมื่อระบบถาม ฟังก์ชันตรวจสิทธิ์อ่านชีทและทดสอบ Supabase ก่อนสร้าง trigger ทุก 5 นาที หากเรียกซ้ำจะใช้ trigger เดิมของบัญชีนั้น
4. ตรวจว่า `installSheetSync` ทำงานสำเร็จและพบ trigger `syncPendingSheetJobs` ในหน้า **Triggers** จึง deploy Cloudflare โดยตั้ง `GOOGLE_SHEETS_SYNC_MODE=apps_script` บน Worker หลังยืนยันว่าเวอร์ชันใหม่รับ traffic ทั้งหมดแล้ว จึงเปิดการดึงคิวด้วย `configure_apps_script_sheet_sync(NULL, true)` และตรวจผลเขียนจริงจากงานที่เข้าคิว
5. หากต้องส่งข้อมูลเดิมซ้ำ ให้ผู้ดูแลระบบใช้ปุ่ม **อัปเดตข้อมูลเก่าใน Sheets** หลัง cutover ระบบจะเข้าคิวผู้รับทั้งหมดโดยใช้ข้อมูลล่าสุดจาก Supabase

หากต้องย้อนกลับ ให้ปิดการดึงคิวด้วย `configure_apps_script_sheet_sync(NULL, false)` และรอให้ execution ที่กำลังเขียนชีทจบก่อนคืนโหมด Cloudflare เดิม คิวจะยังเก็บการเปลี่ยนแปลงไว้เพื่อใช้เมื่อเปิดใหม่

## อัปเดต Apps Script

ใช้ `.clasp.json` ที่ชี้ไปยัง Script ID ของโปรเจกต์เดิมในโฟลเดอร์ deploy แยกจาก repository เก็บ backup ของ HEAD และเวอร์ชันที่ deploy อยู่ก่อนใช้ `clasp push` จากนั้นสร้าง immutable version ด้วย `clasp version` และอัปเดต deployment ID เดิมผ่าน `clasp redeploy <deploymentId> --versionNumber <version>` ตรวจด้วย `clasp deployments`
