# ลด CPU แจ้งเตือนบน Cloudflare Free — 10 พฤศจิกายน 2026

ผู้ใช้อนุมัติให้ดำเนินการต่อและกำหนดให้ root ทำเอง ไม่เรียก agents รอบนี้ จึงตรวจโค้ด แก้ไข รันเทสต์ วัดผล และเผยแพร่โดย root ทั้งหมด คงแพ็กเกจ Free และ Supabase เดิม

## สิ่งที่เปลี่ยน

- `worker.ts` intercept `/api/notifications` ก่อนเข้า Next.js และใช้ dynamic import เฉพาะเส้นทางอื่น ตาม [OpenNext custom Worker](https://opennext.js.org/cloudflare/howtos/custom-worker)
- API ใช้ Supabase SSR SDK เดิมอ่าน/refresh cookie และตรวจ `getUser()` กับ Auth server จากนั้นอ่าน profile สดด้วย server secret เพื่อบังคับ active user และ department เดิม ไม่เชื่อ identity headers หรือ department จาก client
- แยกส่วนอ่าน/ล้าง KV จาก `upstash.ts` เป็น `notification-store.ts` เพื่อไม่ดึง OpenNext context เข้ามาในเส้นทางนี้ รูปแบบ key/legacy list/ขีดจำกัด 50 รายการและผู้เขียนแจ้งเตือนคงเดิม
- GET/HEAD/DELETE ส่ง `Cache-Control: private, no-store` และ `Vary: Cookie`; ทดสอบ refresh และหลาย Set-Cookie เมื่อ cookie ถูกแบ่ง chunk
- แยก TypeScript config ของ Worker ออกจาก Next เพื่อให้ใช้ runtime types ที่ Wrangler สร้าง โดยไม่กระทบ DOM types ของแอป
- ไม่มี schema migration, ไม่มีการเปลี่ยน role/department/RPC รับเอกสาร, ไม่มีการเปลี่ยนแผนหรือเพิ่มค่าใช้จ่าย

## การตรวจสอบก่อนเผยแพร่

- Node tests 287/287 ผ่าน โดยรัน `node --test --test-concurrency=4 scripts/test-*.test.mjs scripts/test-delivery-verification.mjs`
- Money tests 26/26 ผ่าน รวม 313 tests; ESLint ไม่มี warnings/errors; Next build 41 static pages และ typecheck ของแอป/Worker ผ่าน exit 0
- รอบแรกที่ใช้ concurrency เริ่มต้นมี 2 tests โหลด dependency ไม่สำเร็จ (`react` และ `next/dist/server/request/root-params`) รันสองไฟล์แยกผ่าน 35/35 แล้วรันทั้งชุดด้วย concurrency 4 ผ่านครบ ไม่แก้ production code เพื่อหลบปัญหานี้ ยังไม่มีหลักฐานยืนยันสาเหตุของการโหลดล้มเหลวชั่วคราว
- เทสต์ใหม่ 10 รายการครอบคลุมไม่มี session/identity ปลอม, inactive/missing profile, Auth ปฏิเสธ, แยกหน่วยงาน, DELETE ไม่ข้ามหน่วยงาน, refresh cookie/chunk, HEAD/method และ fallback ที่ยังไม่ import Next บนเส้นทางแจ้งเตือน
- `npm run verify:notification-worker` ผ่านกับ bundle จริงใน Miniflare/Workers runtime: anonymous 401 โดยไม่เรียก HTTP, authenticated 200 อ่าน KV จำลอง และเรียก outbound เฉพาะ Auth กับ profile 2 ครั้ง ไม่มี binding ของ Next ในการทดสอบนี้
- ตรวจ bundle ที่ Wrangler สร้าง: `init_worker().then(...)` อยู่หลังเงื่อนไข `/api/notifications` ไม่ถูกเรียกก่อน fast path
- ตรวจ public assets 83 ไฟล์กับค่า server credentials 6 ค่า ไม่พบค่าที่ตรวจรั่วในไฟล์สาธารณะ

## Release

- Source commit: `13e89a6` push ไป `origin/codex/firebase-apphosting-migration`
- Production: https://doc-tracking-system.store-hk.workers.dev
- Worker version: `060325cb-5be3-4137-9669-ff12b008acd7` traffic 100% ยืนยันด้วย `wrangler deployments list`
- Deployment: `2026-11-10T03:46:58.724Z` (10:46 น. ไทย)
- Build ID ของ Next/standalone/packaged assets/production ตรงกัน: `sTuBgLySYREYsnNMzLwdl`
- OpenNext build ใช้ standalone ที่สร้างใหม่และ `--skipNextBuild --dangerouslyUseUnsupportedNextVersion` ตาม release ก่อนหน้า ไม่อัปเกรด dependency: age checker ของ adapter ระบุเกณฑ์ 2 ปี ขณะที่ [นโยบาย Next.js ที่ตรวจในวันนี้](https://nextjs.org/support-policy) ระบุ Next.js 15 Maintenance LTS ถึง 31 มกราคม 2027
- Smoke checks 26 รายการผ่าน: หน้าแรก/Build ID, JS SHA-256 ของ 4 หน้าตรง artifact และ immutable, API unauthorized 9 เส้นทาง, unauthorized business writes 3 รายการ, protected pages redirect 3 รายการ, notification HEAD/OPTIONS/POST/DELETE และ layout JS SHA-256
- คำขอทดสอบบนข้อมูลจริงเป็นการอ่านเท่านั้น ไม่มีรับ/ปฏิเสธ/ส่งใหม่/ล้างแจ้งเตือนของผู้ใช้จริง การทดสอบ DELETE ใน production ไม่มี session และยืนยัน 401
- รุ่น rollback: `ce723185-e310-47cc-bda7-5b2990230b2d` ไม่มี schema change ให้ย้อนกลับ

## ผล CPU จากระบบจริง

ใช้ live tail แบบจำกัดเวลา 45 วินาทีต่อรอบและ reload GET ผ่าน browser/session เดิม 8 ครั้งก่อนและหลัง ไม่คัดลอก credentials ออกจาก browser ระหว่างหน้าต่างหลังปล่อยมี traffic แจ้งเตือนอื่นร่วมด้วย 3 คำขอ จึงรายงานทุก authenticated 200 ในหน้าต่างนั้น ไม่เลือกเฉพาะคำขอที่เร็ว

| `/api/notifications` ตอบ 200 | จำนวน | CPU ต่ำสุด | CPU มัธยฐาน | CPU สูงสุด | CPU เฉลี่ย |
|---|---:|---:|---:|---:|---:|
| ก่อนปล่อย | 8 | 12 ms | 16 ms | 26 ms | 17.375 ms |
| หลังปล่อย | 11 | 3 ms | 7 ms | 42 ms | 10.909 ms |

ค่า CPU มัธยฐานในตัวอย่างลด 56.25%; ค่าเฉลี่ยลดประมาณ 37.2% ไม่ใช่ผลรับรองกับโหลดทุกแบบ ทุกคำขอในสองกลุ่มตอบ 200 และไม่มี exception ในหน้าต่างหลังปล่อยไม่พบ exceededCpu แต่ยังมี CPU สูงกว่า 10 ms โดยเฉพาะ outlier 42 ms จึงยังรับประกันไม่ได้ว่าจะไม่ชนลิมิต Free อีก

นี่เป็นการลดต้นทุนเส้นทางแจ้งเตือนที่ถูกเรียกซ้ำ เส้นทางรับเอกสารและ API อื่นยังผ่าน Next.js เดิม ผล CPU ชุดนี้ไม่ใช่ผลวัดของการรับเอกสาร และไม่ได้ยืนยันว่าปัญหา 503 ทั้งระบบหมดไป การย้ายเส้นทางอื่นต้องรักษา atomic RPC, cookie/active profile/department และงาน Google Sheets ให้ครบ พร้อมวัด CPU แยกแต่ละเส้นทาง
