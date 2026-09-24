import { rmSync } from "node:fs";
import { join } from "node:path";
import { stopStack } from "./harness/server.ts";

// The secret file is removed by the reporter: onEnd runs after teardown and still needs it.
export default async function globalTeardown(): Promise<void> {
  await stopStack();
  const runDir = process.env.KITH_E2E_RUN_DIR;
  if (runDir && process.env.KITH_E2E_KEEP_STATE !== "1") rmSync(join(runDir, "state"), { recursive: true, force: true });
}
