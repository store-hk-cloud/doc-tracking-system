import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const defaultOutput = resolve(root, 'supabase/functions/desktop-api/index.mjs');

// ระบุเส้นทางที่เปิดให้ Desktop โดยตรง เพื่อให้ API ใหม่ไม่ถูกเปิดโดยอัตโนมัติ
const routes = [
  'admin/backfill-sheets', 'admin/cash-master', 'auth/resolve-username',
  'cashier/handovers', 'cashier/handovers/[id]', 'departments',
  'deliveries', 'deliveries/[id]/verify', 'deliveries/queue',
  'documents', 'documents/[id]', 'documents/[id]/redeliver', 'documents/[id]/sign',
  'messenger/bank-branches', 'messenger/lookups', 'messenger/reports/daily',
  'messenger/runs', 'messenger/runs/[id]', 'messenger/runs/[id]/deposit',
  'messenger/runs/[id]/photos', 'messenger/runs/[id]/pickup',
  'messenger/runs/[id]/variance-report', 'messenger/runs/[id]/void',
  'messenger/variances', 'messenger/variances/[id]/review',
  'notifications', 'profile', 'profiles', 'profiles/[id]', 'profiles/[id]/password',
  'setup-sheets', 'stats', 'upload', 'upload-to-drive',
];

async function routeMap() {
  const modules = await Promise.all(routes.map(async (route, index) => {
    const source = route === 'deliveries/queue'
      ? resolve(here, 'receipt-queue.mjs')
      : resolve(root, 'src/app/api', route, 'route.ts');
    const content = await readFile(source, 'utf8');
    const methods = [...content.matchAll(/^export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\(/gm)]
      .map(match => match[1]);
    if (!methods.length) throw new Error('No exported HTTP handlers: ' + source);
    return {
      code: 'import { ' + methods.map(method => method + ' as ' + method + index).join(', ') + ' } from ' + JSON.stringify(source),
      entry: '[' + JSON.stringify(route) + ', { ' + methods.map(method => method + ': ' + method + index).join(', ') + ' }]',
    };
  }));
  return modules.map(module => module.code).join('\n') + '\nexport default [' + modules.map(module => module.entry).join(',\n') + ']';
}

export async function buildDesktopApi(outfile = defaultOutput) {
  const source = await routeMap();
  return build({
    absWorkingDir: root,
    entryPoints: [resolve(here, 'index.mjs')],
    outfile,
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['node:*'],
    inject: [resolve(here, 'node-globals.mjs')],
    alias: {
      'next/server': resolve(here, 'next-server.mjs'),
      '@/lib/supabase/server': resolve(here, 'supabase-server.mjs'),
      '@/lib/upstash': resolve(root, 'src/lib/supabase-notifications.ts'),
      '@/lib/google-drive': resolve(here, 'document-attachments.mjs'),
      crypto: 'node:crypto',
    },
    plugins: [{
      name: 'desktop-api-route-map',
      setup(plugin) {
        plugin.onResolve({ filter: /^desktop-api:routes$/ }, args => ({ path: args.path, namespace: 'desktop-api' }));
        plugin.onLoad({ filter: /.*/, namespace: 'desktop-api' }, () => ({ contents: source, resolveDir: root }));
      },
    }],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildDesktopApi(process.argv[2] && resolve(process.argv[2]));
}
