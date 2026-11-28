# แบบระบบ: ย้าย doc-tracking ขึ้น dev01 (Laravel + MySQL)

สถานะ: **แบบสรุปแล้ว** 28 พ.ย. 2026 · ตัดสินใจครบทุกข้อ (ข้อ 16) · ดึงข้อมูล Supabase ชุดแรกแล้ว · ยังไม่เริ่มเขียนโค้ด
ต้นแบบการติดตั้ง: `C:\Users\Office14\Documents\skillmatrix\work\DEPLOY-PATTERN.md` (Skill Matrix บน dev01)

---

## 0. สรุปการตัดสินใจ

| เรื่อง | ตัดสินใจ |
|---|---|
| ปลายทาง | `dev01` 192.168.20.188 · Apache 2.4 + mod_php 8.5 · MySQL 8.4 · ใช้ใน LAN ผ่าน HTTP |
| ชื่อ `APP` | `doctracking` → `http://192.168.20.188/doctracking/` · ฐานข้อมูลและผู้ใช้ MySQL ชื่อ `doctracking` |
| Framework | Laravel 13 (PHP ^8.3) โครงเดียวกับ skillmatrix: ไฟล์หน้าเว็บที่ราก + `core/`, `config.local.php` แทน `.env`, `install.php`, แนบ `vendor/` |
| หน้าเว็บ | Blade (server-render) + JavaScript ล้วนใน `js/` ไม่มีขั้น build บนเซิร์ฟเวอร์ ใช้ CSS เดิม (`globals.css` + `ui-kit/ui-kit.css`) ตาม DESIGN.md |
| ตัดออก | ระบบแมสเซ็นเจอร์ · ระบบเงินสด (cashier, finance, cash master) · ส่งข้อมูลเข้า Google Sheets / Apps Script |
| ตัดออกเพราะไม่จำเป็นบนเครื่องเรา | Cloudflare Worker, คิวรับเอกสารแบบ pg_cron 5 วินาที, KV, Supabase Auth/Storage/Edge Function, แอป desktop ทั้ง 2 ตัว, PWA |
| ผู้ใช้ | ทุกคนอยู่ใน LAN ไม่ต้องมี VPN/HTTPS |
| ผู้ใช้ | login ด้วย **อีเมล + รหัสผ่าน** อย่างเดียว · **แอดมินเป็นคนตั้งรหัสผ่าน** (ไม่มีสมัครเอง/ลืมรหัส/ส่งอีเมลรีเซ็ต) · ย้ายบัญชี สิทธิ์ และแฮชรหัสผ่านเดิมมาครบ ผู้ใช้ใช้บัญชีและรหัสเดิมได้ทันที |
| การสลับระบบ | ไม่หยุดงาน: ระบบเดิมทำงานต่อจนระบบใหม่พร้อม แล้วสลับนอกเวลางานด้วยการดึงข้อมูลรอบสุดท้าย (ข้อ 13) |
| ข้อมูลต้นทาง | ดึงจาก Supabase แล้ว 28 พ.ย. 2026 (ข้อ 11) ดึงซ้ำได้ด้วย `scripts/export-supabase-snapshot.mjs` |
| ID | คง UUID เดิม (`CHAR(36)`) เพื่อให้ข้อมูลที่นำเข้าอ้างถึงกันได้ครบ ไม่ต้องแปลงคีย์ |
| เวลา | แอปและฐานข้อมูลใช้ `Asia/Bangkok` เก็บเป็น `DATETIME(6)` (ละเอียดถึงไมโครวินาทีเท่าของเดิม) · connection MySQL ตั้ง `time_zone = '+07:00'` (ไทยไม่มี DST และใช้ใน LAN อย่างเดียว) |

---

## 1. ขอบเขต

### ย้ายไป (ทำงานเหมือนเดิม)

- ลงทะเบียนเอกสารเข้า: หลายหน่วยงานผู้รับ, เลขเอกสารรายเดือน `YYYY-MM/NNN` (เกิน 999 ได้), เลขใบกำกับภาษี, ธงเสียหาย + รูป
- คิวส่งเอกสาร (`/delivery`) ผู้ส่งลงชื่อส่งมอบ, ลากเรียงลำดับคิว
- คิวรับเอกสาร (`/recipient`) รับทีละรายการและรับหลายรายการพร้อมกัน, ลากเรียงลำดับ
- ใบรับสินค้า: ลงชื่อตามขั้น ผู้ตรวจ (`0-ADM04` / `0-PDT01`) → จัดซื้อ (`0-BSN10`) → บัญชี (`0-ADM03`) และ reset เมื่อถูกตีกลับ
- ใบเบิก ส่งไป `0-ADM03-1`
- ติดตาม/ค้นหา/ประวัติ (`/tracking`), แอดมินยืนยันการส่ง, ส่งซ้ำเอกสารที่ถูกปฏิเสธ
- แดชบอร์ด, รายงาน CSV, หน้าคู่มือ (`/policies`)
- จัดการผู้ใช้, หน่วยงาน, รีเซ็ตรหัสผ่าน + `admin_action_log`
- แจ้งเตือนในระบบรายหน่วยงาน (ดึงทุก 60 วินาที)
- อีเมลแจ้งเอกสารค้างเกินกำหนดทุกวัน 08:00

### ตัดออก

| ส่วน | สิ่งที่ไม่ย้าย |
|---|---|
| แมสเซ็นเจอร์ + เงินสด | หน้า `/messenger/*` `/cashier` `/finance/*` `/admin/cash-master`, API `messenger/*` `cashier/*` `admin/cash-master`, lib `permissions.ts` `capabilities.ts` `cash-settings.ts` `money.ts` `messenger-*.ts` `field-capture.ts`, ตาราง branches, approved_banks, bank_branches, messenger_*, cash_*, bank_deposits, view `bank_deposit_summary` |
| Google Sheets | `google-sheets*.ts`, `/api/setup-sheets`, `/api/admin/backfill-sheets`, `apps-script/`, trigger enqueue บนตารางเอกสาร, `maintenance_locks`, schema `apps_script_sheet_private` |
| ของที่ปิดอยู่แล้ว | `/api/setup`, `/api/setup-admin`, `/api/upload` (ไม่มีหน้าไหนเรียก) |
| ข้อมูลเก่าที่ไม่ใช้งาน | `document_workflow_archive` (snapshot ตอน migration 017/019) — เก็บไว้ในไฟล์สำรอง Supabase ไม่นำเข้า |

### จุดที่ผูกกับส่วนที่ตัด ต้องแก้ตอนย้าย

- `/api/profile` คืน `capabilities` ของเงินสด → ตัดทิ้ง เมนูใน `nav-items.ts` ที่ใช้ `isMessenger` / `isCashier` / `canViewCash` ไม่ต้องทำ
- `app_settings` มีคีย์ `cash_*` และ `messenger_dept_codes` → ไม่นำเข้า เหลือ `overdue_alert_hours`, `overdue_alert_cc`
- หน่วยงาน `MSG` → นำเข้าไปก่อน ให้แอดมินลบเองถ้าไม่มีผู้ใช้/เอกสารอ้างถึง
- `username` และอีเมลปลอม `<username>@msg.hillkoff.local` มาจากแมสเซ็นเจอร์ → **ตัด** (login ด้วยอีเมลอย่างเดียว) ผู้ใช้ 3 คนที่มี username มีอีเมลจริงอยู่แล้ว จึงไม่มีใครเสียบัญชี · บัญชีทดสอบ `qa…@msg.hillkoff.local` 3 บัญชี (ไม่มีโปรไฟล์) ไม่นำเข้า
- trigger กันลบ super_admin คนสุดท้าย และ `forbid_mutation()` ของ `admin_action_log` อยู่ใน migration ของเงินสด → **เก็บกฎไว้** (ย้ายไปเป็นโค้ด Laravel ข้อ 5)

---

## 2. ภาพรวมบน dev01

```
ผู้ใช้ใน LAN (เบราว์เซอร์ / แอป Android แบบ WebView)
        │ HTTP
        ▼
Apache + mod_php ── /var/www/html/doctracking/
        │              index.php → Laravel (core/)
        │              css/ js/ img/
        ▼
MySQL 8.4 (127.0.0.1) ── ฐาน doctracking
        ▲
cron ── schedule:run ทุกนาที (อีเมลค้าง 08:00, ล้างแจ้งเตือนเก่า)
     └─ mysqldump ทุกคืน 02:00 (ตาม DEPLOY-PATTERN ข้อ 4.8)

ขาออกอินเทอร์เน็ต (ถ้าเครื่องออกได้): SMTP สำหรับอีเมลแจ้งเอกสารค้างเท่านั้น
```

ทุกอย่างที่เคยแยกไปอยู่บน Cloudflare Worker, Supabase Edge Function และ pg_cron รวมเป็นแอป Laravel ตัวเดียว
เหตุผลที่ Worker/คิวเคยต้องมี คือเพดาน CPU 10ms ของ Cloudflare แผนฟรี (ดู `incident-503-2026-11-10.md`) ซึ่งไม่มีบน dev01

---

## 3. โครงโปรเจกต์

repo ใหม่ `C:\Users\Office14\Documents\doctracking-php` (แยกจาก repo Next.js เพื่อให้ระบบเดิมยังแก้/rollback ได้ระหว่างย้าย)

```
doctracking-php/
├── .htaccess  index.php  install.php      คัดลอกจาก skillmatrix แล้วแก้ชื่อ/ตาราง
├── css/   app.css (รวม globals.css + ui-kit.css)
├── js/    app.js  register.js  queue.js (คิวส่ง/รับ + ลากเรียง)  tracking.js  admin.js
├── img/   icon, manifest.json
├── core/
│   ├── v2-env.php  artisan                 จาก skillmatrix
│   ├── app/
│   │   ├── Http/Controllers/  Auth, Dashboard, Document, Delivery, Recipient,
│   │   │                      GoodsReceipt, Tracking, Report, Notification,
│   │   │                      Admin/User, Admin/Department, Admin/Setting
│   │   ├── Http/Middleware/   role:super_admin,admin
│   │   ├── Models/            Department, User(profiles), Document, DocumentRecipient,
│   │   │                      DeliveryLog, ApprovalAudit, Notification, AdminActionLog, AppSetting
│   │   ├── Services/          ข้อ 5
│   │   └── Console/Commands/  OverdueDocuments, PruneNotifications
│   ├── config/workflow.php    รหัสหน่วยงานของใบรับสินค้า/ใบเบิก (ที่เดียว)
│   ├── database/migrations/   schema MySQL ข้อ 4
│   ├── resources/views/       Blade ทุกหน้า
│   ├── routes/web.php  routes/console.php
│   ├── storage/app/uploads/   รูปเอกสารเสียหาย
│   └── tests/Feature/
└── work/                       เอกสาร (ไม่อัปขึ้นเครื่อง)
```

ใช้ซ้ำจาก skillmatrix: `index.php`, `.htaccess`, `core/.htaccess`, `v2-env.php`, `install.php` (ตรวจเครื่อง → ตั้ง DB → นำเข้า `.sql.gz` → สร้างแอดมิน → เขียน `config.local.php` → lock), หน้า login + CAPTCHA + throttle (`AuthController`, `->block(120, 10)`), middleware `role:`

`config/workflow.php` รวมรหัสหน่วยงานที่ตอนนี้เขียนซ้ำทั้งใน `document-workflow.ts` และใน SQL 4 ฟังก์ชัน ให้เหลือที่เดียว

---

## 4. ฐานข้อมูล MySQL

`utf8mb4_unicode_ci` · InnoDB · `CHAR(36)` สำหรับ UUID · `DATETIME` เวลาไทย

| ตาราง | หมายเหตุการแปลง |
|---|---|
| `departments` | id, name, code UNIQUE |
| `users` (เดิม `profiles` + `auth.users`) | id, email UNIQUE (collation ci), `password` (แฮชจาก `auth.users.encrypted_password`), full_name, role ENUM('super_admin','admin','user'), department_id, is_active, password_changed_at, password_changed_by, remember_token · ไม่มี `username` |
| `documents` | id, `running_no` (INT `AUTO_INCREMENT` + UNIQUE แทน SERIAL นำเข้าค่าเดิม แล้ว InnoDB ต่อจากค่าสูงสุดเอง), display_no UNIQUE, received_date, doc_number, tax_invoice_no, sender, subject, recipient_dept_id, note, is_damaged, damage_image_url, recorded_by, คอลัมน์ legacy (`status`, ลายเซ็นเก่า) เก็บแบบ NULL ได้ เพื่อไม่ทิ้งประวัติ |
| `document_recipients` | status ENUM 8 ค่าเดิม, ลายเซ็นผู้ส่ง/ผู้ตรวจ/จัดซื้อ, `queue_rank BIGINT` (ข้อ `queue_rank_counter`), `updated_at DATETIME(6)` (ข้อ 5.1), UNIQUE(document_id, department_id) |
| `queue_rank_counter` | 1 แถว `last_rank BIGINT` แทน sequence `document_recipients_queue_rank_seq` · ทั้งการลงทะเบียนและการเรียงคิวแบบ delivery ต้อง `lockForUpdate` แถวนี้แล้วบวกเอง (ถ้าใช้ `MAX+1` สองงานพร้อมกันจะได้อันดับซ้ำ) · ค่าเริ่ม = `MAX(queue_rank)` ของข้อมูลที่นำเข้า |
| `delivery_logs` | ตามเดิม |
| `document_approval_audit` | stage ENUM, action ENUM |
| `document_department_tags` | PK (document_id, department_id) |
| `document_no_counters` | PK period, last_no |
| `document_overdue_alerts` | UNIQUE(document_recipient_id, threshold_hours) |
| `notifications` (เดิม `department_inbox`) | BIGINT auto id, department_id, message `JSON`, created_at · ล้างเกิน 24 ชม. |
| `app_settings` | key/value |
| `admin_action_log` | BIGINT auto id, detail `JSON` · ไม่มีโค้ดส่วนใดแก้หรือลบ (ข้อ 5) |
| `sessions`, `cache`, `jobs` | ตารางมาตรฐาน Laravel (session driver = database) |

ไม่สร้าง: schema `private`, `document_receipt_private` (คิว), `desktop_device_auth`, ตารางเงินสด/แมสเซ็นเจอร์/Sheets

ของ Postgres ที่แปลง:

| Postgres | MySQL / Laravel |
|---|---|
| `uuid[]`, `unnest`, `ANY()` | รับ array ใน PHP แล้วใช้ `whereIn` / insert ทีละแถว |
| jsonb ทั้งหลาย | `JSON` column เฉพาะ notifications และ admin_action_log ที่เหลือทำใน PHP |
| `ON CONFLICT … RETURNING` (เลขเอกสาร) | `SELECT … FOR UPDATE` บน `document_no_counters` แล้ว insert/update |
| advisory lock | row lock (`lockForUpdate`) บนแถวที่เกี่ยวข้อง |
| partial / expression index | ไม่ต้องใช้ (คิวถูกตัด, email ใช้ collation ci) |
| RLS, `auth.uid()`, grants | สิทธิ์อยู่ใน Controller/Policy ทั้งหมด ผู้ใช้ MySQL ของแอปมีตัวเดียว |
| trigger `updated_at` | ตั้งเองในทุก update ที่เปลี่ยนข้อมูล (ข้อ 5.1) — query builder ของ Laravel ไม่เลื่อนให้ |
| sequence | `AUTO_INCREMENT` (running_no) และตาราง `queue_rank_counter` |
| `timestamptz` | แปลงเป็นเวลาไทยตอนนำเข้า |

---

## 5. ตรรกะที่ต้องรักษา (ฟังก์ชัน SQL → Service)

ทุกตัวเป็น `DB::transaction()` + `lockForUpdate()` ตรรกะยกมาจากฟังก์ชันเดิมทีละบรรทัด

| เดิม | ใหม่ | สิ่งที่ต้องได้ |
|---|---|---|
| `register_document` + `next_document_display_no` | `DocumentRegistrar::register()` | จองเลขรายเดือน + insert เอกสาร/ผู้รับ/แท็กในทรานแซกชันเดียว ล้มแล้วเลขไม่ถูกใช้ |
| conditional update ใน `sign` route | `DeliveryService::sign()` | `UPDATE … WHERE status='registered'` ถ้าแถวไม่เปลี่ยน → 409 |
| `sign_goods_receipt_stage` | `GoodsReceiptService::signStage()` | state machine ผู้ตรวจ→จัดซื้อ→บัญชี + audit, แก้ชื่อขั้นก่อนหน้าได้เฉพาะขั้นถัดไป |
| `reset_goods_receipt_stages` | `GoodsReceiptService::reset()` | rejected → awaiting_inspector + audit |
| `receive_document` + `receive_document_worker` | `ReceiveService::receive()` | ล็อกแถว, เทียบสถานะที่คาด, ตรวจหน่วยงาน/กฎ `0-ADM03`, อัปเดต + insert delivery_log พร้อมกัน |
| `enqueue_document_receipts` + `process_document_receipt_queue` | `ReceiveService::receiveMany()` | **ทำทันทีในคำขอเดียว** สูงสุด 50 รายการ แต่ละรายการแยกทรานแซกชัน คืนผลรายตัว (สำเร็จ / `receipt_stale` / ไม่มีสิทธิ์) — ไม่ต้องมีคิวและ cron 5 วินาที |
| `verify_document_delivery` | `DeliveryService::verify()` | ล็อก delivery, ยืนยัน, ปิดผู้รับ |
| `reorder_document_recipients` | `QueueOrderService::reorder()` | ล็อกแถวเรียงตาม id (กัน deadlock), scope delivery ตั้งอันดับใหม่, scope stage สลับช่อง, ไม่แตะ `updated_at` |
| `require_active_super_admin` trigger (advisory lock) | `UserService` | ล็อกด้วย `GET_LOCK('doctracking_super_admin')` (หรือ `lockForUpdate` super_admin ที่ active **ทุกแถว**) ก่อนลด role / ปิด / ลบ ถ้าเหลือคนเดียว → ปฏิเสธ · ล็อกแค่แถวเป้าหมายไม่พอ สองคำขอพร้อมกันจะผ่านทั้งคู่ |
| กฎใน `profiles/[id]/route.ts` | `UserService` | ห้ามลด role หรือปิดบัญชีตัวเอง · admin จัดการได้เฉพาะบัญชี `user` · ลบไม่ได้ถ้ามีเอกสาร/delivery_logs |
| ลบเอกสาร (`documents/[id]` DELETE) | `DocumentService::delete()` | ลบผู้รับ แล้วลบเอกสารที่ไม่เหลือผู้รับ + tags ในทรานแซกชันเดียว |
| `forbid_mutation` | ไม่มี route/โค้ดใดแก้หรือลบ `admin_action_log` | |
| `write_/access_department_notifications` | `NotificationService` | เขียนตามหน่วยงาน, อ่าน 24 ชม. ล่าสุดไม่เกิน 50 |

### 5.1 `updated_at` ต้องเลื่อนเหมือน trigger เดิม

การรับเอกสาร (เดี่ยวและหลายรายการ) ใช้ `expected_updated_at` ตรวจว่าแถวไม่ถูกเปลี่ยนตั้งแต่ผู้ใช้เปิดหน้า (`receipt_stale`) ของเดิม trigger เลื่อน `updated_at` ทุกครั้งที่แถวเปลี่ยน **ยกเว้น** เปลี่ยนแค่ `queue_rank`

- ทุก update ของ `document_recipients` ที่เปลี่ยนสถานะ/ลายเซ็น ต้อง `SET updated_at = NOW(6)` เอง รวมถึง conditional update ใน `sign` — ทำผ่าน method กลางตัวเดียวใน Service เพื่อไม่ให้ลืม
- การเรียงคิวตั้งแค่ `queue_rank` ไม่แตะ `updated_at`
- `expected_updated_at` ส่งเป็น ISO 8601 พร้อมไมโครวินาทีเหมือนเดิม แล้วเทียบแบบตรงตัว

ฝั่ง JS เก็บพฤติกรรม `receipt-submit.ts` ไว้: ถ้าเครือข่ายหลุดตอนกดรับ ให้ดึงสถานะกลับมาตรวจก่อนแจ้งว่าล้ม

ใบรับสินค้ายังแยกด้วยข้อความหัวเรื่อง `'ใบรับสินค้า'` เหมือนเดิม (ไม่เปลี่ยนพฤติกรรมในการย้ายรอบนี้)

---

## 6. Login และสิทธิ์

- Laravel session auth (cookie, session ในตาราง `sessions`) แทน Supabase JWT
- **login ด้วยอีเมล + รหัสผ่านเท่านั้น** + CAPTCHA + throttle แบบ skillmatrix · ตัด `/api/auth/resolve-username`
- **ไม่มี** หน้าสมัคร, ลืมรหัสผ่าน, ส่งลิงก์รีเซ็ตทางอีเมล, หรือผู้ใช้เปลี่ยนรหัสเอง
- **แอดมินตั้งรหัสผ่าน** ในหน้า `/admin/users` ตอนสร้างบัญชีและตอนรีเซ็ต:
  - `super_admin` ตั้งได้ทุกบัญชี · `admin` ตั้งได้เฉพาะบัญชี role `user` (ตรงกับขอบเขตที่ admin จัดการผู้ใช้ได้อยู่แล้ว)
  - ทุกครั้งที่ตั้ง บันทึก `admin_action_log` (ใคร ตั้งให้ใคร เมื่อไร ไม่เก็บรหัส) และเตะ session เดิมของบัญชีนั้นออก
  - รหัสอย่างน้อย 8 ตัว · แสดงรหัสให้แอดมินเห็นครั้งเดียวตอนตั้ง แล้วแจ้งผู้ใช้แบบส่วนตัว (ไม่ส่งในกลุ่ม)
  - ไม่บังคับผู้ใช้เปลี่ยนรหัสเอง และไม่มีหน้าให้ผู้ใช้เปลี่ยนรหัส (ตัดสินใจแล้ว) แอดมินรู้รหัสของผู้ใช้ได้ — ยอมรับว่าลายเซ็นในใบรับสินค้าพิสูจน์ตัวคนเซ็นไม่ได้เต็มที่ `admin_action_log` จึงเป็นหลักฐานว่าใครตั้งรหัสให้ใครเมื่อไร
- บัญชีที่ `is_active = 0` login ไม่ได้ และเมื่อแอดมินปิดบัญชี ระบบลบ session ที่ค้างของบัญชีนั้นทันที
- **บัญชีเดิมใช้ได้ทันที:** ตรวจแล้วทั้ง 11 บัญชีมีแฮช bcrypt `$2a$` ยาว 60 ตัว · ตอนนำเข้าแปลงหัวเป็น `$2y$` (อัลกอริทึมเดียวกัน) → `Hash::check` ของ Laravel ผ่าน ผู้ใช้ไม่ต้องตั้งรหัสใหม่
- **สิทธิ์เหมือนเดิมทุกคน:** นำเข้า role, หน่วยงาน, is_active ตรงจาก `profiles` · กฎตามรหัสหน่วยงาน (ใบรับสินค้า/ใบเบิก) อยู่ใน `config/workflow.php`
- Role เดิม 3 ระดับ: `super_admin`, `admin`, `user`
- **ต่างจากเดิม:** หน้า admin กันด้วย middleware `role:` ฝั่งเซิร์ฟเวอร์ด้วย (ตอนนี้กันแค่ซ่อนเมนู + ตรวจใน API)
- ทุก POST/PUT/DELETE มี CSRF token ของ Laravel
- ตัด: device login ของแอป desktop (`/desktop/connect`, edge function)

---

## 7. หน้าและ route

| หน้า (เดิม) | Route ใหม่ | หมายเหตุ |
|---|---|---|
| `/` login | `GET/POST /login` | |
| `/dashboard` | `GET /` | |
| `/register` | `GET/POST /register` | อัปโหลดรูปไปพร้อมฟอร์ม (multipart) |
| `/delivery` | `GET /delivery` + `PUT /api/documents/{id}/sign` + `PUT /api/documents/order` | |
| `/recipient`, `/recipient/{id}` | `GET /recipient[/{id}]` + `POST /api/deliveries` + `POST /api/deliveries/bulk` + goods-receipt sign | หน้าใหญ่สุด (เดิม 1,110 บรรทัด) |
| `/tracking` | `GET /tracking` + verify + redeliver + แก้/ลบ (admin) | |
| `/reports` | `GET /reports/export.csv` | สร้าง CSV (มี BOM) ฝั่งเซิร์ฟเวอร์ |
| `/policies` | `GET /policies` | |
| `/admin/users` | `/admin/users` | admin+ · สร้างบัญชีพร้อมตั้งรหัส, รีเซ็ตรหัส (ข้อ 6) |
| `/admin/departments` | `/admin/departments` | super_admin |
| — | `/admin/settings` | ตั้ง `overdue_alert_hours`, `overdue_alert_cc` (เดิมแก้ใน DB ตรง) |

`/api/*` ใต้ Laravel เป็น JSON endpoint สำหรับ `js/` ใช้ session เดียวกับหน้าเว็บ คงรูปแบบ request/response เดิมไว้มากที่สุด เพื่อยกตรรกะ JS ฝั่งหน้าเว็บมาได้เร็ว

---

## 8. รูปภาพ

- รูปใหม่เก็บที่ `core/storage/app/uploads/damage/YYYY/MM/<uuid>.<ext>` เปิดดูผ่าน `GET /files/{id}` ที่ตรวจสิทธิ์เหมือนการเปิดเอกสารนั้น (admin ทุกฉบับ, user เฉพาะหน่วยงานผู้รับ/ผู้บันทึก) ไม่ใช่แค่ login
- mysqldump ไม่รวมไฟล์รูป → เพิ่ม cron สำรอง `tar` โฟลเดอร์ `uploads/` ทุกคืนไว้ข้างไฟล์ `.sql.gz` ใน `/var/backups/doctracking`
- ตรวจไฟล์เหมือน `image-validation.ts`: ≤ 12 MB, JPEG/PNG/WebP/HEIC/HEIF, เทียบ magic bytes, ตั้งชื่อไฟล์เอง
- PHP ค่าเริ่มต้นรับไฟล์ได้ 2 MB → ใส่ใน `.htaccess` ที่ราก (mod_php อ่านได้): `php_value upload_max_filesize 13M` และ `php_value post_max_size 16M`
- ข้อมูลจริงยังไม่มีเอกสารใดแนบรูป (`damage_image_url` ว่างทั้ง 3,399 แถว) → ไม่ต้องย้ายรูปจาก Google Drive และตัดการเชื่อม Google ออกทั้งหมด

---

## 9. งานตามเวลา

cron `* * * * * www-data php /var/www/html/doctracking/core/artisan schedule:run` (ตาม DEPLOY-PATTERN ข้อ 4.8) แล้วตั้งใน `routes/console.php`:

| งาน | เวลา | แทนของเดิม |
|---|---|---|
| `docs:overdue` ส่งอีเมลเอกสารค้างเกิน `overdue_alert_hours` (ค่าเริ่ม 24) ถึงผู้ลงทะเบียน + CC กันส่งซ้ำด้วย `document_overdue_alerts` | 08:00 ทุกวัน | Cloudflare cron + `/api/cron/overdue-documents` |
| `notifications:prune` ลบเกิน 24 ชม. | 18:30 ทุกวัน | pg_cron |
| `activity-log` / session ที่หมดอายุ | 03:00 | pg_cron log retention |

ช่องทางส่งอีเมล: Laravel Mail ผ่าน SMTP (ค่าใน `config.local.php`)

**ช่วงแรกปิดส่งไว้ก่อน** (ตัดสินใจแล้ว): ทำงาน `docs:overdue` ครบทุกส่วน แต่มีสวิตช์ `overdue_email_enabled` ใน `/admin/settings` ค่าเริ่มต้น = ปิด
- ปิดอยู่: งานยังรันทุกวันและบันทึกลง log ว่า "จะส่งถึงใคร กี่ฉบับ" แต่ไม่ส่งจริง และ **ไม่** เขียน `document_overdue_alerts` (กันไม่ให้เปิดทีหลังแล้วข้ามฉบับที่ควรส่ง)
- หน้า settings มีปุ่ม "ส่งอีเมลทดสอบ" ไว้ลอง SMTP ก่อนเปิดจริง
- เปิดได้เมื่อตั้งค่า SMTP ใน `config.local.php` และทดสอบผ่าน ไม่ต้องแก้โค้ด

---

## 10. แอปและอุปกรณ์

| ตัว | หลังย้าย |
|---|---|
| เบราว์เซอร์ (Chrome/Edge) | ใช้ได้ทันทีใน LAN |
| PWA / "ติดตั้งแอปผ่าน Edge" | **ใช้ไม่ได้บน HTTP** (service worker ต้องเป็น HTTPS) → แทนด้วย shortcut บนเดสก์ท็อป/หน้าจอมือถือ (ตัดสินใจแล้ว: รับได้) · ไม่ต้องทำ `manifest.json`/`sw.js` ในระบบใหม่ |
| แอป Android (Capacitor WebView) | เปลี่ยน `server.url` เป็น `http://192.168.20.188/doctracking/` แล้ว build ใหม่ (`cleartext: true` มีอยู่แล้ว) ใช้ได้เฉพาะตอนต่อ Wi-Fi บริษัท |
| desktop "receipt" + "full" (Electron) | ผูกกับ Supabase ทั้งคู่ → **เลิกใช้** (ตัดสินใจแล้ว) ให้ใช้เบราว์เซอร์ (หน้ารับเอกสารมีรับหลายรายการอยู่แล้ว) · แจ้งผู้ใช้ถอนการติดตั้งหลังวันสลับ |

---

## 11. ย้ายข้อมูล

### 11.1 ดึงข้อมูลจาก Supabase (ทำแล้ว 28 พ.ย. 2026 11:21 น.)

สคริปต์ `scripts/export-supabase-snapshot.mjs` (repo นี้) ต่อ Postgres ของ Supabase ตรง แล้วอ่านทุกตารางใน **ทรานแซกชันอ่านอย่างเดียว snapshot เดียว** ระบบเดิมจึงทำงานต่อได้ระหว่างดึง และทุกไฟล์ตรงกัน ณ เวลาเดียว

```bash
NODE_EXTRA_CA_CERTS="C:/Users/Office14/Documents/Backup/doctracking-export/supabase-prod-ca-2021.crt" \
  node --env-file=.env.local scripts/export-supabase-snapshot.mjs
```

ผลลัพธ์: `C:\Users\Office14\Documents\Backup\doctracking-export\<YYYYMMDD-HHMMSS>\` — `<ตาราง>.json` ทุกตารางใน `public` + `auth_users.json` + `manifest.json` (จำนวนแถว, sha256, เวลา snapshot) · ไฟล์มีแฮชรหัสผ่านและข้อมูลส่วนบุคคล สคริปต์ปฏิเสธถ้าปลายทางอยู่ใน repo

ชุดแรก `20261128-042114` (7.7 MB):

| ตาราง | แถว | นำเข้า |
|---|---|---|
| documents | 3,399 | ✓ |
| document_recipients | 3,400 | ✓ (closed 3,057 · delivered 178 · registered 76 · awaiting_purchasing 62 · awaiting_recipient 23 · rejected 3 · awaiting_inspector 1) |
| delivery_logs | 3,060 | ✓ |
| document_department_tags | 2,687 | ✓ |
| document_approval_audit | 1,803 | ✓ |
| departments | 22 | ✓ |
| profiles / auth_users | 11 / 14 | ✓ 11 คน (ข้าม qa ทดสอบ 3) |
| document_no_counters | 5 | ✓ |
| app_settings | 6 | ✓ เฉพาะ `overdue_alert_hours`, `overdue_alert_cc` |
| admin_action_log | 2 | ✓ |
| document_overdue_alerts | 0 | ✓ |
| document_workflow_archive | 122 | เก็บเป็นสำเนา ไม่นำเข้า |
| ตารางเงินสด/แมสเซ็นเจอร์ทั้งหมด | 0 (มีแค่ branches 10, approved_banks 5) | ไม่นำเข้า |

### 11.2 นำเข้า dev01

คำสั่ง Laravel `docs:import-snapshot <โฟลเดอร์>` อ่านไฟล์ JSON ชุดนี้โดยตรง (ไม่ต้องแปลงเป็น `.sql` ก่อน) และ **รันซ้ำได้** — ใช้ทั้งตอนติดตั้งครั้งแรกและตอนดึงรอบสุดท้ายวันสลับ

- ทำในทรานแซกชันเดียว: ปิด FK check ชั่วคราว → `upsert` ตาม id ทุกตาราง → ลบแถวที่ไม่มีใน snapshot แล้ว (เอกสารที่ถูกลบในระบบเดิม และข้อมูลทดลองบน dev01) → เปิด FK check · การเปิด `FOREIGN_KEY_CHECKS=1` กลับ **ไม่ตรวจแถวที่ใส่ไปแล้ว** จึงต้องรัน query `LEFT JOIN … WHERE parent.id IS NULL` ทุก FK เอง ถ้าเจอแถวกำพร้า → rollback ทั้งชุด
- แปลง: timestamptz → เวลาไทย, boolean → 0/1, jsonb → JSON, `$2a$` → `$2y$`, `profiles ⋈ auth_users` → `users`
- `queue_rank`, `running_no`, `document_no_counters` นำเข้าค่าเดิมตรง ๆ → ลำดับคิวและเลขเอกสารถัดไปต่อจากระบบเดิมพอดี
- ไม่แตะตารางที่มีแต่ในระบบใหม่ (`sessions`, `notifications`)
- `queue_rank_counter` ตั้งเป็น `MAX(queue_rank)` หลังนำเข้า
- `install.php` เรียกคำสั่งเดียวกันเมื่อวางชุดข้อมูลไว้ที่ `core/storage/app/import/` และ **ข้ามขั้น "สร้างแอดมิน"** เมื่อนำเข้า (แอดมินมาจากข้อมูลเดิม ถ้าสร้างใหม่จะถูกลบทิ้งตอนลบแถวที่ไม่มีใน snapshot)
- ชุดที่อยู่ใต้ `core/storage/app/import/` ถูกลบอัตโนมัติทันทีที่นำเข้าสำเร็จ (DEPLOY-PATTERN หลักการข้อ 6) — ถ้าจะรัน `docs:verify-import` ต่อ ให้อัปชุดไว้ **นอก** `import/` แต่ยังอยู่ใต้ `core/` ที่เว็บเข้าไม่ได้ เช่น `core/storage/app/snapshot-<stamp>/` (www-data อ่านได้ แต่ `/home/dev01` อ่านไม่ได้) แล้ว `sudo rm -rf` เองหลังตรวจ

### 11.4 การดูแลไฟล์ export (PDPA)

ไฟล์ใน `Documents\Backup\doctracking-export\` มีชื่อ อีเมล และแฮชรหัสผ่านของพนักงาน

- ต้องไม่ sync ขึ้น OneDrive/Google Drive — ตรวจว่าโฟลเดอร์ `Documents` ของเครื่องนี้ไม่อยู่ใน OneDrive Backup ถ้าอยู่ ให้ย้ายชุด export ไปโฟลเดอร์นอก OneDrive
- จำกัดสิทธิ์ NTFS ให้เฉพาะบัญชีผู้ดูแล (`icacls … /inheritance:r /grant:r <ผู้ดูแล>:F`)
- สำเนาที่เก็บนอกเครื่องต้องเข้ารหัส (เช่น 7-Zip AES-256)
- ลบชุด export ทั้งหมด **เมื่อพ้นช่วง rollback 30 วัน** เหลือแค่ชุดสุดท้ายที่เข้ารหัสเก็บเป็นหลักฐาน
- เมื่อปิด Supabase แล้ว ลบ/หมุนรหัสใน `.env.local` (`POSTGRES_*`, `SUPABASE_*`)

### 11.3 ตรวจหลังนำเข้า

`docs:verify-import <โฟลเดอร์>` เทียบกับ `manifest.json`:
- จำนวนแถวทุกตารางที่นำเข้าตรงกัน
- จำนวน document_recipients แยกตามสถานะตรงกัน
- `last_no` ของเดือนปัจจุบันตรงกัน และเลขถัดไปที่จะออก = `last_no + 1`
- ผู้ใช้ทุกคน: role, หน่วยงาน, is_active ตรงกับ `profiles` และแฮชรูปแบบ `$2y$` ยาว 60
- ทดลอง login จริงด้วยบัญชีของผู้ดูแล 1 บัญชี

---

## 12. ทดสอบ

- PHPUnit feature tests บน MySQL ในเครื่อง (ไม่ใช้ SQLite เพราะต้องทดสอบ row lock และ ENUM จริง)
- ชุดที่ต้องมีก่อนขึ้นจริง:
  - ลงทะเบียนพร้อมกัน 2 คำขอ → เลขไม่ซ้ำ, เลขต่อเนื่องข้ามเดือน, เกิน 999
  - ลงชื่อส่งซ้ำ/พร้อมกัน → ครั้งที่ 2 ได้ 409
  - รับพร้อมกัน, รับเอกสารที่สถานะเปลี่ยนแล้ว (`receipt_stale`), รับหลายรายการที่มีบางตัวล้ม
  - ใบรับสินค้าครบ 3 ขั้น, ตีกลับ, reset, กฎ `0-ADM03`
  - เรียงคิวแล้ว `updated_at` ไม่เปลี่ยน · ลงชื่อส่ง/ตรวจขั้นใบรับสินค้าแล้ว `updated_at` เปลี่ยน → การรับด้วย `expected_updated_at` เดิมได้ `receipt_stale`
  - ลงทะเบียนพร้อมกับเรียงคิว → `queue_rank` ไม่ซ้ำ
  - ลบ/ลด role super_admin คนสุดท้ายไม่ได้ แม้ส่ง 2 คำขอพร้อมกัน · ลด role/ปิดบัญชีตัวเองไม่ได้
  - บัญชีที่ปิดแล้ว login ไม่ได้ และ session ที่ค้างใช้ต่อไม่ได้
  - user เปิด `/files/{id}` ของหน่วยงานอื่นไม่ได้
  - นำเข้า snapshot ซ้ำ 2 ครั้งได้ผลเท่ากัน และไม่มีแถวกำพร้า
  - user เห็นเฉพาะเอกสารหน่วยงานตัวเอง, user เข้า `/admin/*` ไม่ได้
- ตรวจความปลอดภัยหลังติดตั้งด้วยชุด curl ของ DEPLOY-PATTERN ข้อ 5 (เพิ่ม `files/…` ต้องได้ 302/401 เมื่อไม่ login)

---

## 13. สลับระบบโดยไม่หยุดงาน และ rollback

**ความหมายของ "ไม่หยุดงาน" ในแบบนี้:** ระบบเดิมบน Cloudflare/Supabase ใช้งานตามปกติตลอด จนระบบใหม่พร้อมและตรวจผ่าน ช่วงที่ต้องงดบันทึกมีราว 15 นาทีตอนดึงข้อมูลรอบสุดท้าย และจัดให้ตกในช่วงที่ไม่มีคนทำงาน (ข้อมูล 7.7 MB ดึงเสร็จในไม่กี่วินาที)

**เลือกเวลาจากข้อมูลจริง** (`documents.created_at` + `delivery_logs` ทั้งหมด เวลาไทย):

| ช่วง | จำนวนรายการ |
|---|---|
| จ–ศ 08:00–17:00 | 4,632 |
| จ–ศ หลัง 17:00 (มีถึงราว 18:59) | 439 (ศุกร์หลัง 17:00 = 22) |
| **เสาร์** | **1,300** — มีคนทำงานจริง ห้ามสลับวันเสาร์ |
| อาทิตย์ | 88 |

→ **สลับเช้าวันอาทิตย์** (เช่น 07:00) และแจ้งผู้ที่อาจทำงานวันอาทิตย์ล่วงหน้า

### ก่อนวันสลับ (ระบบเดิมยังเป็นตัวจริง)

1. ติดตั้ง dev01 ตาม DEPLOY-PATTERN + นำเข้าชุด snapshot ล่าสุด (ข้อ 11)
2. **ทดลองคู่ขนาน 1 สัปดาห์** บน dev01 — ผู้ใช้หลัก (ธุรการ, บัญชี, จัดซื้อ, ผู้ตรวจรับ) ลองทุกขั้นด้วยบัญชีและรหัสเดิมของตัวเอง ข้อมูลที่ลองถือเป็นข้อมูลทดสอบ จะถูกล้างด้วยการนำเข้ารอบสุดท้าย
3. ซ้อมสลับ 1 ครั้ง: ดึง snapshot ใหม่ → อัปไว้นอก `import/` → `docs:import-snapshot` → `docs:verify-import` จับเวลาทั้งหมด แล้วลบชุดนั้นทิ้ง
4. เตรียมล่วงหน้า:
   - Worker หน้าแจ้งย้าย ใช้ชื่อเดิม `doc-tracking-system` และ route/โดเมนเดิมใน `wrangler.jsonc` (deploy ทับตัวจริง) ยังไม่ deploy
   - edge function `desktop-api` และ `desktop-device-auth` รุ่นที่ตอบ `410 Gone` ทุกคำขอ ยังไม่ deploy
   - แอป Android ตัวใหม่ (ชี้ dev01), shortcut บนเครื่องผู้ใช้
   - แจ้งผู้ใช้วันเวลาสลับ

### วันสลับ (เช้าวันอาทิตย์)

| เวลา | ขั้น |
|---|---|
| T+0 | แจ้งในกลุ่มงาน "งดบันทึกเอกสาร 15 นาที" |
| T+1 | ปิดทางเขียนเข้าระบบเดิม **ทุกทาง**: |
| | ① deploy หน้าแจ้งย้ายทับ Worker `doc-tracking-system` (เว็บ, Android, PWA ที่ผ่าน Cloudflare) |
| | ② deploy edge function `desktop-api` และ `desktop-device-auth` รุ่นตอบ 410 — PWA ที่ติดตั้งผ่าน Edge มี service worker เก็บหน้าไว้ในเครื่องและยิงเข้า `/functions/v1/desktop-api` ตรง ไม่ผ่านหน้าแจ้งย้าย (สั่ง `REVOKE` กับ edge function ไม่ได้) |
| | ③ `REVOKE EXECUTE` ฟังก์ชัน `enqueue_desktop_receipts` จาก `authenticated` (แอป desktop "receipt" เรียกผ่าน PostgREST ตรง) |
| | ④ ปิด Worker `doc-tracking-cron` (ไม่ให้ส่งอีเมลค้างซ้ำจากระบบเดิม) |
| T+2 | รอคิว `document_receipt_private.jobs` ไม่มีสถานะ `queued` แล้วนับแถว `documents`, `document_recipients`, `delivery_logs`, `document_approval_audit` **2 ครั้งห่างกัน 1 นาที** ต้องเท่ากัน ถ้าไม่เท่า แปลว่ายังมีทางเขียนที่ไม่ได้ปิด → หาให้เจอก่อนไปต่อ |
| T+4 | ดึง snapshot รอบสุดท้าย (`export-supabase-snapshot.mjs`) |
| T+6 | อัปขึ้น dev01 ไว้นอก `import/` → `docs:import-snapshot` (ล้างข้อมูลทดลองแทนด้วยข้อมูลจริง) → `docs:verify-import` → ลบชุดนั้นทิ้ง |
| T+12 | login ทดสอบ 1 บัญชี, เปิดคิวส่ง/รับ, ตรวจเลขเอกสารถัดไป |
| T+15 | แจ้งผู้ใช้ใช้ระบบใหม่ได้ |

ระหว่าง T+1 ถึง T+15 ผู้ใช้ที่เปิดลิงก์เดิมจะเห็นหน้าแจ้งย้ายแทน ไม่มีข้อมูลหาย

### ตรวจตกหล่น

เช้าวันทำงานถัดไป ดึง snapshot จาก Supabase อีกครั้ง แล้วรัน `docs:verify-import --diff` เทียบกับรอบสุดท้าย — ต้องไม่มีแถวใหม่/แก้ไขหลังเวลา snapshot ถ้ามี ให้คีย์เพิ่มบน dev01 แล้วหาว่ารั่วจากทางไหน

### Rollback

ย้อนกลับได้ แต่ต้องทำตามลำดับ (เขียนเป็น checklist และซ้อมไว้ก่อนวันสลับ):

1. ดึงแถวที่เกิดบน dev01 หลังสลับ (`created_at`/`updated_at` > เวลาสลับ) เป็นรายการ เพื่อคีย์กลับ
2. ตั้ง `document_no_counters` บน Supabase ให้ `last_no` ≥ ค่าบน dev01 ของเดือนเดียวกัน — ไม่อย่างนั้นเลขเอกสารที่ออกไปแล้วบน dev01 จะถูกออกซ้ำ
3. `GRANT` ฟังก์ชัน `enqueue_desktop_receipts` คืน, deploy edge function ตัวจริงคืน, deploy Worker ตัวจริง (`npm run deploy`) และ `npm run deploy:cron`
4. คีย์รายการจากข้อ 1 เข้าระบบเดิม

ข้อจำกัด:
- ตัดสินใจ rollback ภายใน 2–3 วันแรก ยิ่งช้า ยิ่งมีรายการต้องคีย์กลับมาก
- ถ้า Supabase เป็นแผนฟรี โปรเจกต์จะถูกพักเมื่อไม่มีการใช้งานราว 1 สัปดาห์ (กู้คืนได้ภายใน 90 วัน แต่ใช้เวลา) → หลังสัปดาห์แรก rollback ไม่ได้ทันที **ยอมรับแล้ว** เพราะเมื่อระบบใหม่เสร็จจะใช้ระบบใหม่ทั้งหมด rollback จึงเป็นแผนสำรองช่วงสัปดาห์แรกเท่านั้น
- ครบ 30 วัน: ดึง snapshot ชุดสุดท้าย เข้ารหัสเก็บนอกเครื่อง แล้วปิด Supabase project และ Worker ทั้งสองตัว จากนั้นทำข้อ 11.4

---

## 14. แผนงาน (ประมาณการ)

| ระยะ | งาน | ประมาณ (วันทำงาน) |
|---|---|---|
| 1 | โครง Laravel จาก skillmatrix, install.php, login/สิทธิ์, migrations MySQL | 3 |
| 2 | ~~สคริปต์ส่งออก~~ (เสร็จแล้ว) · `docs:import-snapshot` + `docs:verify-import` | 2 |
| 3 | ลงทะเบียน, คิวส่ง, คิวรับ (เดี่ยว/หลายรายการ), เรียงคิว | 5 |
| 4 | ใบรับสินค้า 3 ขั้น, ตีกลับ/reset, ใบเบิก | 3 |
| 5 | ติดตาม, แดชบอร์ด, รายงาน CSV, แจ้งเตือน, อีเมลค้าง, หน้า admin | 4 |
| 6 | เทสต์ข้อ 12, ติดตั้ง dev01 ตาม DEPLOY-PATTERN, ทดลองคู่ขนาน | 5 |
| | **รวม** | **~22 วัน** (ยังไม่รวมเวลารอผลทดลองจากผู้ใช้) |

ผู้รับผิดชอบแต่ละระยะและวันสลับ (อาทิตย์) กำหนดเมื่ออนุมัติแบบนี้

---

## 15. ความเสี่ยง

| ความเสี่ยง | ผล | ลด |
|---|---|---|
| ตรรกะใน SQL ฟังก์ชันแปลงพลาด | สถานะเอกสารผิด/เลขซ้ำ | ยกทีละฟังก์ชัน + เทสต์พร้อมกันข้อ 12 + ทดลองคู่ขนาน |
| แฮชรหัสผ่านบางบัญชีใช้ไม่ได้ | ผู้ใช้ login ไม่ได้วันสลับ | ตรวจแล้วทั้ง 11 บัญชีเป็น bcrypt มาตรฐาน · ให้ผู้ใช้ลอง login ช่วงทดลองคู่ขนาน · แอดมินตั้งรหัสใหม่ให้ได้ทันที |
| มีคนบันทึกในระบบเดิมหลังดึงรอบสุดท้าย | ข้อมูลตกหล่น | ปิดทางเขียนครบ 4 ทาง + นับแถวซ้ำ 2 ครั้งก่อนดึง + ตรวจ `--diff` วันถัดไป (ข้อ 13) |
| `updated_at` ไม่เลื่อนเหมือน trigger เดิม | การตรวจ `receipt_stale` ไม่ทำงาน รับเอกสารที่ถูกแก้แล้วได้ | method กลางตั้ง `updated_at` + เทสต์ข้อ 12 (ข้อ 5.1) |
| Supabase แผนฟรีถูกพักหลังไม่ใช้ ~1 สัปดาห์ | rollback ช้า | ยอมรับแล้ว · ทดลองคู่ขนาน + ซ้อมสลับให้มั่นใจก่อน เพื่อไม่ต้องพึ่ง rollback |
| ไฟล์ export รั่ว | ข้อมูลส่วนบุคคล/แฮชรหัสหลุด (PDPA) | ข้อ 11.4 |
| dev01 เครื่องเดียว ไม่มี HA | ระบบล่ม = หยุดรับส่งเอกสาร | สำรอง DB + `uploads/` ทุกคืน + ดึงไปเก็บนอกเครื่อง (DEPLOY-PATTERN ข้อ 4.8) และเก็บ Supabase ไว้ 30 วัน |
| ข้อมูลส่วนบุคคลบนเครื่องใน LAN ผ่าน HTTP | ดักฟังใน LAN ได้ | ยอมรับตามแบบแผน LAN เดิม · พิจารณา HTTPS ภายในภายหลัง |
| Apache `AllowOverride None` | `core/` และ `.env` โหลดได้ | ทำ DEPLOY-PATTERN ข้อ 4.5 ก่อนติดตั้ง + ชุดตรวจข้อ 5 |

---

## 16. เรื่องที่ต้องตัดสินใจก่อนเริ่ม

### ตัดสินใจแล้ว (28 พ.ย. 2026)

| เรื่อง | ผล |
|---|---|
| ผู้ใช้นอก LAN | **ไม่มี** ทุกคนใช้ใน LAN → ไม่ต้องมี VPN/HTTPS |
| แอป desktop ทั้ง 2 ตัว | **เลิกใช้** ให้ใช้เบราว์เซอร์แทน |
| อีเมลแจ้งเอกสารค้าง | **ทำระบบไว้ครบ แต่ปิดส่งไว้ก่อน** dev01 ควรส่งออกได้ เปิดเมื่อพร้อม (ข้อ 9) |
| PWA/ติดตั้งผ่าน Edge ใช้ไม่ได้บน HTTP | **รับได้** ใช้ shortcut แทน |

| บังคับผู้ใช้เปลี่ยนรหัสหลังแอดมินตั้ง | **ไม่บังคับ** แอดมินรู้รหัสผู้ใช้ได้ (ยอมรับว่าลายเซ็นในใบรับสินค้าพิสูจน์ตัวคนเซ็นไม่ได้เต็มที่) |
| แผน Supabase / rollback ช้าหลังสัปดาห์แรก | **ยอมรับ** เมื่อระบบใหม่เสร็จจะใช้ระบบใหม่ทั้งหมด |

ไม่มีเรื่องค้างตัดสินใจ — เริ่มระยะที่ 1 ได้
