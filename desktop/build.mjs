import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const files = new URL('./web/', import.meta.url);
const localEnv = await readFile(new URL('../.env.local', import.meta.url), 'utf8')
  .then(parseEnv, error => {
    if (error.code === 'ENOENT') return {};
    throw error;
  });
const origin = process.env.NEXT_PUBLIC_SUPABASE_URL || localEnv.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || localEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(origin || '') || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey || '')) {
  throw new Error('ตั้งค่า NEXT_PUBLIC_SUPABASE_URL และ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ก่อนสร้างตัวติดตั้ง');
}
const supabaseOrigin = new URL(origin).origin;

await mkdir(files, { recursive: true });
for (const [source, target] of [
  ['index.html', 'index.html'], ['app.js', 'app.js'], ['app.css', 'app.css'],
  ['../ui-kit/ui-kit.css', 'ui-kit.css'], ['../public/icons/hillkoff-emblem.png', 'hillkoff-emblem.png'],
  ['../public/icons/icon-512.png', 'icon-512.png'],
]) {
  await copyFile(new URL(source, import.meta.url), new URL(target, files));
}
await writeFile(new URL('origin.json', files), JSON.stringify(supabaseOrigin));
await build({
  entryPoints: [fileURLToPath(new URL('api-entry.mjs', import.meta.url))],
  outfile: fileURLToPath(new URL('api.js', files)),
  bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'chrome130',
  define: { __SUPABASE_ORIGIN__: JSON.stringify(supabaseOrigin), __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(publicKey) },
});
