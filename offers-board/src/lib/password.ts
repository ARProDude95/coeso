const KEY_BYTES = 32;
// Cloudflare's Web Crypto implementation rejects PBKDF2 above 100,000
// iterations, so that is the ceiling this board can use on Workers.
const ITERATIONS = 100_000;
const SCHEME = "pbkdf2-sha256";

/** Readable alphabet — no 0/O, 1/l/I, so credentials survive being retyped. */
const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function fromHex(value: string): Uint8Array<ArrayBuffer> | null {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value)) return null;
  const out = new Uint8Array(value.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

/**
 * PBKDF2 through Web Crypto: available unchanged in Workers, Node and the
 * browser, unlike node:crypto's scrypt which the Workers runtime lacks.
 */
async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index];
  }
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `${SCHEME}$${ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, iterations, saltHex, hashHex] = stored.split("$");
  if (scheme !== SCHEME || !iterations || !saltHex || !hashHex) return false;

  const salt = fromHex(saltHex);
  const expected = fromHex(hashHex);
  const rounds = Number(iterations);
  if (!salt || !expected || !Number.isFinite(rounds) || rounds < 1) return false;

  const actual = await derive(password, salt, rounds);
  return equal(actual, expected);
}

/** Temporary password shown once to the admin when an account is created. */
export function generatePassword(length = 14): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += ALPHABET[(bytes[index] ?? 0) % ALPHABET.length];
  }
  return out;
}
