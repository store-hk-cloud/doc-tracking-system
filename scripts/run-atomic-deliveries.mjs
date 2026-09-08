import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING or DATABASE_URL.');
  process.exit(1);
}

const sql = readFileSync(new URL('../supabase/migrations/20260908013605_atomic_delivery_verification.sql', import.meta.url), 'utf8');
const client = new Client({ connectionString });
try {
  await client.connect();
  await client.query(sql);
  const { rows } = await client.query(`
    SELECT p.proname,
      has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('receive_document', 'verify_document_delivery')
    ORDER BY p.proname
  `);
  if (rows.length !== 2 || rows.some((r) => !r.service_role || r.authenticated || r.anon)) {
    throw new Error('Unexpected delivery function permissions');
  }
  console.log('Atomic delivery functions installed and permissions verified.');
} catch (error) {
  console.error('Failed to install atomic delivery functions:', error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
