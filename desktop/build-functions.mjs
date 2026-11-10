import { copyFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const target = new URL('../supabase/functions/desktop-device-auth/', import.meta.url);
await mkdir(target, { recursive: true });
for (const file of ['index.js', 'handler.mjs', 'shared.mjs']) {
  await copyFile(new URL('./device-auth/' + file, import.meta.url), new URL(file, target));
}
const result = spawnSync(process.execPath, [fileURLToPath(new URL('./full-api/build.mjs', import.meta.url))], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
