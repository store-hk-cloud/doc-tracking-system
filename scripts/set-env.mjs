import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function setEnvironment(name, value, run = spawnSync, platform = process.platform) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name || '') || typeof value !== 'string' || !value) {
    throw new Error('Usage: node scripts/set-env.mjs <name> <value>');
  }
  const command = platform === 'win32' ? 'npx.cmd' : 'npx';
  const config = process.env.DOC_TRACKING_WRANGLER_CONFIG || 'wrangler.jsonc';
  const args = ['wrangler', 'secret', 'put', name, '--config', config];
  // ส่งค่าลับทาง stdin เท่านั้น ไม่ประกอบลงในคำสั่งหรือแสดง output ที่อาจสะท้อนค่าเดิม
  const result = run(command, args, { input: value, encoding: 'utf8', timeout: 30000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`Failed to set ${name}; check Wrangler login and the Worker configuration.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    setEnvironment(process.argv[2], process.argv[3]);
    console.log(`${process.argv[2]} added`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
