// AC-CON-01 (TS side): the shared vectors in contracts/vectors/ must pass unchanged.
// The Go twin runs the same files in agent/internal/contract/vectors_test.go.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fromBase64Url, fromHex, utf8Encode } from "../src/domain/contract/bytes.ts";
import { parseAndVerifyEnroll } from "../src/domain/contract/enrollment.ts";
import { parseUtcSeconds } from "../src/domain/contract/fields.ts";
import { verifyRequest, type Purpose } from "../src/domain/contract/requestAuth.ts";
import { verifyRunApproval } from "../src/domain/contract/runManifest.ts";
import { parseStrictJson } from "../src/domain/contract/strictJson.ts";
import { parseTelemetryReport } from "../src/domain/contract/telemetry.ts";
import { GENERATED_VECTORS, render } from "../tools/vectors.ts";

type Expect = { ok: true; token_hash?: string } | { ok: false; code: string; field?: string };

const vectors = (name: string) => JSON.parse(readFileSync(new URL(`../../contracts/vectors/${name}`, import.meta.url), "utf8"));

async function outcome(fn: () => unknown): Promise<{ ok: true; value: unknown } | { ok: false; code: string; field?: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    const e = err as { code?: string; field?: string };
    if (typeof e.code !== "string") throw err;
    return { ok: false, code: e.code, field: e.field };
  }
}

function check(name: string, got: Awaited<ReturnType<typeof outcome>>, expect: Expect): void {
  if (expect.ok) {
    assert.equal(got.ok, true, `${name}: expected ok, got ${JSON.stringify(got)}`);
    return;
  }
  assert.equal(got.ok, false, `${name}: expected ${expect.code}, got ok`);
  if (got.ok) return;
  assert.equal(got.code, expect.code, `${name}: code`);
  if (expect.field !== undefined) assert.equal(got.field, expect.field, `${name}: field`);
}

test("generated vectors are up to date", async () => {
  for (const [file, build] of Object.entries(GENERATED_VECTORS)) {
    const committed = readFileSync(new URL(`../../contracts/vectors/${file}`, import.meta.url), "utf8");
    assert.equal(committed, render(await build()), `${file} drifted; run npm run vectors`);
  }
});

test("strict JSON vectors", async () => {
  const v = vectors("strict-json.json");
  for (const c of v.cases) {
    const bytes = c.input_hex !== undefined ? fromHex(c.input_hex) : utf8Encode(c.input);
    check(c.name, await outcome(() => parseStrictJson(bytes, c.max_bytes ?? v.max_bytes)), c.expect);
  }
});

function applyPatch(base: unknown, set: Record<string, unknown> = {}, del: string[] = []): unknown {
  const doc = structuredClone(base) as Record<string, unknown>;
  const walk = (path: string): [Record<string, unknown>, string] => {
    const parts = path.split(".");
    let o = doc;
    for (const p of parts.slice(0, -1)) o = o[p] as Record<string, unknown>;
    return [o, parts[parts.length - 1]!];
  };
  for (const [path, value] of Object.entries(set)) {
    const [o, k] = walk(path);
    o[k] = value;
  }
  for (const path of del) {
    const [o, k] = walk(path);
    delete o[k];
  }
  return doc;
}

test("telemetry vectors", async () => {
  const v = vectors("telemetry.json");
  for (const c of v.cases) {
    const text = c.input ?? JSON.stringify(applyPatch(v.base, c.set, c.delete));
    check(c.name, await outcome(() => parseTelemetryReport(utf8Encode(text))), c.expect);
  }
});

test("run approval vectors", async () => {
  const v = vectors("run-approval.json");
  const keys = new Map(Object.entries(v.trusted_keys as Record<string, string>).map(([k, b]) => [k, fromBase64Url(b)!]));
  for (const c of v.cases) {
    const binding = { ...c.binding, now: parseUtcSeconds(c.binding.now)! };
    check(c.name, await outcome(() => verifyRunApproval(utf8Encode(c.manifest_text), utf8Encode(c.approval_text), keys, binding)), c.expect);
  }
});

test("request signing vectors", async () => {
  const v = vectors("request-signing.json");
  const creds = v.credentials as Record<string, string>;
  for (const c of v.cases) {
    const r = c.request;
    const got = await outcome(() =>
      verifyRequest(
        { method: r.method, path: r.path, query: r.query, headers: r.headers, body: utf8Encode(r.body_text) },
        c.expected_purpose as Purpose,
        parseUtcSeconds(c.now)!,
        async (id) => (creds[id] ? fromBase64Url(creds[id]) : null),
      ),
    );
    check(c.name, got, c.expect);
  }
});

test("enrollment proof vectors", async () => {
  const v = vectors("enroll-proof.json");
  for (const c of v.cases) {
    const got = await outcome(() => parseAndVerifyEnroll(utf8Encode(c.request_text)));
    check(c.name, got, c.expect);
    if (got.ok && c.expect.token_hash) assert.equal((got.value as { tokenHash: string }).tokenHash, c.expect.token_hash);
  }
});
