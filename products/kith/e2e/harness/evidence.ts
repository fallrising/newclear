import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Page, TestInfo } from "@playwright/test";

// Evidence helpers (docs/v2/milestones/W0.md §5.1.9). Every entry becomes a test annotation that the
// reporter turns into manifest evidence.

export type EvidenceEntry =
  | { kind: "screenshot" | "api-log" | "ws-log" | "trace" | "file"; path: string }
  | { kind: "assertion"; text: string };

const shotCounters = new WeakMap<TestInfo, number>();

function runDir(): string {
  const dir = process.env.KITH_E2E_RUN_DIR;
  if (!dir) throw new Error("KITH_E2E_RUN_DIR is not set");
  return dir;
}

function push(info: TestInfo, entry: EvidenceEntry): void {
  info.annotations.push({ type: "evidence", description: JSON.stringify(entry) });
}

export function acceptanceId(info: TestInfo): string | null {
  return /^((?:E2E|PROBE)-W[0-7]-[0-9]{2}) /.exec(info.title)?.[1] ?? null;
}

export async function shot(page: Page, info: TestInfo, step: string): Promise<string> {
  const id = acceptanceId(info);
  if (id === null) throw new Error("shot() requires an acceptance id in the test title");
  if (!/^[a-z0-9-]+$/.test(step)) throw new Error("shot() step must match [a-z0-9-]+: " + step);
  const n = (shotCounters.get(info) ?? 0) + 1;
  shotCounters.set(info, n);
  const rel = "screenshots/" + id + "/" + String(n).padStart(2, "0") + "-" + step + "-" + info.project.name + ".png";
  await page.screenshot({
    path: join(runDir(), rel),
    fullPage: false,
    animations: "disabled",
    caret: "hide",
    mask: [page.locator("[data-mask]")],
  });
  push(info, { kind: "screenshot", path: rel });
  return rel;
}

export function note(info: TestInfo, text: string): void {
  if (text.length > 500) throw new Error("note() text must be at most 500 characters");
  push(info, { kind: "assertion", text });
}

/** Writes the content as-is (no redaction: the caller decides what goes in). */
export function saveFile(info: TestInfo, name: string, content: string | Buffer): string {
  const id = acceptanceId(info);
  if (id === null) throw new Error("saveFile() requires an acceptance id in the test title");
  if (!/^[a-z0-9.-]+$/.test(name)) throw new Error("saveFile() name must match [a-z0-9.-]+: " + name);
  const rel = "files/" + id + "/" + name;
  const abs = join(runDir(), rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  push(info, { kind: "file", path: rel });
  return rel;
}
