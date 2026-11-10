import { getChallenge, getComparisonCode, toHex } from './shared.mjs';

export async function startDeviceLogin({ origin, supabaseUrl, publicKey, openBrowser, signal, onCode }) {
  const web = new URL(origin);
  if (web.protocol !== 'https:' || web.username || web.password) throw new Error('Invalid web origin');

  const verifier = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = await getChallenge(verifier);
  const deadline = Date.now() + 120_000;
  const post = (body) => fetch(new URL('/functions/v1/desktop-device-auth', supabaseUrl), {
    method: 'POST',
    headers: { apikey: publicKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'omit',
    redirect: 'error',
    signal,
  });

  if ((await post({ action: 'register', challenge })).status !== 201) {
    throw new Error('Could not start desktop sign-in');
  }

  const connect = new URL('/desktop/connect', web);
  connect.searchParams.set('challenge', challenge);
  onCode?.(getComparisonCode(challenge));
  await openBrowser(connect.href);

  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const response = await post({ action: 'claim', verifier });
    if (response.status === 200) return response.json();
    if (response.status !== 202) throw new Error('Could not complete desktop sign-in');
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }

  throw new Error('Desktop sign-in expired');
}
