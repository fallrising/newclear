import { createHash } from "node:crypto";

export type TestAccount = { id: string; handle: string; display_name: string; password: string };

export const ACCOUNTS = {
  ada: { id: "m-ada", handle: "ada", display_name: "Ada Lin", password: "kith-e2e-ada-pass" },
  ben: { id: "m-ben", handle: "ben", display_name: "Ben Okafor", password: "kith-e2e-ben-pass" },
  chen: { id: "m-chen", handle: "chen", display_name: "陳怡君", password: "kith-e2e-chen-pass" },
  dora: { id: "m-dora", handle: "dora", display_name: "Dora Silva", password: "kith-e2e-dora-pass" },
} as const satisfies Record<string, TestAccount>;

/** 非機密的 canary：只用來證明遮罩有效。不是任何真實 key。 */
export const CANARY = "kith-e2e-canary-3f9c";

export function canaryBotToken(): string {
  return "kith_bot_" + createHash("sha256").update(CANARY).digest("hex");
}

export function knownSecrets(): string[] {
  return [...Object.values(ACCOUNTS).map((a) => a.password), CANARY, canaryBotToken()];
}
