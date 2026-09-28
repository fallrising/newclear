// Rewrites the generated vectors under contracts/vectors/. Offline and deterministic.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GENERATED_VECTORS, render } from "./vectors.ts";

const dir = fileURLToPath(new URL("../../contracts/vectors/", import.meta.url));
for (const [file, build] of Object.entries(GENERATED_VECTORS)) {
  writeFileSync(dir + file, render(await build()));
  console.log(`wrote contracts/vectors/${file}`);
}
