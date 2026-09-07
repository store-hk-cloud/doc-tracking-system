import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING or DATABASE_URL.');
  process.exit(1);
}

const sql = readFileSync(
  new URL('../supabase/migrations/022_can_view_cash_from_settings.sql', import.meta.url),
  'utf8'
);
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);

  // ยืนยันว่าตอนนี้อ่านรหัสจาก app_settings และได้รหัสที่มีอยู่จริง
  const { rows } = await client.query(`
    SELECT d.code
    FROM departments d
    WHERE d.code = ANY(cash_setting_codes('cash_viewer_dept_codes', '0-ADM03,0-ADM03-1,0-SDM01'))
    ORDER BY d.code
  `);
  console.log('can_view_cash migration executed successfully.');
  console.log(`  แผนกที่ดูข้อมูลเงินได้: ${rows.map((r) => r.code).join(', ') || '(ไม่พบรหัสที่ตรง)'}`);
  console.log('  (เดิม hardcode FIN/ACC ซึ่งไม่มีอยู่จริง จึงไม่มีแผนกไหนผ่านเลย)');
} catch (error) {
  console.error('Failed to execute can_view_cash migration:', error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
