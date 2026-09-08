import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('document RLS lockdown can be retried without failing on an existing policy', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
      CREATE TABLE profiles (id uuid, role text);
      CREATE TABLE document_approval_audit (id uuid);
      CREATE TABLE document_department_tags (id uuid);
      CREATE TABLE documents (id uuid);
      CREATE TABLE delivery_logs (id uuid);
      CREATE TABLE document_recipients (id uuid);
    `);
    const sql = readFileSync('supabase/migrations/023_document_module_rls_lockdown.sql', 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    const { rows } = await db.query("SELECT cmd FROM pg_policies WHERE policyname = 'doc_recipients_admin_select'");
    assert.deepEqual(rows, [{ cmd: 'SELECT' }]);
  } finally { await db.close(); }
});
