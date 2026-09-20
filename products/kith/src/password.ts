const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const DK_BITS = 256;

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64urlDecode(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const pad = "=".repeat((4 - (text.length % 4)) % 4);
  const b64 = text.replaceAll("-", "+").replaceAll("_", "/") + pad;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    DK_BITS,
  );
  return new Uint8Array(bits);
}

/** Format: pbkdf2-sha256$<iterations>$<salt_b64url>$<dk_b64url> */
export async function hashPassword(password: string, iterations: number = ITERATIONS): Promise<string> {
  if (iterations < ITERATIONS) {
    throw new Error("iterations must be >= 100000");
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const dk = await derive(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${b64urlEncode(salt)}$${b64urlEncode(dk)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < ITERATIONS) return false;
  const salt = b64urlDecode(parts[2]!);
  const expected = b64urlDecode(parts[3]!);
  if (!salt || !expected || salt.byteLength === 0 || expected.byteLength === 0) return false;
  const actual = await derive(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}
