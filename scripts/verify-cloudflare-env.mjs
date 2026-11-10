const generated = await import('../.open-next/cloudflare/next-env.mjs');

// ค่า server ต้องมาจาก binding ตอน runtime เพราะ OpenNext จะฝังค่าในไฟล์นี้ลง Worker
const embeddedServerVariables = [...new Set(Object.values(generated)
  .flatMap((values) => Object.keys(values))
  .filter((key) => !key.startsWith('NEXT_PUBLIC_')))];

if (embeddedServerVariables.length) {
  console.error(`Cloudflare bundle embeds server environment variables: ${embeddedServerVariables.sort().join(', ')}`);
  console.error('Build in a clean checkout with public build variables only and use Cloudflare Secrets for server values.');
  process.exitCode = 1;
} else {
  console.log('Cloudflare environment bundle contains no server variables.');
}
