import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { distributionDirectory, projectRoot } from "./build-paths.mjs";

const build = process.env.AGENT_BUILD_DIR || projectRoot;
mkdirSync(build, { recursive: true });
const tsc = resolve(projectRoot, "node_modules/typescript/bin/tsc");
const vite = resolve(projectRoot, "node_modules/vite/bin/vite.js");
const commands = [
  [tsc, "--project", "tsconfig.app.json", "--incremental", "--tsBuildInfoFile", join(build, "app.tsbuildinfo")],
  [tsc, "--project", "tsconfig.node.json", "--tsBuildInfoFile", join(build, "node.tsbuildinfo")],
  [vite, "build", "--outDir", distributionDirectory()],
];
for (const args of commands) {
  const result = spawnSync(process.execPath, args, { cwd: projectRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
