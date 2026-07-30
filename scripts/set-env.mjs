// Set Vercel Environment Variables via CLI non-interactively
// Usage: node scripts/set-env.mjs <name> <value>
import { execSync } from 'child_process';

const name = process.argv[2];
const value = process.argv[3];

if (!name || !value) {
  console.error('Usage: node scripts/set-env.mjs <name> <value>');
  process.exit(1);
}

try {
  const result = execSync(
    `npx vercel env add ${name} production --yes 2>&1`,
    { input: `${value}\ny\n`, timeout: 15000, shell: true }
  );
  console.log(`✅ ${name} added`);
} catch (e) {
  // Fallback: try to write using a temp approach
  console.log(`Trying alternate method for ${name}...`);
  const fs = require('fs');
  const token = process.env.VERCEL_TOKEN || execSync('npx vercel whoami --token 2>&1', { shell: true }).toString().trim();
  
  // Use Vercel API directly
  const res = execSync(
    `curl -s -X POST "https://api.vercel.com/v10/projects/store-hk-5474s-projects/doc-tracking-system/env" \
      -H "Authorization: Bearer $(npx vercel whoami --token 2>&1 | tail -1)" \
      -H "Content-Type: application/json" \
      -d '{"key":"${name}","value":"${value}","type":"encrypted","target":["production"]}'`,
    { shell: true, timeout: 15000 }
  );
  const data = JSON.parse(res.toString());
  if (data.error) {
    console.log(`  ⚠️  ${data.error.message || JSON.stringify(data.error)}`);
  } else {
    console.log(`  ✅ ${name} added via API`);
  }
}