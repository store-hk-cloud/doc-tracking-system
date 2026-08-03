import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING or DATABASE_URL.');
  process.exit(1);
}

const sql = readFileSync(new URL('../supabase/migrations/005_add_receipt_signatures.sql', import.meta.url), 'utf8');
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  console.log('Receipt signature columns migration executed successfully.');
} catch (error) {
  console.error('Failed to execute receipt signature columns migration:', error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
