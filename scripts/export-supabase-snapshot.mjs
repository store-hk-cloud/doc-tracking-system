// ดึงข้อมูลทั้งหมดจาก Supabase ลงเป็นไฟล์ JSON รายตาราง เพื่อนำเข้าระบบ Laravel บน dev01
// ใช้: NODE_EXTRA_CA_CERTS=<supabase-prod-ca-2021.crt> node --env-file=.env.local scripts/export-supabase-snapshot.mjs [โฟลเดอร์ปลายทาง]
// ต้องระบุ CA ของ Supabase เพราะ pooler ใช้ใบรับรองที่ Node ไม่รู้จัก (ไฟล์อยู่ที่ Documents/Backup/doctracking-export/)
// ไฟล์ผลลัพธ์มีแฮชรหัสผ่านและข้อมูลส่วนบุคคล — ห้ามวางไว้ใน repo หรือแชร์
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

const { Client, types } = pg;
// เก็บ date/timestamp เป็นข้อความตามที่ Postgres ส่งมา: Date ของ JS ตัดไมโครวินาที และแปลง DATE ตาม timezone ของเครื่องที่รัน
for (const oid of [1082, 1114, 1184]) types.setTypeParser(oid, (value) => value);

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING or DATABASE_URL.');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const outDir = resolve(process.argv[2] || join(process.env.USERPROFILE || '.', 'Documents', 'Backup', 'doctracking-export', stamp));
if (outDir.startsWith(resolve('.'))) {
  console.error('ปลายทางอยู่ใน repo — เลือกโฟลเดอร์อื่น เพราะไฟล์มีแฮชรหัสผ่าน');
  process.exit(1);
}

// ตารางที่ระบบ Laravel จะนำเข้า ที่เหลือดึงมาเก็บเป็นสำเนา (ระบบเงินสด/แมสเซ็นเจอร์ที่เลิกใช้)
const IMPORT_TABLES = new Set([
  'departments', 'profiles', 'documents', 'document_recipients', 'delivery_logs',
  'document_approval_audit', 'document_department_tags', 'document_no_counters',
  'document_overdue_alerts', 'app_settings', 'admin_action_log',
]);

const url = new URL(connectionString);
url.searchParams.delete('sslmode');
const client = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: true } });
const manifest = { exported_at: new Date().toISOString(), tables: {} };

function save(name, rows) {
  const body = JSON.stringify(rows, null, 1);
  writeFileSync(join(outDir, `${name}.json`), body, 'utf8');
  manifest.tables[name] = {
    rows: rows.length,
    for_import: IMPORT_TABLES.has(name) || name === 'auth_users',
    sha256: createHash('sha256').update(body).digest('hex'),
  };
  console.log(`${name.padEnd(34)} ${String(rows.length).padStart(7)}`);
}

try {
  mkdirSync(outDir, { recursive: true });
  await client.connect();
  // snapshot เดียวทุกตาราง — ระบบยังเขียนอยู่ระหว่างดึง แต่ไฟล์ทุกไฟล์ต้องเป็นเวลาเดียวกัน
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL TIME ZONE 'UTC'");

  const { rows: tables } = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  for (const { tablename } of tables) {
    const { rows } = await client.query(`SELECT * FROM public."${tablename.replace(/"/g, '""')}"`);
    save(tablename, rows);
  }

  const { rows: users } = await client.query(`
    SELECT id, email, encrypted_password, email_confirmed_at, banned_until,
           deleted_at, created_at, updated_at, last_sign_in_at
    FROM auth.users ORDER BY created_at
  `);
  save('auth_users', users);

  const { rows: [{ now }] } = await client.query('SELECT now()');
  manifest.snapshot_at = now;
  await client.query('COMMIT');

  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\nบันทึกที่ ${outDir}`);
} catch (error) {
  console.error('Export failed:', error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
