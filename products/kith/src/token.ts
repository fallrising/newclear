const TOKEN_BYTES = 32;

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** Plaintext bot token: `kith_bot_` + 32 random bytes as lowercase hex (64 chars). */
export function issueBotToken(): string {
  return `kith_bot_${bytesToHex(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)))}`;
}

/** SHA-256 of utf8(token) as lowercase hex (64 chars). Same function is used to compare Bearer tokens. */
export async function hashBotToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToHex(new Uint8Array(digest));
}
