import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './test-support/load-module.mjs';

test('Supabase configuration prefers the new key names and keeps the legacy names only as fallback', () => {
  const config = loadModule('src/lib/supabase/env.ts', {}, { process: { env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_current',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'legacy-anon',
    SUPABASE_SECRET_KEY: 'sb_secret_current',
    SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-role',
  } } });

  assert.equal(config.getSupabaseUrl(), 'https://project.supabase.co');
  assert.equal(config.getSupabasePublicKey(), 'sb_publishable_current');
  assert.equal(config.getSupabaseSecretKey(), 'sb_secret_current');
});

test('Supabase configuration supports an unmigrated environment as a temporary fallback', () => {
  const config = loadModule('src/lib/supabase/env.ts', {}, { process: { env: {
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'legacy-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-role',
  } } });

  assert.equal(config.getSupabasePublicKey(), 'legacy-anon');
  assert.equal(config.getSupabaseSecretKey(), 'legacy-service-role');
});
