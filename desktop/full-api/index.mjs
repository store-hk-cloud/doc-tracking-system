import routeMap from 'desktop-api:routes';
import { NextRequest } from './next-server.mjs';
import { withRequestClient } from './supabase-server.mjs';

const clientOrigins = new Set(['app://desktop', 'https://store-hk-cloud.github.io']);
const paths = routeMap.map(([route, handlers]) => [route.split('/'), handlers]);
paths.sort(([first], [second]) => first.filter(part => part.startsWith('[')).length -
  second.filter(part => part.startsWith('[')).length);

function findRoute(pathname) {
  const suffix = pathname.match(/^\/(?:functions\/v1\/)?desktop-api\/api\/(.+)$/)?.[1];
  if (!suffix) return null;
  const segments = suffix.split('/');
  let decoded;
  try {
    decoded = segments.map(decodeURIComponent);
  } catch {
    return null;
  }
  if (decoded.some(segment => !segment || /[\/\\\0]/.test(segment) || segment === '.' || segment === '..')) return null;

  for (const [pattern, handlers] of paths) {
    if (pattern.length !== segments.length) continue;
    const params = {};
    if (pattern.every((part, index) => {
      if (!part.startsWith('[')) return part === segments[index];
      params[part.slice(1, -1)] = decoded[index];
      return true;
    })) return { suffix, handlers, params };
  }
  return null;
}

const fail = (status, error, headers) => Response.json({ success: false, error }, { status, headers });

function desktopHeaders(response, origin) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.append('Vary', 'Origin, Authorization');
  if (clientOrigins.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Expose-Headers', 'Allow');
  }
  return new Response(response.body, { status: response.status, headers });
}

async function dispatch(request, origin) {
  const url = new URL(request.url);
  const route = findRoute(url.pathname);
  if (!route) return fail(404, 'Not found');
  const methods = Object.keys(route.handlers).join(', ');
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': methods + ', OPTIONS',
        'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
      },
    });
  }
  const handler = Object.hasOwn(route.handlers, request.method) && route.handlers[request.method];
  if (!handler) return fail(405, 'Method not allowed', { Allow: methods });

  const isLogin = route.suffix === 'auth/resolve-username' && request.method === 'POST';
  const token = isLogin ? null : request.headers.get('Authorization')?.match(/^Bearer ([^\s,]+)$/i)?.[1];
  if (!isLogin && !token) return fail(401, 'Not authenticated');

  let nextRequest = new NextRequest(request);
  if (route.suffix === 'admin/backfill-sheets' && request.method === 'POST' && clientOrigins.has(origin)) {
    // ต้นทาง Desktop ผ่านการตรวจแล้ว ให้ route เดิมตรวจ same-origin ต่อได้
    const headers = new Headers(request.headers);
    headers.set('Origin', url.origin);
    nextRequest = new NextRequest(nextRequest, { headers });
  }
  return withRequestClient(token, async () => {
    const response = await handler(nextRequest, { params: Promise.resolve(route.params) });
    if (route.suffix !== 'setup-sheets') return response;
    const spreadsheetUrl = response.headers.get('Location');
    if (response.status === 307 && spreadsheetUrl) return Response.json({ success: true, spreadsheetUrl });
    if (response.headers.get('Content-Type')?.startsWith('text/html')) return fail(500, 'ไม่สามารถเปิด Google Sheet');
    return response;
  });
}

export async function handleRequest(request) {
  const origin = request.headers.get('Origin');
  if (origin !== null && !clientOrigins.has(origin)) return desktopHeaders(fail(403, 'Forbidden'), origin);
  try {
    return desktopHeaders(await dispatch(request, origin), origin);
  } catch (error) {
    console.error('[Desktop API] Request failed:', error instanceof Error ? error.name : 'Unknown error');
    return desktopHeaders(fail(500, 'Internal server error'), origin);
  }
}

if (globalThis.Deno) globalThis.Deno.serve(handleRequest);
