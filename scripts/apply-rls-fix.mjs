import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, 'fix-rls-recursion.sql'), 'utf8');

// Use Postgres URL from env
const connectionString = process.env.POSTGRES_URL_NON_POOLING;
if (!connectionString) {
  console.error('❌ Set POSTGRES_URL_NON_POOLING in .env.local');
  process.exit(1);
}

async function main() {
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: connectionString.replace('sslmode=require', 'sslmode=disable'),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--') && s.length > 10);

  for (const stmt of statements) {
    const fullSql = stmt + ';';
    console.log(`▶ ${fullSql.substring(0, 100)}...`);
    try {
      await client.query(fullSql);
      console.log('  ✅');
    } catch (err) {
      console.log(`  ⚠️  ${err.message.substring(0, 100)}`);
    }
  }
  
  await client.end();
  console.log('\n🎉 Done! RLS policies updated.');
}

main().catch(err => { console.error(err); process.exit(1); });