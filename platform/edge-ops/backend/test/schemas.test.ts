// The JSON Schemas are descriptive, but their field sets must not drift from the normative
// vectors: every valid vector document has exactly the schema's properties, all required.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p: string) => JSON.parse(readFileSync(new URL(`../../contracts/${p}`, import.meta.url), "utf8"));

function assertClosed(schema: { properties: object; required: string[]; additionalProperties: boolean }, name: string): string[] {
  const props = Object.keys(schema.properties).sort();
  assert.deepEqual([...schema.required].sort(), props, `${name}: every property is required`);
  assert.equal(schema.additionalProperties, false, `${name}: closed object`);
  return props;
}

test("schemas are closed and match valid vector documents", () => {
  const telemetry = read("schemas/telemetry-report.v1.schema.json");
  const tv = read("vectors/telemetry.json");
  assert.deepEqual(assertClosed(telemetry, "telemetry"), Object.keys(tv.base).sort());
  assert.deepEqual(assertClosed(telemetry.properties.metrics, "metrics"), Object.keys(tv.base.metrics).sort());
  assert.equal(telemetry.properties.schema_version.const, tv.base.schema_version);

  const run = read("vectors/run-approval.json").cases.find((c: { name: string }) => c.name === "valid");
  const manifest = JSON.parse(run.manifest_text);
  const approval = JSON.parse(run.approval_text);
  const ms = read("schemas/run-manifest.v1.schema.json");
  const as = read("schemas/run-approval.v1.schema.json");
  assert.deepEqual(assertClosed(ms, "run manifest"), Object.keys(manifest).sort());
  assert.deepEqual(assertClosed(as, "approval"), Object.keys(approval).sort());
  assert.equal(ms.properties.schema_version.const, manifest.schema_version);
  assert.equal(as.properties.schema_version.const, approval.schema_version);

  const enroll = JSON.parse(read("vectors/enroll-proof.json").cases.find((c: { name: string }) => c.name === "valid").request_text);
  const es = read("schemas/enroll-request.v1.schema.json");
  assert.deepEqual(assertClosed(es, "enroll"), Object.keys(enroll).sort());
  assert.equal(es.properties.schema_version.const, enroll.schema_version);
});

test("openapi references only existing schema files", () => {
  const text = readFileSync(new URL("../../contracts/openapi.yaml", import.meta.url), "utf8");
  const refs = [...text.matchAll(/\$ref: '?\.\/schemas\/([a-z0-9.-]+\.json)'?/g)].map((m) => m[1]!);
  assert.deepEqual([...new Set(refs)].sort(), ["enroll-request.v1.schema.json", "error.v1.schema.json", "run-approval.v1.schema.json", "telemetry-report.v1.schema.json"]);
  for (const r of refs) assert.doesNotThrow(() => read(`schemas/${r}`), r);
});
