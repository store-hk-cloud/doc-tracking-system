import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function setEnvironment(name, value, run = spawnSync, platform = process.platform) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name || '') || typeof value !== 'string' || !value) {
    throw new Error('Usage: node scripts/set-env.mjs <name> <value>');
  }
  const command = platform === 'win32' ? 'powershell.exe' : 'npx';
  const args = platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', `& npx.cmd vercel env add ${name} production --yes; exit $LASTEXITCODE`]
    : ['vercel', 'env', 'add', name, 'production', '--yes'];
  // ส่งค่าลับทาง stdin เท่านั้น ไม่ประกอบลงในคำสั่งหรือแสดง output ที่อาจสะท้อนค่าเดิม
  const result = run(command, args, { input: value, encoding: 'utf8', timeout: 30000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`Failed to set ${name}; check Vercel login and whether the variable already exists.`);
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
