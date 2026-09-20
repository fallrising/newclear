/** Optional application-layer AES-GCM. Default off. Not E2EE: the Worker can decrypt after auth. */

const AES_GCM = "AES-GCM";
const KEY_BITS = 256;
const KEY_BYTES = KEY_BITS / 8;
const IV_BYTES = 12;

export type EncryptedBlob = {
  iv: string;
  ciphertext: string;
};

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64urlDecode(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) {
    throw new Error("invalid base64url");
  }
  const pad = "=".repeat((4 - (text.length % 4)) % 4);
  const b64 = text.replaceAll("-", "+").replaceAll("_", "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as BufferSource;
}

function rawKeyBytes(raw: BufferSource): Uint8Array {
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
}

/** 256-bit AES-GCM CryptoKey. Extractable so operators can persist the raw key. */
export async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: AES_GCM, length: KEY_BITS },
    true,
    ["encrypt", "decrypt"],
  ) as Promise<CryptoKey>;
}

/** Import a 32-byte raw AES-GCM key. */
export async function importKey(raw: BufferSource): Promise<CryptoKey> {
  const bytes = rawKeyBytes(raw);
  if (bytes.byteLength !== KEY_BYTES) {
    throw new Error("AES-GCM key must be 256 bits");
  }
  return crypto.subtle.importKey("raw", asBufferSource(bytes), { name: AES_GCM, length: KEY_BITS }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** UTF-8 plaintext → base64url iv + ciphertext (AES-GCM, 96-bit IV). */
export async function encrypt(key: CryptoKey, plaintext: string): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = await crypto.subtle.encrypt(
    { name: AES_GCM, iv: asBufferSource(iv) },
    key,
    asBufferSource(new TextEncoder().encode(plaintext)),
  );
  return { iv: b64urlEncode(iv), ciphertext: b64urlEncode(new Uint8Array(cipher)) };
}

/** Reverse of encrypt. Auth-tag mismatch (wrong key / truncated blob) rejects. */
export async function decrypt(key: CryptoKey, blob: EncryptedBlob): Promise<string> {
  const iv = b64urlDecode(blob.iv);
  const ciphertext = b64urlDecode(blob.ciphertext);
  const plain = await crypto.subtle.decrypt(
    { name: AES_GCM, iv: asBufferSource(iv) },
    key,
    asBufferSource(ciphertext),
  );
  return new TextDecoder().decode(plain);
}

/** Default off. Only the exact string "on" enables the keyring. */
export function isEnabled(envFlag: string | undefined | null): boolean {
  return envFlag === "on";
}
