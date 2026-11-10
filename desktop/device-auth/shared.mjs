export const APP_ORIGIN = 'app://desktop';
export const isDeviceSecret = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

export function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function getChallenge(verifier) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export function getComparisonCode(challenge) {
  return challenge.slice(0, 8).toUpperCase().replace(/^(....)/, '$1-');
}
