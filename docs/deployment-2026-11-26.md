# ผลการปล่อยระบบ 26 พฤศจิกายน 2026

- Source commit: `514ef1fb4790631afdef6b4edb90e05adc47ba6c` — fast-forward `master` จาก `8cb541a` (9 กันยายน 2026) รวม 24 commits ของ `codex/firebase-apphosting-migration` push เวลา 19:21 น. ไทย
- ขอบเขต: รวม branch ย้ายจาก Vercel ไป Cloudflare Workers เข้า `master` และปล่อย Worker ใหม่จาก source เดียวกับ commit ล่าสุด ชุดแอป Windows/PWA คิวรับหลายใบ และซิงก์ชีทผ่าน Apps Script อยู่ใน commit นี้
- Application deployment: **เผยแพร่สำเร็จ** — version `5252a790-577a-4c95-a5b7-50b4ed98170b` รับ traffic 100%; deployment สร้างเวลา 19:29 น. ตามเวลาไทย
- Worker ปลายทาง: `doc-tracking-system` บัญชี `c926e9b2548989db0471228738765cef`
- Production: https://doc-tracking-system.store-hk.workers.dev
- Build ID ที่อ่านจาก production หลังปล่อย: `pEU4xom_WxLNAwNH_6hLu` ตรงกับ artifact ที่ build
- Version ก่อนปล่อยสำหรับ rollback: `a562b8e6-38e4-47bd-9214-ddc0a30e2b18` (deploy 10 พฤศจิกายน 2026 เวลา 18:18 น. ไทย หลัง commit `514ef1f` สามนาที) — คำสั่ง `npx wrangler rollback a562b8e6-38e4-47bd-9214-ddc0a30e2b18`
- เครื่องมือ: Next.js 15.5.28, OpenNext Cloudflare 1.20.6, Wrangler 4.151.2

## การตรวจ code และ build

- `npm run check` ที่ `514ef1f` ผ่าน exit 0: ESLint ไม่มี warnings, Node tests 379/379, money tests 26/26, Next build 42 static pages, typecheck ของแอปและ Worker ผ่าน
- Next build มี warning เดิมจาก `@supabase/supabase-js` ใช้ `process.version` ใน Edge Runtime ผ่าน `@supabase/ssr` ไม่ได้มาจาก code ของโปรเจกต์
- `git merge-tree` ระหว่าง `origin/master` กับ branch ไม่มี conflict และ `master` ไม่มี commit ที่ branch ไม่มี จึง push แบบ fast-forward ได้

## การตรวจ migration

ไม่มี migration ใหม่ใน release นี้ migration ทั้งหกไฟล์ของวันที่ 10 พฤศจิกายน (`20261110110000` ถึง `20261110123400`) ไม่มีบันทึกการลงจริงในเอกสารก่อนหน้า จึงตรวจก่อนปล่อย

ต่อ Postgres โดยตรงไม่ได้เพราะเครื่องนี้ไม่มี CA ของ Supabase (`SELF_SIGNED_CERT_IN_CHAIN`) และไม่ปิดการตรวจ TLS จึงอ่าน OpenAPI schema ของ PostgREST ด้วย server key แทน ไม่ได้เรียก RPC ใด ๆ พบครบทั้ง 16 ฟังก์ชันที่ migration ชุดนี้สร้างใน schema `public`:

| Migration | RPC ที่พบ |
|---|---|
| `20261110110000_apps_script_sheet_sync` | `configure_apps_script_sheet_sync`, `pull_apps_script_sheet_jobs`, `finish_apps_script_sheet_job` |
| `20261110121000_receive_document_worker` | `receive_document_worker` |
| `20261110123000_bulk_receipt_queue` | `enqueue_document_receipts`, `process_document_receipt_queue`, `list_document_receipt_batches` |
| `20261110123200_desktop_receipts` | `enqueue_desktop_receipts`, `list_desktop_pending_receipts`, `list_desktop_receipt_batches` |
| `20261110123300_shared_notifications` | `write_department_notification`, `access_department_notifications`, `access_owned_notifications` |
| `20261110123400_desktop_device_auth` | `desktop_device_register`, `desktop_device_claim`, `desktop_device_approve` |

วิธีนี้ยืนยันได้เฉพาะ RPC ที่ PostgREST เปิดให้เห็น ยังไม่ได้ตรวจ table ใน private schema, grants และ cron jobs ของ `20261110123100_schedule_bulk_receipt_queue` และ `doc-tracking-notifications-retention` โดยตรง

## วิธี build ที่ใช้

`npm run deploy` จากโฟลเดอร์โปรเจกต์ล้มสองครั้งก่อนถึงขั้น deploy ไม่มีอะไรขึ้น production:

1. Age checker ของ OpenNext ปฏิเสธ Next.js 15 จึงใช้ `--dangerouslyUseUnsupportedNextVersion` ตาม release ก่อนหน้า [นโยบาย Next.js](https://nextjs.org/support-policy) ยังระบุ Maintenance LTS ของรุ่น 15 ถึง 31 มกราคม 2027 flag นี้ข้ามเฉพาะการตรวจอายุ ไม่ข้าม build หรือ compatibility checks
2. `verify:cloudflare-env` พบว่า build ฝังค่า server จาก `.env.local` ลง `.open-next/cloudflare/next-env.mjs` (`SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `POSTGRES_*` ฯลฯ) จึงหยุดก่อน deploy ลบ `.open-next` ชุดนั้นทิ้งแล้ว

Release นี้ build ใน clean checkout แทน:

```bash
git worktree add --detach <โฟลเดอร์ชั่วคราว> 514ef1f
cd <โฟลเดอร์ชั่วคราว>
npm ci
# ส่งเฉพาะค่า public ที่ตรงกับ vars ใน wrangler.jsonc
export NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... NEXT_PUBLIC_APP_URL=...
npx opennextjs-cloudflare build --dangerouslyUseUnsupportedNextVersion
npm run verify:cloudflare-env
npx opennextjs-cloudflare deploy
```

- `npm ci` ข้าม install scripts ของ `esbuild`, `unrs-resolver` และ `workerd` เพราะยังไม่ได้อนุมัติใน allowScripts แต่ build และ deploy ผ่านโดยไม่ต้องเปิด
- `verify:cloudflare-env` ตอบ `Cloudflare environment bundle contains no server variables.`
- ค้นค่า `SUPABASE_SECRET_KEY`, `POSTGRES_PASSWORD` และ `SUPABASE_JWT_SECRET` แบบตรงตัวทั้ง `.open-next` ไม่พบ
- พบ host ของ Supabase ใน JS ฝั่ง browser 17 ไฟล์ ยืนยันว่าค่า public ถูก inline ตอน build
- ลบ worktree ชั่วคราวหลัง deploy

## Smoke checks หลัง deploy

| รายการ | ผล |
|---|---|
| `/BUILD_ID` | `pEU4xom_WxLNAwNH_6hLu` ตรงกับ build |
| `/` | 200, title "จดหมาย พัสดุ เอกสารภายใน" |
| `/login`, `/recipient` เมื่อไม่ล็อกอิน | 307 ไปหน้าแรก (หน้าเข้าสู่ระบบ) |
| `/api/profile`, `/api/documents`, `/api/notifications` เมื่อไม่ล็อกอิน | 401 |
| `/api/cron/overdue-documents` เมื่อไม่มี secret | 401 |

ไม่ได้รับ ปฏิเสธ หรือส่งมอบเอกสารธุรกิจจริง ไม่ได้ทดสอบด้วยบัญชีของแต่ละแผนกใน browser จริง และไม่ได้รัน `npm audit` รอบนี้

## สิ่งที่ไม่ได้ปล่อยใน release นี้

- **Cron Worker `doc-tracking-cron`**: ไม่ deploy เพราะ `cloudflare/cron-worker.ts` และ `wrangler.cron.jsonc` แก้ล่าสุดที่ `c6a0812` (20 ตุลาคม 2026) และ deploy ล่าสุดตรงกับวันนั้น
- **PWA บน GitHub Pages**: ไม่ได้ publish ใหม่ `gh-pages` deploy ล่าสุด 10 พฤศจิกายน 2026 เวลา 18:15 น. ไทยจากชุด commit เดียวกัน

## Vercel

Vercel ยังเชื่อมกับ repository และสร้าง Production deployment จาก push นี้ (GitHub deployment `8085048322`) ผล **failure** เหมือน preview ของ branch นี้ทุกครั้งตั้งแต่ย้ายออก Production ของ Vercel จึงค้างที่ `8cb541a` (9 กันยายน 2026) และไม่กระทบ Cloudflare หากไม่ใช้ Vercel แล้ว ควรตัดการเชื่อม Git ใน Vercel project settings เพื่อหยุด build และอีเมลแจ้งเตือนที่ล้มทุกครั้ง

## ข้อควรทำในครั้งถัดไป

- `npm run deploy` จากโฟลเดอร์ที่มี `.env.local` จะถูก `verify:cloudflare-env` หยุดทุกครั้ง ให้ build ใน clean checkout ตามขั้นตอนด้านบน
- ถ้าต้องตรวจ migration ผ่าน Postgres โดยตรง ต้องดาวน์โหลด CA ของ Supabase จากหน้า Database Settings มาไว้ในเครื่องก่อน
