// PBKDF2-SHA256 password hashing over Web Crypto (available in Workers).
// Stored format: `pbkdf2$<iterations>$<saltHex>$<hashHex>` (32-byte salt,
// 32-byte derived key) — verified in constant time.
const ITERATIONS = 100000;
const PREFIX = 'pbkdf2';

const enc = new TextEncoder();

function toHex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function derive(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** Hash a plaintext password into the stored format. */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const dk = await derive(password, salt, ITERATIONS);
  return `${PREFIX}$${ITERATIONS}$${toHex(salt)}$${toHex(dk)}`;
}

/** Verify a plaintext password against a stored hash (constant-time). */
export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') {
    return false;
  }
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    return false;
  }
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return false;
  }
  let salt;
  let expected;
  try {
    salt = fromHex(parts[2]);
    expected = fromHex(parts[3]);
  } catch {
    return false;
  }
  const actual = await derive(password, salt, iterations);
  if (actual.length !== expected.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual[i] ^ expected[i];
  }
  return diff === 0;
}
