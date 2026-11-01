import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { APIRequestContext } from "@playwright/test";

// Only inspect the SQLite backing this run's isolated local D1. No production binding or data.
export function stateDir(): string {
  const dir = process.env.KITH_E2E_RUN_DIR;
  if (process.env.KITH_E2E_SETUP_OK !== "1" || !dir) throw new Error("isolated E2E setup required");
  return join(dir, "state");
}
function databaseFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? databaseFiles(path) : entry.name.endsWith(".sqlite") ? [path] : [];
  });
}
export function query(sql: string, ...values: string[]): Record<string, unknown>[] {
  for (const file of databaseFiles(join(stateDir(), "v3", "d1"))) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'members'").get()) continue;
      return db.prepare(sql).all(...values) as Record<string, unknown>[];
    } finally { db.close(); }
  }
  throw new Error("isolated Kith D1 database not found");
}
export function captures(key: string): Record<string, unknown>[] {
  return query("SELECT id, body, source, client_key, exported_commit FROM captures WHERE client_key = ?", key);
}
export function snapshot(): Record<string, unknown> {
  // Compare complete rows, not merely counts, so an accidental edit also fails.
  return {
    messages: query("SELECT * FROM messages ORDER BY id"),
    captures: query("SELECT * FROM captures ORDER BY id"),
    notes: query("SELECT * FROM notes ORDER BY id"),
  };
}
export async function request(request: APIRequestContext, method: string, path: string, body?: unknown) {
  const csrf = method === "GET" ? null : await (await request.get("/api/csrf")).json() as { csrf: string };
  return request.fetch(path, {
    method,
    headers: csrf ? { "X-CSRF-Token": csrf.csrf } : {},
    ...(body === undefined ? {} : { data: body }),
  });
}
