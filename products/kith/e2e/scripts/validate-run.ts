import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { artifactsRoot } from "../harness/paths.ts";
import { validateRunDir } from "../harness/validate.ts";

// npm run e2e:validate -- [run_id]  (latest run folder when omitted)

function latestRunId(): string {
  const root = artifactsRoot();
  const dirs = readdirSync(root).filter((n) => statSync(join(root, n)).isDirectory()).sort();
  const last = dirs[dirs.length - 1];
  if (last === undefined) throw new Error("no run folders under " + root);
  return last;
}

const runId = process.argv[2] ?? latestRunId();
const r = validateRunDir(join(artifactsRoot(), runId));
if (r.ok) {
  console.log("ok " + runId);
} else {
  for (const p of r.problems) console.log(p);
  process.exit(1);
}
