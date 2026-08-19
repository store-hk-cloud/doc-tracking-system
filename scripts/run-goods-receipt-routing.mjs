import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const rawConnectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!rawConnectionString) throw new Error('Missing POSTGRES_URL_NON_POOLING or DATABASE_URL.');

const url = new URL(rawConnectionString);
url.searchParams.delete('sslmode');
const sql = readFileSync(new URL('../supabase/migrations/018_goods_receipt_static_routing.sql', import.meta.url), 'utf8');
const client = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  console.log('Goods-receipt static routing migration executed successfully.');
} finally {
  await client.end();
}
