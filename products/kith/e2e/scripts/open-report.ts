import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { artifactsRoot, PLAYWRIGHT_BIN } from "../harness/paths.ts";

// npm run e2e:open -- [run_id]  (latest run folder when omitted)

const root = artifactsRoot();
const runId =
  process.argv[2] ??
  readdirSync(root)
    .filter((n) => statSync(join(root, n)).isDirectory())
    .sort()
    .pop();
if (runId === undefined) throw new Error("no run folders under " + root);
spawnSync(PLAYWRIGHT_BIN, ["show-report", join(root, runId, "report")], { stdio: "inherit" });
