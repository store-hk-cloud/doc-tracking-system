import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING or DATABASE_URL.');
  process.exit(1);
}

const sql = readFileSync(
  new URL('../supabase/migrations/023_document_module_rls_lockdown.sql', import.meta.url),
  'utf8'
);
const client = new Client({ connectionString, ssl: { rejectUnauthorized: true } });

try {
  await client.connect();
  await client.query(sql);

  const { rows } = await client.query(`
    SELECT c.relname,
           c.relrowsecurity AS rls_on,
           COALESCE((SELECT string_agg(privilege_type, ',' ORDER BY privilege_type)
                     FROM information_schema.role_table_grants g
                     WHERE g.table_name = c.relname AND g.grantee = 'authenticated'
                       AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')), '(none)') AS auth_write
    FROM pg_class c
    WHERE c.relname IN ('documents','document_recipients','document_department_tags','delivery_logs','document_approval_audit')
      AND c.relkind = 'r'
    ORDER BY c.relname
  `);
  console.log('Document module RLS lockdown executed successfully.');
  rows.forEach((r) =>
    console.log(`  ${r.relname.padEnd(26)} RLS=${r.rls_on ? 'on ' : 'off'}  authenticated write: ${r.auth_write}`)
  );
} catch (error) {
  console.error('Failed to execute RLS lockdown migration:', error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
