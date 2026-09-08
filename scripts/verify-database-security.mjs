import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const client = {
  query(sql) {
    const output = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `& supabase db query --linked --output json '${sql.replaceAll("'", "''")}'; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`,
    ], { encoding: 'utf8', timeout: 60000 });
    return JSON.parse(output);
  },
};
try {
  const { rows } = await client.query(`
    SELECT c.relname,c.relrowsecurity,c.relkind,
      has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS anon_access,
      has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') AS browser_write,
      has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS server_access
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','v')
  `);
  assert.ok(rows.length > 0);
  assert.equal(rows.filter((r) => r.anon_access || r.browser_write || !r.server_access || (r.relkind === 'r' && !r.relrowsecurity)).length, 0, 'Unsafe table permissions');
  const funcs = (await client.query(`SELECT p.proname,p.proconfig,
    has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
    has_function_privilege('authenticated',p.oid,'EXECUTE') AS browser,
    has_function_privilege('service_role',p.oid,'EXECUTE') AS server
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'`)).rows;
  assert.equal(funcs.filter((r) => r.anon || r.browser || !r.server || !r.proconfig?.some((c) => c.startsWith('search_path='))).length, 0, 'Unsafe function permissions');
  assert.equal(funcs.filter((r) => ['receive_document','verify_document_delivery'].includes(r.proname)).length, 2);
  await client.query('BEGIN READ ONLY; SET LOCAL ROLE authenticated; SELECT id FROM public.departments LIMIT 0; SELECT id FROM public.profiles LIMIT 0; ROLLBACK;');
  console.log(`Verified ${rows.length} tables/views and ${funcs.length} functions; browser writes denied, server access retained, lookup reads work.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
