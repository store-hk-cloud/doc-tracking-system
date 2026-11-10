export { Buffer } from 'node:buffer';
import nodeProcess from 'node:process';

function defaultKey(keys) {
  try {
    return JSON.parse(keys || '{}').default;
  } catch {
    return undefined;
  }
}

const defaults = {
  NEXT_PUBLIC_SUPABASE_URL: () => nodeProcess.env.SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: () => nodeProcess.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? undefined
    : defaultKey(nodeProcess.env.SUPABASE_PUBLISHABLE_KEYS),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: () => nodeProcess.env.SUPABASE_ANON_KEY,
  SUPABASE_SECRET_KEY: () => defaultKey(nodeProcess.env.SUPABASE_SECRET_KEYS),
  GOOGLE_SHEETS_SYNC_MODE: () => 'apps_script',
};

// ใช้ env มาตรฐานของ Edge กับ helper เดิม โดยไม่แก้ process.env ของ runtime
const env = new Proxy(nodeProcess.env, {
  get(target, key) {
    return target[key] || (Object.hasOwn(defaults, key) ? defaults[key]() : undefined);
  },
});

export const process = Object.create(nodeProcess, { env: { value: env } });
