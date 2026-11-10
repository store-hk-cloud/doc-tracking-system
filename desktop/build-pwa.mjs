import { createHash } from 'node:crypto';
import { readFile, readdir, rename, writeFile, mkdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildFullUi } from './full-ui/build.mjs';
import { serviceWorker } from './pwa/worker.mjs';

export async function buildPwa({ outdir, basePath = '/doc-tracking-system/', ...options }) {
  await mkdir(outdir, {recursive:true});
  const previous = await readdir(outdir);
  await Promise.all(previous.filter(file => /^app-[a-f0-9]+\.(js|css)$/.test(file)).map(file => unlink(join(outdir,file))));
  const result = await buildFullUi({ ...options, outdir, basePath, platform: 'browser' });
  let html = await readFile(join(outdir, 'index.html'), 'utf8');
  for (const extension of ['js', 'css']) {
    const old = `app.${extension}`;
    const data = extension === 'css' ? Buffer.from((await readFile(join(outdir, old), 'utf8')).replaceAll('url(/fonts/', 'url(' + basePath + 'fonts/')) : await readFile(join(outdir, old));
    await writeFile(join(outdir, old), data);
    const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
    const name = `app-${hash}.${extension}`;
    await rename(join(outdir, old), join(outdir, name));
    html = html.replace('/' + old, basePath + name);
  }
  const supabaseHost = new URL(options.supabaseOrigin).origin;
  const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https:; connect-src ${supabaseHost} ${supabaseHost.replace('https:', 'wss:')}; object-src 'none'; base-uri 'self'; form-action 'self'`;
  html = html.replace('</head>', `<meta http-equiv="Content-Security-Policy" content="${csp}">\n</head>`);
  html = html.replace('href="/icons/', `href="${basePath}icons/`).replace('</head>', `  <link rel="manifest" href="${basePath}manifest.webmanifest">\n</head>`);
  await writeFile(join(outdir, 'index.html'), html);
  await writeFile(join(outdir, '.nojekyll'), '');
  await writeFile(join(outdir, 'manifest.webmanifest'), JSON.stringify({
    id: basePath, name: 'Hillkoff จดหมาย พัสดุ เอกสารภายใน', short_name: 'Hillkoff เอกสาร',
    lang: 'th', start_url: basePath + '#/dashboard', scope: basePath, display: 'standalone',
    icons: [192, 512].map(size => ({ src: basePath + `icons/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png' })),
  }, null, 2));
  async function inventory(directory, prefix = '') {
    const files = await readdir(directory, {withFileTypes:true});
    return (await Promise.all(files.map(file => file.isDirectory() ? inventory(join(directory,file.name),prefix+file.name+'/') : [prefix+file.name]))).flat();
  }
  const assets = (await inventory(outdir)).filter(file => file !== 'sw.js' && file !== '.nojekyll').sort();
  const digest = createHash('sha256').update(serviceWorker.toString());
  for(const file of assets) { digest.update(file); digest.update(await readFile(join(outdir,file))); }
  const version = digest.digest('hex').slice(0,20);
  await writeFile(join(outdir,'sw.js'),serviceWorker({basePath, version, assets}));
  return {...result, version, outdir};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const local = await readFile(new URL('../.env.local',import.meta.url),'utf8').then(parseEnv,error => {if(error.code==='ENOENT')return {};throw error;});
  const config = await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8');
  const publicValue = key => process.env[key] || local[key] || config.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`))?.[1];
  const outdir = fileURLToPath(new URL('../build/pwa', import.meta.url));
  await mkdir(outdir,{recursive:true});
  const result = await buildPwa({outdir,supabaseOrigin:publicValue('NEXT_PUBLIC_SUPABASE_URL'),publicKey:publicValue('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),webOrigin:publicValue('NEXT_PUBLIC_APP_URL')});
  console.log(`PWA: ${result.routes.length} pages → ${outdir} (${result.version})`);
}
