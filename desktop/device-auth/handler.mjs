import { APP_ORIGIN, getChallenge, isDeviceSecret } from './shared.mjs';

export function createDeviceAuthHandler({ webOrigin, identify, isActive, register, approve, claim, issue }) {
  return async function handle(request) {
    const origin = request.headers.get('Origin');
    const headers = {
      'Cache-Control': 'no-store',
      Vary: 'Origin',
    };
    const respond = (status) => new Response(null, { status, headers });
    if (origin !== webOrigin && origin !== APP_ORIGIN) return respond(403);
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type';
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    if (request.method === 'OPTIONS') return respond(204);
    if (request.method !== 'POST') return respond(405);

    const body = await request.json().catch(() => null);
    if (!body) return respond(400);
    try {
      switch (body.action) {
        case 'register':
          if (origin !== APP_ORIGIN) return respond(403);
          if (!isDeviceSecret(body.challenge)) return respond(400);
          return respond(await register(body.challenge) ? 201 : 409);
        case 'approve': {
          if (origin !== webOrigin) return respond(403);
          if (!isDeviceSecret(body.challenge)) return respond(400);
          const token = /^Bearer (\S+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
          const id = token && await identify(token);
          if (!id) return respond(401);
          if (!await isActive(id)) return respond(403);
          return respond(await approve(body.challenge, id) ? 204 : 409);
        }
        case 'claim': {
          if (origin !== APP_ORIGIN) return respond(403);
          if (!isDeviceSecret(body.verifier)) return respond(400);
          const id = await claim(await getChallenge(body.verifier));
          if (!id) return respond(202);
          if (!await isActive(id)) return respond(403);
          const session = await issue(id);
          if (!session) return respond(403);
          return Response.json({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          }, { headers });
        }
        default:
          return respond(400);
      }
    } catch {
      return respond(500);
    }
  };
}
