import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { CONTRACTS_DIR } from "./paths.ts";

// Validates one run folder against the contracts and its own hashes (docs/v2/milestones/W0.md §5.1.10).

export type RunValidation = { ok: boolean; problems: string[]; manifest: unknown };

type ManifestShape = {
  run_id?: string;
  files?: { path: string; sha256: string; bytes: number }[];
  results?: { evidence?: { path?: string; sha256?: string }[] }[];
};

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function schemaErrors(schemaFile: string, data: unknown, label: string): string[] {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const schema = JSON.parse(readFileSync(join(CONTRACTS_DIR, schemaFile), "utf8")) as object;
  if (ajv.validate(schema, data)) return [];
  return (ajv.errors ?? []).map((e) => `${label} schema: ${e.instancePath} ${e.message ?? ""}`.trim());
}

export function validateRunDir(runDir: string): RunValidation {
  const manifestFile = join(runDir, "manifest.json");
  if (!existsSync(manifestFile)) return { ok: false, problems: ["missing manifest.json"], manifest: null };
  const problems: string[] = [];
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as unknown;
  problems.push(...schemaErrors("e2e-manifest.json", manifest, "manifest"));

  const seedFile = join(runDir, "seed.json");
  if (existsSync(seedFile)) problems.push(...schemaErrors("e2e-seed.json", JSON.parse(readFileSync(seedFile, "utf8")), "seed"));
  else problems.push("missing seed.json");

  const m = manifest as ManifestShape;
  for (const f of m.files ?? []) {
    const abs = join(runDir, f.path);
    if (!existsSync(abs) || statSync(abs).size !== f.bytes || sha256File(abs) !== f.sha256) problems.push("file mismatch: " + f.path);
  }
  for (const r of m.results ?? []) {
    for (const e of r.evidence ?? []) {
      if (e.path === undefined) continue;
      const abs = join(runDir, e.path);
      if (!existsSync(abs) || sha256File(abs) !== e.sha256) problems.push("evidence mismatch: " + e.path);
    }
  }
  const summaryFile = join(runDir, "summary.md");
  if (!existsSync(summaryFile) || m.run_id === undefined || !readFileSync(summaryFile, "utf8").includes(m.run_id)) {
    problems.push("summary missing run_id");
  }
  for (const dir of ["screenshots", "api", "ws"]) {
    if (!existsSync(join(runDir, dir))) problems.push("missing dir: " + dir);
  }
  return { ok: problems.length === 0, problems, manifest };
}
