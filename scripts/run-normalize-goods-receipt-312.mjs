import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const rawConnectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!rawConnectionString) throw new Error('Missing POSTGRES_URL_NON_POOLING or DATABASE_URL.');

const url = new URL(rawConnectionString);
url.searchParams.delete('sslmode');
const sql = readFileSync(new URL('../supabase/migrations/019_normalize_goods_receipt_312.sql', import.meta.url), 'utf8');
const client = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  console.log('Goods receipt #312 normalized to static routing successfully.');
} finally {
  await client.end();
}
