import "server-only";

/**
 * Password hashing with PBKDF2-HMAC-SHA256 via Web Crypto.
 *
 * Web Crypto is the one API available in both Node and the Workers runtime,
 * so accounts work the same in `next dev` and on the deployed worker without
 * a native dependency. Stored format:
 *
 *   pbkdf2$<iterations>$<base64 salt>$<base64 hash>
 */
const ALGORITHM = "PBKDF2";

/**
 * Cloudflare's Web Crypto implementation rejects PBKDF2 iteration counts above
 * 100,000 ("Pbkdf2 failed: iteration counts above 100000 are not supported"),
 * so this sits exactly at the runtime ceiling. The cost is stored in every hash
 * (`pbkdf2$<iterations>$...`), so raising it for a runtime without that cap
 * keeps existing passwords verifiable.
 */
const ITERATIONS = 100_000;
const KEY_LENGTH_BITS = 256;
const SALT_BYTES = 16;
const PREFIX = "pbkdf2";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    ALGORITHM,
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: ALGORITHM,
      hash: "SHA-256",
      salt: salt as unknown as BufferSource,
      iterations,
    },
    key,
    KEY_LENGTH_BITS,
  );
  return new Uint8Array(bits);
}

/** Compares two byte arrays without leaking where they diverge. */
function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `${PREFIX}$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [prefix, iterationsRaw, saltRaw, hashRaw] = stored.split("$");
  if (prefix !== PREFIX || !iterationsRaw || !saltRaw || !hashRaw) return false;

  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations) || iterations < 1) return false;

  try {
    const expected = fromBase64(hashRaw);
    const actual = await derive(password, fromBase64(saltRaw), iterations);
    return equal(actual, expected);
  } catch {
    return false;
  }
}
