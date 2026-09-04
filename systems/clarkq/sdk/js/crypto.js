/**
 * Client-side crypto helpers for clarkQ (Web Crypto / Node 19+ webcrypto).
 */

function b64encode(buf) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(buf).toString("base64");
  }
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(str) {
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(str, "base64"));
  }
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function getSubtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error("Web Crypto API not available");
  }
  return c.subtle;
}

/** @returns {Promise<Uint8Array>} */
export async function generateAES256Key() {
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Encrypt for client mode.
 * @param {Uint8Array} key 32 bytes
 * @param {Uint8Array|string} plaintext
 * @param {string} [keyId]
 */
export async function encryptClientAES(key, plaintext, keyId = "client-key") {
  if (key.length !== 32) throw new Error("AES-256 key must be 32 bytes");
  const pt =
    typeof plaintext === "string" ? new TextEncoder().encode(plaintext) : plaintext;
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await getSubtle().importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const ct = await getSubtle().encrypt({ name: "AES-GCM", iv: nonce }, cryptoKey, pt);
  return {
    body: b64encode(ct),
    encryption: {
      mode: "client",
      algorithm: "aes-256-gcm",
      key_id: keyId,
      nonce: b64encode(nonce),
    },
  };
}

/**
 * Decrypt client-mode body.
 * @param {Uint8Array} key
 * @param {string} body base64
 * @param {{ nonce: string }} meta
 */
export async function decryptClientAES(key, body, meta) {
  if (key.length !== 32) throw new Error("AES-256 key must be 32 bytes");
  const nonce = b64decode(meta.nonce);
  const ct = b64decode(body);
  const cryptoKey = await getSubtle().importKey("raw", key, "AES-GCM", false, ["decrypt"]);
  const pt = await getSubtle().decrypt({ name: "AES-GCM", iv: nonce }, cryptoKey, ct);
  return new Uint8Array(pt);
}

/**
 * Decrypt server_rsa envelope (AES-GCM body + RSA-OAEP encrypted DEK).
 * Requires a CryptoKey RSA private key with decrypt usage.
 * @param {CryptoKey} privateKey
 * @param {string} body base64 ciphertext
 * @param {{ nonce: string, encrypted_key: string }} meta
 */
export async function decryptServerRSA(privateKey, body, meta) {
  const encDEK = b64decode(meta.encrypted_key);
  const nonce = b64decode(meta.nonce);
  const ct = b64decode(body);
  const dekBuf = await getSubtle().decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    encDEK
  );
  const dek = new Uint8Array(dekBuf);
  const cryptoKey = await getSubtle().importKey("raw", dek, "AES-GCM", false, ["decrypt"]);
  const pt = await getSubtle().decrypt({ name: "AES-GCM", iv: nonce }, cryptoKey, ct);
  return new Uint8Array(pt);
}
