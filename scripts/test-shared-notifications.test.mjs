import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('web and desktop share a private department inbox and disabled accounts cannot access it', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  const department = '10000000-0000-4000-8000-000000000001';
  const other = '10000000-0000-4000-8000-000000000002';
  const actor = '10000000-0000-4000-8000-000000000003';
  const disabled = '10000000-0000-4000-8000-000000000004';
  const message = { title: 'ส่งมอบเอกสาร', body: 'ใบรับสินค้า', docId: 'doc', runningNo: 1 };
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.departments(id uuid PRIMARY KEY);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, department_id uuid, is_active boolean);
    INSERT INTO public.departments VALUES ('${department}'), ('${other}');
    INSERT INTO public.profiles VALUES ('${actor}', '${department}', true), ('${disabled}', '${department}', false);
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261110123300_shared_notifications.sql', import.meta.url), 'utf8'));
  await db.exec('SET ROLE service_role');
  await db.query('SELECT public.write_department_notification($1, $2)', [department, JSON.stringify(message)]);
  const inbox = async (identity, clear = false) => (await db.query('SELECT public.access_owned_notifications($1,$2) AS data', [identity, clear])).rows[0].data;
  const forDepartment = async id => (await db.query('SELECT public.access_department_notifications($1,false) AS data', [id])).rows[0].data;
  assert.deepEqual(await inbox(actor), [message]);
  assert.equal(await inbox(disabled), null);
  assert.deepEqual(await forDepartment(other), []);
  assert.deepEqual(await inbox(actor, true), []);
  assert.deepEqual(await forDepartment(department), []);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(inbox(actor), /permission denied/);
});
