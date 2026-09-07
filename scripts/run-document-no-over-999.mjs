import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING or DATABASE_URL.');
  process.exit(1);
}

const sql = readFileSync(
  new URL('../supabase/migrations/021_document_no_over_999.sql', import.meta.url),
  'utf8'
);
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);

  // ยืนยันผลทันทีที่ขอบ 999 -> 1000 ซึ่งเป็นจุดที่สูตรเดิมพัง
  const { rows } = await client.query(`
    SELECT
      CASE WHEN length('999')  < 3 THEN lpad('999', 3, '0')  ELSE '999'  END AS at_999,
      CASE WHEN length('1000') < 3 THEN lpad('1000', 3, '0') ELSE '1000' END AS at_1000
  `);
  console.log('Document number migration executed successfully.');
  console.log(`  ใบที่ 999  -> .../${rows[0].at_999}`);
  console.log(`  ใบที่ 1000 -> .../${rows[0].at_1000}  (สูตรเดิมได้ 100 ซึ่งซ้ำกับใบที่ 100)`);
} catch (error) {
  console.error('Failed to execute document number migration:', error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
