export function createApiFetch({ fetch, location, supabaseOrigin, publicKey, getAccessToken }) {
  const local = new URL(location);
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input, local);
    if (url.protocol !== local.protocol || url.host !== local.host || !url.pathname.startsWith('/api/')) {
      return fetch(input, init);
    }

    const request = new Request(input instanceof Request ? input : url, init);
    const headers = new Headers(request.headers);
    headers.delete('authorization');
    headers.set('apikey', publicKey);
    if (url.pathname !== '/api/auth/resolve-username') {
      const token = await getAccessToken();
      if (token) headers.set('authorization', `Bearer ${token}`);
    }

    const target = new URL(`/functions/v1/desktop-api${url.pathname}${url.search}`, supabaseOrigin);
    // รักษา multipart boundary เดิมและส่งไฟล์โดยไม่ใช้ streaming request ของ Chromium
    const body = request.body ? await request.blob() : undefined;
    return fetch(new Request(target, {
      method: request.method,
      headers,
      body,
      cache: request.cache,
      signal: request.signal,
      keepalive: request.keepalive,
      integrity: request.integrity,
      credentials: 'omit',
      mode: 'cors',
      redirect: 'error',
    }));
  };
}
