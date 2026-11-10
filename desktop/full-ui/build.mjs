import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/postcss';
import { build } from 'esbuild';
import postcss from 'postcss';

const directory = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(directory, '../..');
const app = join(root, 'src', 'app');

async function findPages(directory) {
  const files = await readdir(join(app, directory), { withFileTypes: true });
  const pages = await Promise.all(files.map((file) => {
    const path = [directory, file.name].filter(Boolean).join('/');
    if (path === 'api' || path === 'desktop/connect') return [];
    if (file.isDirectory()) return findPages(path);
    return file.name === 'page.tsx' ? [path] : [];
  }));
  return pages.flat();
}

export async function buildFullUi({ outdir, supabaseOrigin, publicKey, webOrigin, platform = 'desktop', basePath = '/' }) {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(basePath)) throw new Error('basePath ต้องเป็น path ที่ลงท้ายด้วย /');
  const origin = new URL(supabaseOrigin);
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(origin.href) ||
      !/^sb_publishable_[\w-]+$/.test(publicKey)) {
    throw new Error('ตั้งค่า Supabase URL และ publishable key ก่อนสร้างแอป');
  }
  const web = webOrigin ? new URL(webOrigin) : null;
  if (web && (web.protocol !== 'https:' || web.href !== web.origin + '/')) {
    throw new Error('ตั้งค่า URL เว็บเป็น HTTPS origin');
  }
  const pages = (await findPages('')).sort();
  const routes = pages.map((path) => '/' + path.slice(0, -'page.tsx'.length).replace(/\/$/, ''));
  const imports = pages.map((path, index) => `import Page${index} from ${JSON.stringify('@/app/' + path)};`);
  const exports = routes.map((route, index) => `${JSON.stringify(route)}: Page${index}`);

  await mkdir(outdir, { recursive: true });
  const cssPath = join(app, 'globals.css');
  const [globals, fonts] = await Promise.all([
    readFile(cssPath, 'utf8'),
    readFile(join(directory, 'fonts.css'), 'utf8'),
  ]);
  const { css } = await postcss([tailwindcss({ base: root, optimize: true })])
    .process(globals, { from: cssPath });
  await Promise.all([
    writeFile(join(outdir, 'app.css'), `${fonts}\n:root{--font-kanit:Kanit}\n${css}\n.desktop-download{display:none}`),
    cp(join(directory, 'index.html'), join(outdir, 'index.html')),
    cp(join(directory, 'fonts'), join(outdir, 'fonts'), { recursive: true }),
    cp(join(root, 'public', 'icons'), join(outdir, 'icons'), { recursive: true }),
    build({
      absWorkingDir: root,
      entryPoints: [join(directory, 'app.jsx')],
      outfile: join(outdir, 'app.js'),
      bundle: true,
      minify: true,
      format: 'esm',
      platform: 'browser',
      target: 'chrome130',
      jsx: 'automatic',
      define: {
        __PWA__: JSON.stringify(platform === 'browser'),
        __PWA_BASE__: JSON.stringify(basePath),
        __SUPABASE_ORIGIN__: JSON.stringify(origin.origin),
        __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(publicKey),
        __DESKTOP_WEB_ORIGIN__: JSON.stringify(web?.origin ?? ''),
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
      alias: {
        'next/link': join(directory, 'link.jsx'),
        'next/image': join(directory, 'image.jsx'),
        'next/navigation': join(directory, 'navigation.jsx'),
        '@/lib/supabase/client': join(directory, 'supabase-client.mjs'),
        '@': join(root, 'src'),
      },
      plugins: [{
        name: 'desktop-routes',
        setup(builder) {
          if (platform === 'browser') builder.onLoad({ filter: /\.(tsx|jsx)$/ }, async (args) => {
            const contents = await readFile(args.path, 'utf8');
            const scoped = contents.replace(/window\.location\.href = '(\/[^']*)';/g, (_, path) => `window.location.href = ${JSON.stringify(basePath + '#')} + ${JSON.stringify(path)}; window.location.reload();`).replace(/window\.location\.replace\('(\/[^']*)'\)/g, (_, path) => `window.location.replace(${JSON.stringify(basePath + '#' + path)}); window.location.reload()`);
            return {contents: scoped, loader: args.path.endsWith('.tsx') ? 'tsx' : 'jsx'};
          });
          builder.onResolve({ filter: /^desktop:routes$/ }, () => ({ path: 'routes', namespace: 'desktop' }));
          builder.onLoad({ filter: /.*/, namespace: 'desktop' }, () => ({
            contents: `${imports.join('\n')}\nexport default {${exports.join(',')}};`,
            resolveDir: root,
          }));
        },
      }],
    }),
  ]);
  return { routes };
}
