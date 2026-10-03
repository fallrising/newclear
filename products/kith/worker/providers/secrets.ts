import { decrypt, encrypt, importKey } from "../../src/keyring.ts";
import type { Env } from "../env.ts";

/** RT-08: AES-GCM with KITH_SECRETS_KEY (base64url or base64 of 32 bytes). Stored as "<iv>.<ciphertext>". */
async function key(env: Env): Promise<CryptoKey | null> {
  const raw = env.KITH_SECRETS_KEY;
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const b64 = raw.replaceAll("-", "+").replaceAll("_", "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return await importKey(bytes);
  } catch {
    return null;
  }
}

export async function canStoreSecrets(env: Env): Promise<boolean> {
  return (await key(env)) !== null;
}

export async function sealSecret(env: Env, plaintext: string): Promise<string | null> {
  const k = await key(env);
  if (!k) return null;
  const blob = await encrypt(k, plaintext);
  return `${blob.iv}.${blob.ciphertext}`;
}

export async function openSecret(env: Env, sealed: string): Promise<string | null> {
  const k = await key(env);
  const dot = sealed.indexOf(".");
  if (!k || dot <= 0) return null;
  try {
    return await decrypt(k, { iv: sealed.slice(0, dot), ciphertext: sealed.slice(dot + 1) });
  } catch {
    return null;
  }
}

/** Only the Worker secret named by the connection; never logged. */
export function envSecret(env: Env, name: string): string | null {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}
