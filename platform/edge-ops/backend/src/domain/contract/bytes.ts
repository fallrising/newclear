// Byte helpers built only on Web Crypto so the same code runs in Workers and Node.

// Web Crypto wants ArrayBuffer-backed views; copying also detaches callers' buffers.
const ab = (b: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(b);

export const utf8Encode = (s: string): Uint8Array => new TextEncoder().encode(s);

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", ab(data)));
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function fromHex(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toBase64Url(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Strict unpadded base64url; returns null for any other alphabet, padding or non-canonical tail bits. */
export function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  const out = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return toBase64Url(out) === s ? out : null;
}

export async function importEd25519Public(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", ab(raw), { name: "Ed25519" }, false, ["verify"]);
}

export async function ed25519Verify(publicKey: Uint8Array, signature: Uint8Array, message: Uint8Array): Promise<boolean> {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  try {
    const key = await importEd25519Public(publicKey);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, ab(signature), ab(message));
  } catch {
    return false;
  }
}

const PKCS8_ED25519_PREFIX = fromHex("302e020100300506032b657004220420");

/** Test/tooling only: sign with a raw 32-byte seed. Production signers never run inside the Worker. */
export async function ed25519SignWithSeed(seed: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("pkcs8", ab(concatBytes(PKCS8_ED25519_PREFIX, seed)), { name: "Ed25519" }, true, [
    "sign",
  ]);
  return new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, ab(message)));
}

export async function ed25519PublicFromSeed(seed: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("pkcs8", ab(concatBytes(PKCS8_ED25519_PREFIX, seed)), { name: "Ed25519" }, true, [
    "sign",
  ]);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const pub = fromBase64Url(jwk.x ?? "");
  if (!pub) throw new Error("cannot derive Ed25519 public key");
  return pub;
}
