import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildFullUi } from './full-ui/build.mjs';

const localEnv = await readFile(new URL('../.env.local', import.meta.url), 'utf8')
  .then(parseEnv, error => {
    if (error.code === 'ENOENT') return {};
    throw error;
  });
const webConfig = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const { NEXT_PUBLIC_SUPABASE_URL: supabaseOrigin, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey, NEXT_PUBLIC_APP_URL: configuredWebUrl } = { ...localEnv, ...process.env };
const webUrl = configuredWebUrl || webConfig.match(/"NEXT_PUBLIC_APP_URL"\s*:\s*"([^"]+)"/)?.[1];
if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(supabaseOrigin || '') || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey || '')
  || !/^https:\/\/[a-z0-9.-]+\/?$/.test(webUrl || '')) throw new Error('Missing public desktop configuration');
const webOrigin = new URL(webUrl).origin;
const outdir = new URL('./full-web/', import.meta.url);
await buildFullUi({ outdir: fileURLToPath(outdir), supabaseOrigin: new URL(supabaseOrigin).origin, publicKey, webOrigin });
await writeFile(new URL('desktop-config.json', outdir), JSON.stringify({ supabaseOrigin: new URL(supabaseOrigin).origin, webOrigin }));
