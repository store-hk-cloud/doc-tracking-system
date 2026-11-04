# ตรวจความช้าของระบบ 4 พฤศจิกายน 2026

ผู้ใช้แจ้งว่าทีมงานรู้สึกช้าทั้งระบบ ตรวจจาก source, การอ่านฐานข้อมูลจริงแบบ read-only, เวลาตอบสนองของ production และ regression tests

เผยแพร่การแก้ไขแล้วเวลา 10:01 น. ตามเวลาไทย Source commit `a492049a2435ab817806f89e3d07e99fe1d684d7` push ไป `origin/codex/firebase-apphosting-migration` แล้ว

## หลักฐานก่อนแก้

- ฐานข้อมูลมีเอกสาร 2,375 ใบ และรายการผู้รับ 2,376 รายการ โดยปิดงานแล้ว 2,283 รายการ
- `GET /api/documents?limit=10` อ่านเอกสารทั้งหมดก่อนจำกัดผลลัพธ์: 18 คำขอ Supabase REST, ข้อมูลภายใน 3,190,727 bytes เพื่อคืนเพียง 13,167 bytes / 10 รายการ ใช้ 6,122 ms ใน baseline ครั้งแรก
- คิวสถานะ registered/delivered/awaiting_inspector/awaiting_purchasing/awaiting_recipient คืน 91 รายการ แต่ยังอ่านเอกสารทั้งหมด: 18 คำขอ, 1,619,843 bytes, 3,695 ms
- Query SQL ที่เรียงเอกสาร 1,000 ใบใช้เวลา execution เพียง 2.455 ms แต่ network round trip ของฐานข้อมูลประมาณ 260–320 ms และ Supabase REST ขนาดเล็กประมาณ 400 ms จึงมีต้นทุนจากจำนวนคำขอและข้อมูลที่ขนส่งชัดเจน
- Middleware เรียก `auth.getUser()` แล้ว API handler เรียกซ้ำอีกครั้ง SDK ที่ติดตั้งส่ง HTTP request ทุกครั้งเมื่อมี session การตัดรอบซ้ำยังคงให้ handler ตรวจตัวตน, active profile, role และ department ตามเดิม
- สังเกต Worker จริงพบ `/api/notifications` ตอบ 200 สองครั้ง: CPU 13 ms ทั้งสองครั้ง แต่ wall time 967 / 995 ms ไม่มี exception เป็นหลักฐานประกอบว่าเวลารอ I/O สูงกว่าเวลา CPU
- หน้าแรกที่ยังไม่ล็อกอินตอบประมาณ 43–251 ms จาก BKK การทดสอบ 401 แบบไม่ล็อกอินใช้ยืนยันการป้องกัน API เท่านั้น ไม่ใช้แทนเวลาของผู้ใช้ที่ล็อกอินแล้ว

## การแก้ไข

- รายการแบบกำหนด limit อ่านเอกสารเป็นก้อนและหยุดเมื่อได้จำนวนรายการที่ผู้ใช้มีสิทธิ์เห็นครบ
- คิวที่กรองสถานะ/หน่วยงานเลือกผู้รับที่ตรงก่อน แล้วโหลดเอกสารเฉพาะชุดที่จำเป็นเมื่อชุดนั้นเล็ก
- คำค้นและวันที่รับที่ทำให้ผลแคบยังกรอง documents ก่อน เพื่อไม่อ่านประวัติผู้รับทั้งหมดก่อนรู้ว่าค้นไม่พบ
- `scope=mine` ของ user กรองผู้ลงทะเบียนตั้งแต่ query โดยคงการตรวจสิทธิ์เดิม
- API ผ่าน middleware ไปตรวจและ refresh session ที่ handler เพียงครั้งเดียว เส้นทางหน้าเว็บยังตรวจ session ใน middleware ตามเดิม
- ไม่มีการเปลี่ยน schema, caching ข้อมูลส่วนบุคคล หรือการเขียนเอกสารธุรกิจระหว่างวัดผล

## การยืนยันผล

เปรียบเทียบ source ก่อน/หลังกับ Supabase REST จริงแบบเรียงทีละกรณี ตรวจ SHA-256 ของ JSON แล้วตรงกันครบทั้ง 8 กรณี รวมลำดับและค่าข้อมูลที่ส่งกลับ

| กรณี | จำนวนผลลัพธ์ | ก่อน → หลัง (ms) | คำขอ DB ก่อน → หลัง | ข้อมูล DB ก่อน → หลัง (bytes) |
|---|---:|---:|---:|---:|
| Admin ล่าสุด 10 รายการ | 10 | 5,830 → 1,844 | 18 → 5 | 3,190,727 → 266,858 |
| Admin คิวรับ 4 สถานะ | 84 | 3,903 → 1,226 | 18 → 5 | 1,615,510 → 112,341 |
| Admin ประวัติทั้งหมด | 2,376 | 5,417 → 4,872 | 29 → 29 | 3,897,041 → 3,897,041 |
| Admin ค้นไม่พบในปิดงาน | 0 | 510 → 384 | 1 → 1 | 2 → 2 |
| Admin ปิดงานเฉพาะวันที่รับ | 0 | 749 → 768 | 2 → 2 | 4,084 → 4,084 |
| User ล่าสุด 10 รายการ | 10 | 4,064 → 1,659 | 18 → 5 | 3,190,764 → 266,895 |
| User งานตนเองรอส่งมอบ | 0 | 3,178 → 718 | 15 → 2 | 1,563,169 → 4,268 |
| User คิวรับ 4 สถานะ | 28 | 3,610 → 1,156 | 18 → 5 | 1,615,181 → 112,012 |

เวลาของประวัติทั้งหมดและการค้นหาแคบแปรผันตามเครือข่าย ปริมาณงานสองกลุ่มนี้ไม่ได้ลดลง จึงไม่สรุปว่าเร็วขึ้นจากตัวเลขรอบเดียว กลุ่มล่าสุด 10 รายการและคิวรับลดจำนวนคำขอประมาณ 72% และลดปริมาณข้อมูลประมาณ 92–93%

Harness ใส่ auth context ของ admin/user เพื่อแยกเวลาอ่านข้อมูล จึงไม่รวม Cloudflare และการตรวจ auth ทางเครือข่าย ผลนี้ไม่ใช่เวลาโหลดหน้าเว็บของผู้ใช้ทุกเครื่อง

Independent dev-reviewer ไม่พบ Critical/Important ค้าง และ dev-tester รัน `npm test` ผ่าน 215 Node tests + 26 money tests รวม 241 tests พร้อม edge-case QA ของ limit, ขอบก้อนข้อมูล, เลขซ้ำและสิทธิ์ user

Root รัน `npm run check` รอบสุดท้ายผ่าน exit 0: 215 Node tests + 26 money tests, ESLint ไม่มี warnings/errors, Next build 41 static pages และ typecheck ผ่าน ตรวจ Build ID ของ Next และ standalone ตรงกัน: `8uYhTyhfV6uOcNM_GM-Rn`

ระหว่างตรวจรวมรอบแรกพบ module-load error ในเทสต์ auth boundary ที่โหลด Google SDK ทั้งที่ทดสอบการปฏิเสธก่อนใช้งาน client ตรวจพบว่าไฟล์ SDK ยังอยู่และ direct import ได้ จึงแยก client ภายนอกในเทสต์ พร้อม tripwire จับการ bootstrap SDK และตัวนับที่จับการเข้าถึงก่อน auth แม้ wrapper จับ error ไว้ ไม่เปลี่ยน dependency หรือ concurrency และยังใช้ handler/auth guard จริง การสร้างแอปจริงตรวจ package imports ตามเดิม

OpenNext packaging และ deployment ผ่าน exit 0 ตรวจ production smoke checks ผ่านครบ 21 รายการ รายละเอียดรุ่นและการตรวจอยู่ด้านล่าง

## ขอบเขตที่ต้องติดตาม

- API ที่ขอประวัติทั้งหมดโดยไม่กรองยังคืนครบทุกแถว ปริมาณ response ก่อนแก้ประมาณ 3.37 MB สำหรับ 2,376 รายการ จึงยังอาจใช้เวลาหลายวินาที
- การบันทึกบางขั้นรอ Google Sheets อยู่ การเปลี่ยนเป็น background sync ต้องมี durable queue และการประมวลผลซ้ำที่ยืนยันแล้ว จึงต้องวัดและออกแบบแยกก่อนเปลี่ยนพฤติกรรม
- ต้องรับ feedback จากอุปกรณ์และเครือข่ายของทีมงานหลังปล่อย เพื่อแยกเวลาฝั่งระบบออกจากเครือข่ายแต่ละจุด

## การสร้าง release

ใช้ Next.js 15 รุ่นที่ติดตั้งเดิม [นโยบาย Next.js](https://nextjs.org/support-policy) ที่ตรวจวันนี้ระบุ Maintenance LTS ถึง 31 มกราคม 2027 ส่วน OpenNext 1.20.6 ยังใช้ age checker เดิม จึงต้องใช้ flag `--dangerouslyUseUnsupportedNextVersion` ตาม release วันที่ 3 พฤศจิกายน โดยยังคง build และ compatibility checks

ก่อนใช้ `--skipNextBuild` ต้องสร้าง Next.js แบบ standalone ใหม่และตรวจว่า Build ID ของ `.next` กับ `.next/standalone/.next` ตรงกัน เพื่อป้องกันการบรรจุ artifact เก่า

## ผลเผยแพร่และการตรวจระบบจริง

- Production: https://doc-tracking-system.store-hk.workers.dev
- Worker: `doc-tracking-system` บัญชี `store-hk@hillkoff.com`
- Version: `c4caab46-0615-48db-b7ed-ab2ed09638af` รับ traffic 100% ยืนยันจาก `wrangler deployments list` สร้าง deployment เวลา `2026-11-04T03:01:27.823Z`
- Build ID: `8uYhTyhfV6uOcNM_GM-Rn` ตรงกันระหว่าง Next, standalone, packaged assets และ production
- `npm run check` สร้าง standalone ใหม่โดยตั้ง `NEXT_PRIVATE_STANDALONE=true` เฉพาะคำสั่ง จากนั้นใช้ `opennextjs-cloudflare build --skipNextBuild --dangerouslyUseUnsupportedNextVersion` เพื่อบรรจุ artifact ชุดที่เพิ่งตรวจผ่าน
- ตรวจ public assets 83 ไฟล์กับค่า credentials ฝั่ง server 6 ค่า ไม่พบค่าที่ตรวจในไฟล์สาธารณะ ไม่ได้นับ Supabase anon/publishable key ซึ่งเป็นค่าฝั่ง browser เป็น secret
- หน้าแรกตอบ 200 และ JavaScript ของ Dashboard, คิวรับ, หน้ารายใบ และติดตามตอบ 200 พร้อม SHA-256 ตรงกับไฟล์ในเครื่องและ immutable cache header
- GET ของ profile, documents, notifications, departments, stats, messenger, backfill และ cron เมื่อไม่มีสิทธิ์ตอบ 401 แม้ส่ง identity headers ปลอมมา
- POST ลงทะเบียน และ PUT ลงนาม/ส่งใหม่ด้วย UUID ศูนย์ เมื่อไม่มีสิทธิ์ตอบ 401 ก่อนเขียนข้อมูล
- หน้า Dashboard, คิวรับ และติดตามเมื่อไม่ล็อกอินตอบ 307 กลับหน้าเข้าสู่ระบบ
- สังเกต Worker 45 วินาทีหลังปล่อย พบคำขอ `/api/notifications` ของผู้ที่ล็อกอินแล้วตอบ 200 สามครั้ง wall time 924 / 899 / 648 ms ไม่มี exception ตัวอย่างน้อยเกินกว่าจะสรุปเปอร์เซ็นต์เวลาใช้งานจริง
- ไม่ได้ทำขั้นรับ/ปฏิเสธ/ส่งมอบเอกสารธุรกิจจริง หรือทดสอบ browser ของทีมงานทุกเครื่องระหว่าง release
- ไม่มี migration และไม่ต้อง deploy Cron Worker รอบนี้
- รุ่นก่อนหน้าสำหรับ rollback: `23baede0-bf6c-4a59-8eb8-5f11ebe526b4` โดย schema ไม่เปลี่ยน
