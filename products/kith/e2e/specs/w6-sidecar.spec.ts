// E2E-W6-05 (docs/v2/milestones/W6.md §7.5). The v1 sidecar suite is the subject; this file does not drive a browser.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures/kith.ts";
import { saveFile } from "../harness/evidence.ts";
import { KITH_DIR } from "../harness/paths.ts";

test("E2E-W6-05 the v1 sidecar tests still pass", { tag: ["@W6"] }, async ({}, info) => {
  test.setTimeout(180_000);
  const result = spawnSync("npm", ["run", "test:sidecar"], { cwd: KITH_DIR, encoding: "utf8" });
  const text = (result.stdout ?? "") + (result.stderr ?? "");
  const runDir = process.env.KITH_E2E_RUN_DIR;
  if (!runDir) throw new Error("KITH_E2E_RUN_DIR is not set");
  writeFileSync(join(runDir, "files", "test-sidecar.log"), text);
  saveFile(info, "test-sidecar.log", text);
  expect(result.status).toBe(0);
});
