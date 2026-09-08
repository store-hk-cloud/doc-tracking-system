import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, '../supabase/migrations/20260908013649_database_security_lockdown.sql'), 'utf8');

// Use Postgres URL from env
const connectionString = process.env.POSTGRES_URL_NON_POOLING;
if (!connectionString) {
  console.error('❌ Set POSTGRES_URL_NON_POOLING in .env.local');
  process.exit(1);
}

async function main() {
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: true },
  });
  try {
    await client.connect();
    await client.query(sql);
    console.log('RLS lockdown completed.');
  } finally {
    await client.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
