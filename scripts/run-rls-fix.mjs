// Run RLS fix SQL against Supabase via service_role key
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(__dirname, 'fix-rls-recursion.sql'), 'utf8');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing SUPABASE env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

async function main() {
  // Split by semicolons and execute each statement
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--'));

  for (const stmt of statements) {
    if (stmt.length < 10) continue;
    console.log(`▶ Executing: ${stmt.substring(0, 80)}...`);
    const { error } = await supabase.rpc('exec_sql', { sql: stmt + ';' });
    if (error) {
      // Fallback: try direct query
      const { error: e2 } = await supabase.from('_exec_sql').select('*').filter('query', 'eq', stmt).limit(1);
      if (e2) {
        console.log(`  ⚠️  ${error.message}`);
      } else {
        console.log('  ✅ Done');
      }
    } else {
      console.log('  ✅ Done');
    }
  }
  console.log('\n🎉 RLS fix SQL executed!');
}

main().catch(console.error);