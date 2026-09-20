#!/usr/bin/env node
/**
 * Local-only L2 seed: two humans in one room.
 * Writes gitignored .dev.accounts + .wrangler/bootstrap-local.sql.
 * Does not print hashes. Prints handles/passwords once to stdout.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ACCOUNTS = join(ROOT, ".dev.accounts");
const SQL_OUT = join(ROOT, ".wrangler", "bootstrap-local.sql");
const KITHCTL = join(ROOT, "cmd", "kithctl.mjs");

const ITERATIONS = 100000;
const SALT_BYTES = 16;
const DK_BITS = 256;

function b64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return b64url(bytes);
}

function issueBotToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `kith_bot_${hex}`;
}

async function hashBotToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    material,
    DK_BITS,
  );
  return `pbkdf2-sha256$${ITERATIONS}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`;
}

function loadAccounts() {
  if (!existsSync(ACCOUNTS)) return null;
  const text = readFileSync(ACCOUNTS, "utf8");
  const out = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    out[t.slice(0, eq)] = t.slice(eq + 1);
  }
  if (out.KITH_OWNER_PASSWORD && out.KITH_GUEST_PASSWORD) return out;
  return null;
}

function writeAccounts(ownerPass, guestPass, grokToken, codexToken) {
  writeFileSync(
    ACCOUNTS,
    [
      "# Local wrangler accounts. Gitignored. Do not commit.",
      "KITH_OWNER_HANDLE=owner",
      `KITH_OWNER_PASSWORD=${ownerPass}`,
      "KITH_GUEST_HANDLE=guest",
      `KITH_GUEST_PASSWORD=${guestPass}`,
      "KITH_ROOM_ID=room-1",
      "KITH_ROOM_SLUG=lobby",
      "KITH_GROK_HANDLE=grok",
      `KITH_GROK_BOT_TOKEN=${grokToken}`,
      "KITH_CODEX_HANDLE=codex",
      `KITH_CODEX_BOT_TOKEN=${codexToken}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
}

const existing = loadAccounts();
const ownerPass = process.env.KITH_OWNER_PASSWORD || existing?.KITH_OWNER_PASSWORD || randomPassword();
const guestPass = process.env.KITH_GUEST_PASSWORD || existing?.KITH_GUEST_PASSWORD || randomPassword();
const grokToken = process.env.KITH_GROK_BOT_TOKEN || existing?.KITH_GROK_BOT_TOKEN || issueBotToken();
const codexToken = process.env.KITH_CODEX_BOT_TOKEN || existing?.KITH_CODEX_BOT_TOKEN || issueBotToken();
writeAccounts(ownerPass, guestPass, grokToken, codexToken);

const ownerHash = await hashPassword(ownerPass);
const guestHash = await hashPassword(guestPass);

const gen = spawnSync(
  process.execPath,
  [
    KITHCTL,
    "bootstrap",
    "--operator-id",
    "operator",
    "--operator-handle",
    "owner",
    "--operator-hash",
    ownerHash,
    "--room-id",
    "room-1",
    "--room-slug",
    "lobby",
    "--room-name",
    "Lobby",
    "--second-id",
    "second",
    "--second-handle",
    "guest",
    "--second-hash",
    guestHash,
  ],
  { encoding: "utf8" },
);
if (gen.status !== 0) {
  process.stderr.write(gen.stderr || "kithctl bootstrap failed\n");
  process.exit(gen.status || 1);
}

const grokHash = await hashBotToken(grokToken);
const codexHash = await hashBotToken(codexToken);
const nowIso = new Date().toISOString().replaceAll("'", "''");
const joinLocal = [
  "",
  "-- L2: join guest as member so both humans can chat without an extra POST.",
  "INSERT INTO room_members (room_id, member_id, role, attention_mode, keywords_json, cooldown_ms, debounce_ms, classifier, policy_epoch)",
  "VALUES ('room-1', 'second', 'member', 'mention', '[]', 15000, 2000, 'heuristic', 1);",
  "",
  "-- L3/L5: hosted Grok; local seed uses ambient + debounce 0 so a human question can wake without @.",
  "INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at)",
  `VALUES ('grok', 'agent', 'grok', 'Grok', NULL, '[]', 'api_key', 0, '${nowIso}');`,
  "INSERT INTO room_members (room_id, member_id, role, attention_mode, keywords_json, cooldown_ms, debounce_ms, classifier, policy_epoch)",
  "VALUES ('room-1', 'grok', 'member', 'ambient', '[]', 15000, 0, 'heuristic', 1);",
  "INSERT INTO bot_tokens (id, member_id, token_hash, room_scope_json, created_at, expires_at, revoked_at, last_used_at)",
  `VALUES ('tok-grok-local', 'grok', '${grokHash}', '[]', '${nowIso}', NULL, NULL, NULL);`,
  "",
  "-- L4: Codex sidecar agent (operator_personal). SSE is dumb; INV-13 is local in sidecar.",
  "INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at)",
  `VALUES ('codex', 'agent', 'codex', 'Codex', NULL, '[]', 'operator_personal', 0, '${nowIso}');`,
  "INSERT INTO room_members (room_id, member_id, role, attention_mode, keywords_json, cooldown_ms, debounce_ms, classifier, policy_epoch)",
  "VALUES ('room-1', 'codex', 'member', 'mention', '[]', 15000, 2000, 'heuristic', 1);",
  "INSERT INTO bot_tokens (id, member_id, token_hash, room_scope_json, created_at, expires_at, revoked_at, last_used_at)",
  `VALUES ('tok-codex-local', 'codex', '${codexHash}', '[]', '${nowIso}', NULL, NULL, NULL);`,
  "",
].join("\n");

const wipe = [
  "-- Local reset of catalog/log tables (dev D1 only).",
  "DELETE FROM messages;",
  "DELETE FROM bot_tokens;",
  "DELETE FROM generations;",
  "DELETE FROM room_members;",
  "DELETE FROM rooms;",
  "DELETE FROM members;",
  "",
].join("\n");

mkdirSync(join(ROOT, ".wrangler"), { recursive: true });
writeFileSync(SQL_OUT, wipe + gen.stdout + joinLocal);

process.stdout.write(
  [
    "Wrote gitignored .dev.accounts and .wrangler/bootstrap-local.sql",
    "handles: owner / guest / grok / codex",
    "room: room-1 (lobby)",
    `owner password: ${ownerPass}`,
    `guest password: ${guestPass}`,
    "tokens: .dev.accounts KITH_GROK_BOT_TOKEN / KITH_CODEX_BOT_TOKEN",
    "Apply with: npm run db:bootstrap:local",
    "",
  ].join("\n"),
);
