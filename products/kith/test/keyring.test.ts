import { describe, expect, it } from "vitest";
import { decrypt, encrypt, generateKey, importKey, isEnabled } from "../src/keyring.ts";

describe("keyring", () => {
  it("M7-CRYPTO-01: roundtrip, wrong key fails, empty plaintext", async () => {
    expect(isEnabled(undefined)).toBe(false);
    expect(isEnabled(null)).toBe(false);
    expect(isEnabled("")).toBe(false);
    expect(isEnabled("true")).toBe(false);
    expect(isEnabled("ON")).toBe(false);
    expect(isEnabled("on")).toBe(true);

    const key = await generateKey();
    const raw = new Uint8Array((await crypto.subtle.exportKey("raw", key)) as ArrayBuffer);
    expect(raw.byteLength).toBe(32);
    const imported = await importKey(raw);

    const blob = await encrypt(imported, "hello kith");
    expect(blob.iv).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(blob.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decrypt(key, blob)).toBe("hello kith");

    const empty = await encrypt(key, "");
    expect(await decrypt(key, empty)).toBe("");

    const other = await generateKey();
    await expect(decrypt(other, blob)).rejects.toThrow();
  });
});
