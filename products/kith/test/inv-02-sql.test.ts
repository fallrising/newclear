import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sqlPath = join(root, "sql/v1.sql");

describe("INV-02 SQL trigger", () => {
  it("INV-02-SQL: sqlite loads v1.sql; agent owner INSERT/UPDATE ABORT; human owner allowed; trigger is RAISE/EXISTS not CHECK subquery", () => {
    const ddl = readFileSync(sqlPath, "utf8");
    expect(ddl).toMatch(/RAISE\s*\(\s*ABORT,\s*'agent cannot be owner'\s*\)/);
    expect(ddl).toMatch(/EXISTS/);
    expect(ddl).toMatch(/CREATE TRIGGER room_members_no_agent_owner/);
    expect(ddl).toMatch(/CREATE TRIGGER room_members_no_agent_owner_upd/);
    expect(ddl).not.toMatch(/CREATE TABLE room_members[\s\S]*CHECK\s*\(\s*[^)]*SELECT/i);

    const db = new DatabaseSync(":memory:");
    db.exec(ddl);

    db.exec(
      `INSERT INTO members (id, kind, handle, display_name, password_hash, created_at)
       VALUES ('h1', 'human', 'alice', 'Alice', 'pbkdf2-test-hash', '2026-01-01T00:00:00Z')`,
    );
    db.exec(
      `INSERT INTO members (id, kind, handle, display_name, password_hash, created_at)
       VALUES ('a1', 'agent', 'grok', 'Grok', NULL, '2026-01-01T00:00:00Z')`,
    );
    db.exec(
      `INSERT INTO rooms (id, slug, name, created_by, created_at)
       VALUES ('r1', 'room', 'Room', 'h1', '2026-01-01T00:00:00Z')`,
    );

    db.exec(
      `INSERT INTO room_members (room_id, member_id, role, attention_mode)
       VALUES ('r1', 'h1', 'owner', 'mention')`,
    );

    expect(() =>
      db.exec(
        `INSERT INTO room_members (room_id, member_id, role, attention_mode)
         VALUES ('r1', 'a1', 'owner', 'mention')`,
      ),
    ).toThrow(/agent cannot be owner/);

    db.exec(
      `INSERT INTO room_members (room_id, member_id, role, attention_mode)
       VALUES ('r1', 'a1', 'member', 'mention')`,
    );

    expect(() =>
      db.exec(`UPDATE room_members SET role = 'owner' WHERE room_id = 'r1' AND member_id = 'a1'`),
    ).toThrow(/agent cannot be owner/);

    db.close();
  });
});
