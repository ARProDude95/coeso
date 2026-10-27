// Minimal HS256 JWT sign/verify over Web Crypto (HS256 = HMAC-SHA256).
// Payload uses `sub` (userId string) + `iat`/`exp` (seconds), mirroring the
// Spring Boot token shape so the SPA round-trips it unchanged.

function b64url(bytes) {
  let bin = '';
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  for (const b of view) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(obj) {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

function fromB64url(str) {
  const pad = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function signMessage(message, secret) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return b64url(sig);
}

/** Issue a token for a user; ttlMinutes defaults to 720 (matches backend). */
export async function signToken(userId, secret, ttlMinutes = 720) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = b64urlJson({ sub: String(userId), iat: now, exp: now + ttlMinutes * 60 });
  const message = `${header}.${payload}`;
  const sig = await signMessage(message, secret);
  return `${message}.${sig}`;
}

/** Verify signature + expiry; returns the numeric userId or null. */
export async function verifyToken(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = await signMessage(`${header}.${payload}`, secret);
  // Constant-time-ish compare (lengths equal by construction).
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  let claims;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  } catch {
    return null;
  }
  if (!claims || typeof claims.sub !== 'string') return null;
  if (typeof claims.exp === 'number' && claims.exp < Math.floor(Date.now() / 1000)) return null;
  const id = Number(claims.sub);
  return Number.isFinite(id) ? id : null;
}
