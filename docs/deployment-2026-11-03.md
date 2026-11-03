# ผลการปล่อยระบบ 3 พฤศจิกายน 2026

- Source commit: `d8196e08d04b2b272c2d2efae8a27333806e49e2` — push ไป `origin/codex/firebase-apphosting-migration` แล้ว
- Feature: ผู้ตรวจสอบและจัดซื้อเลือกถูกต้อง/ไม่ถูกต้องได้ เมื่อไม่ถูกต้องต้องระบุเหตุผลและส่งกลับธุรการแก้ไขและส่งใหม่
- Migration: `20261103090000_goods_receipt_stage_verification.sql` ลงฐานข้อมูลจริงสำเร็จแล้ว โดยตรวจ TLS ด้วย CA ของ Supabase
- Application deployment: **เผยแพร่สำเร็จ** — version `23baede0-bf6c-4a59-8eb8-5f11ebe526b4` รับ traffic 100%; deployment สร้างเวลา 10:04 น. ตามเวลาไทย
- Worker ปลายทาง: `doc-tracking-system` บัญชี `c926e9b2548989db0471228738765cef`
- Production: https://doc-tracking-system.store-hk.workers.dev
- Build ID ที่อ่านจาก production หลังปล่อย: `ZySqTYBANJHJTqwERFtYr` ตรงกับ artifact ในเครื่อง
- Build ID ที่อ่านจาก production ก่อนปล่อย: `r6m9fKWeXwfwR9MPNE0bP`

## การตรวจ migration

ทดลอง DDL ใน transaction แล้ว rollback ก่อนลงจริง ยืนยันว่าไม่มี overload เดิมค้าง, ฟังก์ชันใหม่เรียกได้เฉพาะ service_role, browser roles ไม่มีสิทธิ์ execute และ nullable columns ทั้งหกอยู่ครบ จากนั้นจึงลงจริงและ reload PostgREST schema

ตรวจผ่าน Supabase API ด้วย recipient UUID ศูนย์ที่ไม่มีอยู่: signature รุ่นเดิม 6 arguments และรุ่นใหม่ 8 arguments ตอบ `document_recipient_not_found`, การปฏิเสธโดยไม่มีเหตุผลตอบ `invalid_verification`, reset ตอบ `stage_changed` ไม่ได้ใช้เอกสารจริงหรือเขียนประวัติธุรกิจในการตรวจเหล่านี้

## การตรวจ code และ build

- `npm run check` ก่อน commit ผ่าน: 191 Node tests และ 26 money tests, lint ไม่มี warnings, build 41 static pages, typecheck ผ่าน
- Independent dev-reviewer และ exec-reviewer ปิด must-fix ครบก่อนปล่อย; release reviewer ตรวจ compatibility, grants และการรัน migration ซ้ำแล้วผ่าน
- `git diff --cached --check` ผ่าน และ working tree สะอาดหลัง push source
- สร้าง OpenNext Worker bundle สำเร็จ และตรวจไฟล์ public JS/JSON/CSS 81 ไฟล์ไม่พบค่า server credentials ที่ใช้ตรวจ

## คำสั่ง build สำหรับ release นี้

```powershell
npx opennextjs-cloudflare build --dangerouslyUseUnsupportedNextVersion
npx opennextjs-cloudflare deploy
```

OpenNext Cloudflare 1.20.6 ใช้ checker ที่คำนวณ release date + 2 ปี จึงปฏิเสธ Next.js 15 ในเดือนพฤศจิกายน 2026 อย่างไรก็ตาม [นโยบาย Next.js](https://nextjs.org/support-policy) ปัจจุบันขยาย Maintenance LTS ของรุ่น 15 ถึง 31 มกราคม 2027 จึงใช้ flag เฉพาะครั้งนี้เพื่อผ่านการตรวจอายุที่ล้าสมัย โดยไม่ปิดขั้น build หรือ compatibility checks และไม่เปลี่ยน framework version

`npm audit --omit=dev --audit-level=moderate` ในวันที่ปล่อยพบ 7 moderate advisories ใน dependency tree ของ `qs`, `glob`, `minimatch` ไม่มี high/critical ในรายงาน การแก้ทั้งหมดที่ npm เสนอต้องมี breaking changes จึงไม่ใช้ `npm audit fix --force` ระหว่าง release นี้ ผลนี้ต่างจาก audit วันที่ 20 ตุลาคมซึ่งเป็นข้อมูลย้อนหลัง

ไม่ต้อง deploy Cron Worker เพราะ feature นี้ไม่ได้แก้ cron entry point หรือ schedule

## Smoke checks หลัง deploy

| รายการ | ผล |
|---|---|
| หน้าแรกและข้อความชื่อระบบ | 200 |
| `/BUILD_ID` | ตรงกับ build ใหม่ในเครื่อง |
| JavaScript ของคิวรับเอกสาร, หน้ารายใบ และหน้าติดตาม | 200, SHA-256 ตรงกับ artifact ทั้งสามไฟล์, cache header มี immutable |
| `/api/profile`, `/api/documents`, `/api/notifications`, `/api/messenger/runs`, `/api/admin/backfill-sheets` เมื่อไม่ล็อกอิน | 401 พร้อม `success: false` |
| `/api/cron/overdue-documents` เมื่อไม่มี secret | 401 |
| PUT ขั้นลงนามและส่งใหม่ เมื่อไม่ล็อกอิน | 401 |
| `/recipient` เมื่อไม่ล็อกอิน | 307 ไปหน้าเข้าสู่ระบบ |

ไม่ได้รับหรือปฏิเสธเอกสารธุรกิจจริงระหว่าง smoke checks; workflow ผลตรวจและส่งใหม่ตรวจด้วย regression tests ของ React, API และ PGlite ก่อนปล่อย ไม่ได้ใช้บัญชีแต่ละแผนกทดสอบทุกขั้นใน browser จริง

Version ก่อนปล่อยสำหรับ rollback: `5e162f98-dea3-444c-a57c-48e3a2d8716c` — migration ใหม่รองรับคำขอ RPC แบบเดิม 6 arguments ด้วย default parameters จึงคง schema นี้ไว้ได้เมื่อ rollback app รุ่นก่อน
