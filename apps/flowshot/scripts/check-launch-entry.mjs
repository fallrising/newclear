import {
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distributionDirectory = resolve(repositoryRoot, "dist");
const indexHtml = readFileSync(
  resolve(distributionDirectory, "index.html"),
  "utf8",
);
const entryMatch = indexHtml.match(
  /<script type="module"[^>]+src="([^"]+)"/u,
);

if (entryMatch === null) {
  throw new Error("production index does not contain a module entry");
}

const entryPath = resolve(
  distributionDirectory,
  entryMatch[1].replace(/^\//u, ""),
);
const entrySource = readFileSync(entryPath, "utf8");
const entryBytes = statSync(entryPath).size;

if (!entrySource.includes("get_build_info")) {
  throw new Error("launch entry does not contain the build-info command");
}

if (entryBytes >= 20_000) {
  throw new Error(
    `launch entry is ${entryBytes} bytes; expected a pre-React entry under 20000 bytes`,
  );
}

console.log(
  JSON.stringify({
    event: "launch_entry_check",
    entry: entryPath.slice(repositoryRoot.length + 1),
    entryBytes,
    result: "pass",
  }),
);
