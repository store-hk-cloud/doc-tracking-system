function parseUrl(value) {
  try { return new URL(value); } catch { return null; }
}

function localUrl(value) {
  const url = parseUrl(value);
  return url?.protocol === 'app:' && url.host === 'desktop' && !url.username && !url.password ? url : null;
}

function assetFor(value) {
  const url = localUrl(value);
  if (!url) return null;
  const pathname = url.pathname;
  if (/^\/(app\.(?:js|css)|index\.html)$/.test(pathname)
    || /^\/(?:icons|fonts)\/[\w.-]+\.(?:svg|png|woff2)$/.test(pathname)) return pathname.slice(1);
  if (pathname === '/api' || pathname.startsWith('/api/')) return null;
  return /^\/(?:[\w-]+\/)*[\w-]*$/.test(pathname) ? 'index.html' : null;
}

function allowExternal(value, { webOrigin, supabaseOrigin }) {
  const url = parseUrl(value);
  if (!url || url.username || url.password) return false;
  if (url.protocol === 'tel:') return /^tel:\+?[0-9(). -]{3,30}$/.test(value);
  if (url.protocol !== 'https:' || url.port) return false;
  if (url.origin === webOrigin && url.pathname === '/desktop/connect') {
    const [challenge] = url.searchParams.getAll('challenge');
    return [...url.searchParams.keys()].length === 1 && /^[A-Za-z0-9_-]{43}$|^[a-f0-9]{64}$/.test(challenge || '');
  }
  if (url.origin === 'https://docs.google.com') return /^\/spreadsheets\/d\/[\w-]+(?:\/|$)/.test(url.pathname);
  if (url.origin === 'https://drive.google.com') return /^\/(?:file\/d\/[\w-]+(?:\/|$)|open$)/.test(url.pathname);
  return url.origin === supabaseOrigin && /^\/storage\/v1\/object\/(?:public|sign)\/doc-attachments\//.test(url.pathname);
}

function sessionKey(key, { supabaseOrigin }) {
  const ref = new URL(supabaseOrigin).hostname.split('.')[0];
  const base = `sb-${ref}-auth-token`;
  return [base, `${base}-code-verifier`, `${base}-user`].includes(key);
}

module.exports = { localUrl, assetFor, allowExternal, sessionKey };
