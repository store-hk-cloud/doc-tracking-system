import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING or DATABASE_URL.');
  process.exit(1);
}

const sql = readFileSync(
  new URL('../supabase/migrations/024_atomic_document_writes.sql', import.meta.url),
  'utf8'
);
const client = new Client({ connectionString, ssl: { rejectUnauthorized: true } });

try {
  await client.connect();
  await client.query(sql);
  const { rows } = await client.query(`
    SELECT p.proname,
           has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated
    FROM pg_proc p
    WHERE p.proname IN ('register_document','sign_goods_receipt_stage')
    ORDER BY p.proname
  `);
  console.log('Atomic document write functions installed.');
  rows.forEach((r) =>
    console.log(`  ${r.proname.padEnd(28)} service_role=${r.service_role}  authenticated=${r.authenticated}`)
  );
} catch (error) {
  console.error('Failed to install atomic document write functions:', error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
