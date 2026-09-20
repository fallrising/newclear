import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const kithctl = join(root, "cmd/kithctl.mjs");
const HASH_RE = /^pbkdf2-sha256\$100000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/;

function runKithctl(
  args: string[],
  stdin = "",
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [kithctl, ...args], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
    if (stdin.length > 0) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

describe("kithctl", () => {
  it("hash-password writes pbkdf2-sha256$100000$salt$dk (iterations>=100000); two hashes of the same password differ", async () => {
    const password = "kith-test-passphrase\n";
    const first = await runKithctl(["hash-password"], password);
    const second = await runKithctl(["hash-password"], password);
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    const hash1 = first.stdout.trimEnd();
    const hash2 = second.stdout.trimEnd();
    expect(hash1).toMatch(HASH_RE);
    expect(hash2).toMatch(HASH_RE);
    const iterations = Number(hash1.split("$")[1]);
    expect(iterations).toBeGreaterThanOrEqual(100000);
    expect(hash1).not.toBe(hash2);
    expect(first.stderr).not.toContain("kith-test-passphrase");
    expect(first.stdout).not.toContain("kith-test-passphrase");
  });

  it("bootstrap SQL contains INSERT INTO members, rooms, room_members and exactly one is_operator = 1", async () => {
    const result = await runKithctl([
      "bootstrap",
      "--operator-id",
      "op1",
      "--operator-handle",
      "owner",
      "--operator-hash",
      "CHANGE_ME_OPERATOR_HASH",
      "--room-id",
      "room1",
      "--room-slug",
      "lobby",
      "--room-name",
      "Lobby",
      "--second-id",
      "h2",
      "--second-handle",
      "guest",
      "--second-hash",
      "CHANGE_ME_SECOND_HASH",
    ]);
    expect(result.code).toBe(0);
    const sql = result.stdout;
    expect(sql).toMatch(/INSERT INTO members/);
    expect(sql).toMatch(/INSERT INTO rooms/);
    expect(sql).toMatch(/INSERT INTO room_members/);
    expect(sql.match(/is_operator\s*=\s*1/g)).toHaveLength(1);
    expect(sql).toMatch(/'owner'/);
    expect(sql).toContain("CHANGE_ME_OPERATOR_HASH");
    expect(sql).toContain("CHANGE_ME_SECOND_HASH");
    expect(sql).toMatch(/role, attention_mode[\s\S]*'owner'/);
    expect(sql).not.toMatch(/INSERT INTO room_members[\s\S]*'h2'/);
  });

  it("scripts/bootstrap.sql documents seed semantics with placeholder hashes, not a real PBKDF2 sample", () => {
    const seed = readFileSync(join(root, "scripts/bootstrap.sql"), "utf8");
    expect(seed).toMatch(/is_operator = 1/);
    expect(seed).toMatch(/INSERT INTO members/);
    expect(seed).toMatch(/INSERT INTO rooms/);
    expect(seed).toMatch(/INSERT INTO room_members/);
    expect(seed).toContain("CHANGE_ME_OPERATOR_HASH");
    expect(seed).toContain("CHANGE_ME_SECOND_HASH");
    expect(seed).toMatch(/node cmd\/kithctl\.mjs hash-password/);
    expect(seed).not.toMatch(/pbkdf2-sha256\$100000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+/);
    expect(seed.toLowerCase()).not.toMatch(/argon2/);
  });
});
