import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const fullName = process.env.ADMIN_FULL_NAME || 'Admin';

if (!url || !serviceRoleKey || !email || !password) {
  throw new Error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL and ADMIN_PASSWORD in the trusted environment.');
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: authData, error: authError } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (authError) throw authError;

const { error: profileError } = await supabase.from('profiles').upsert({
  id: authData.user.id,
  email,
  full_name: fullName,
  role: 'super_admin',
  department_id: null,
}, { onConflict: 'id' });

if (profileError) throw profileError;
console.log(`Created super_admin profile for ${email}`);
