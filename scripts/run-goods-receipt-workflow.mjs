import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const rawConnectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!rawConnectionString) {
  throw new Error('Missing POSTGRES_URL_NON_POOLING or DATABASE_URL.');
}

const url = new URL(rawConnectionString);
url.searchParams.delete('sslmode');

const sql = readFileSync(new URL('../supabase/migrations/017_goods_receipt_approval_workflow.sql', import.meta.url), 'utf8');
const client = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  console.log('Goods-receipt approval workflow migration executed successfully.');
} finally {
  await client.end();
}
