import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

export async function runSchema(connectionString, ClientClass = Client) {
  if (!connectionString) throw new Error('POSTGRES_URL_NON_POOLING or DATABASE_URL is required');
  const client = new ClientClass({ connectionString });
  try {
    await client.connect();
    await client.query('BEGIN');
    try {
      await client.query(readFileSync(new URL('../supabase/migrations/001_initial_schema.sql', import.meta.url), 'utf8'));
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runSchema(process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL);
    console.log('Schema created successfully');
  } catch {
    console.error('Schema initialization failed; check the database connection and migration state.');
    process.exitCode = 1;
  }
}
