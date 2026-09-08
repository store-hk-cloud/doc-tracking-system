import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_user::text $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    CREATE TABLE profiles(id uuid PRIMARY KEY, role text, is_active boolean);
    INSERT INTO profiles VALUES ('00000000-0000-0000-0000-000000000001','user',true);
    ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY profiles_select_own ON profiles FOR SELECT USING (id=auth.uid());
    CREATE POLICY profiles_update_own ON profiles FOR UPDATE USING (id=auth.uid());
    CREATE POLICY profiles_insert_own ON profiles FOR INSERT WITH CHECK (id=auth.uid());
    CREATE TABLE departments(id int, name text);
    INSERT INTO departments VALUES(1,'บัญชี');
    ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
    CREATE POLICY departments_select_all_auth ON departments FOR SELECT USING(auth.role()='authenticated');
    CREATE TABLE app_settings(key text, value text);
    ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
    CREATE POLICY app_settings_service_all ON app_settings FOR ALL USING(true);
    CREATE TABLE document_workflow_archive(id int);
    CREATE TABLE bank_deposits(id int);
    ALTER TABLE bank_deposits ENABLE ROW LEVEL SECURITY;
    CREATE VIEW bank_deposit_summary AS SELECT * FROM bank_deposits;
    CREATE FUNCTION current_role_name() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT role FROM profiles WHERE id=auth.uid() $$;
    CREATE SEQUENCE document_number;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,authenticated,service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon,authenticated,service_role;
    GRANT CREATE ON SCHEMA public TO PUBLIC;
  `);
  const file = readdirSync('supabase/migrations').find((x) => x.endsWith('_database_security_lockdown.sql'));
  const sql = readFileSync(`supabase/migrations/${file}`, 'utf8');
  if (sql.trim()) await db.exec(sql);
  return db;
}

test('a signed-in user cannot promote their own role, change settings or truncate tables', async () => {
  const db = await fixture();
  try {
    await db.exec('SET ROLE authenticated');
    await assert.rejects(db.query("UPDATE profiles SET role='super_admin'"), /permission denied/);
    await assert.rejects(db.query("INSERT INTO app_settings VALUES('cash_approver_dept_codes','attacker')"), /permission denied/);
    await assert.rejects(db.query('TRUNCATE profiles'), /permission denied/);
    await assert.rejects(db.query('SELECT * FROM bank_deposit_summary'), /permission denied/);
    await assert.rejects(db.query('SELECT current_role_name()'), /permission denied/);
  } finally { await db.close(); }
});

test('anonymous callers cannot read archives, exhaust counters or create shadow objects', async () => {
  const db = await fixture();
  try {
    await db.exec('SET ROLE anon');
    await assert.rejects(db.query('SELECT * FROM document_workflow_archive'), /permission denied/);
    await assert.rejects(db.query("SELECT nextval('document_number')"), /permission denied/);
    await assert.rejects(db.query('CREATE TABLE public.shadow(id int)'), /permission denied/);
  } finally { await db.close(); }
});

test('department lookup, own profile reads and trusted server operations continue to work', async () => {
  const db = await fixture();
  try {
    await db.exec('SET ROLE authenticated');
    assert.equal((await db.query('SELECT name FROM departments')).rows[0].name, 'บัญชี');
    assert.equal((await db.query('SELECT role FROM profiles')).rows[0].role, 'user');
    await db.exec('RESET ROLE; SET ROLE service_role');
    await db.query("UPDATE profiles SET role='admin'");
    await db.query("INSERT INTO app_settings VALUES('setting','value')");
    assert.equal((await db.query('SELECT current_role_name() AS role')).rows[0].role, 'admin');
    await db.exec('RESET ROLE');
    const { rows } = await db.query("SELECT reloptions FROM pg_class WHERE oid='bank_deposit_summary'::regclass");
    assert.ok(rows[0].reloptions?.includes('security_invoker=true'));
  } finally { await db.close(); }
});
