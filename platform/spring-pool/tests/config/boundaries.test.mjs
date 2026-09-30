import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const ROOT = new URL("../../", import.meta.url);

async function readText(rel) {
  try {
    return await readFile(new URL(rel, ROOT), "utf8");
  } catch (err) {
    throw new Error(
      `Cannot read ${rel} (required by config guards): ${err.message}`,
    );
  }
}

async function readJsonc(rel) {
  const src = await readText(rel);
  const cleaned = src
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (t.startsWith("//")) return "";
      if (t.startsWith("/*") && t.endsWith("*/")) return "";
      return line;
    })
    .join("\n")
    .replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Could not parse ${rel} as JSONC (whole-line comments and trailing commas stripped only): ${err.message}`,
    );
  }
}

function parseToml(src) {
  return JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        "import sys,json,tomllib; print(json.dumps(tomllib.loads(sys.stdin.read())))",
      ],
      { input: src, encoding: "utf8" },
    ),
  );
}

test("T-BOUND-1: API worker is private in every env and binds only D1", async () => {
  const config = parseToml(await readText("api/wrangler.toml"));

  const root = config;
  assert.ok(root.main, "api/wrangler.toml must set main to the built shim");
  assert.equal(root.workers_dev, false, "API must not expose workers.dev");
  assert.equal(root.preview_urls, false, "API must not expose preview URLs");
  assert.ok(
    !("routes" in root) && !("route" in root),
    "API must not define routes",
  );

  const staging = config.env.staging;
  assert.deepEqual(Object.keys(config.env), ["staging"]);
  assert.ok(
    !("routes" in staging) && !("route" in staging),
    "staging API must not define routes",
  );
  if ("workers_dev" in staging) assert.equal(staging.workers_dev, false);
  if ("preview_urls" in staging) assert.equal(staging.preview_urls, false);

  assert.equal(
    config.d1_databases?.[0]?.binding,
    "DB",
    "API must bind D1 as DB",
  );
  assert.equal(
    staging.d1_databases?.[0]?.binding,
    "DB",
    "staging API must bind D1 as DB",
  );
  assert.ok(config.vars?.BUILD_REVISION, "API should set BUILD_REVISION");

  for (const name of [...Object.keys(config), ...Object.keys(staging)]) {
    assert.ok(
      !/(kv_|r2_|queues|services)/.test(name),
      `unexpected binding section in api/wrangler.toml: ${name}`,
    );
  }
});

test("T-AUTH-4/T-BOUND-1: web staging is Access-only, previewless, and never binds D1", async () => {
  const web = await readJsonc("web/wrangler.jsonc");

  assert.equal(
    web.vars?.ENVIRONMENT,
    "local",
    "local vars must set ENVIRONMENT=local",
  );
  assert.equal(
    web.vars?.AUTH_MODE,
    "local",
    "local vars must set AUTH_MODE=local",
  );

  assert.ok(web.env?.staging, "web/wrangler.jsonc must define env.staging");
  const vars = web.env.staging.vars ?? {};
  assert.equal(
    vars.ENVIRONMENT,
    "staging",
    "staging must set ENVIRONMENT=staging",
  );
  assert.equal(vars.AUTH_MODE, "access", "staging must set AUTH_MODE=access");
  assert.equal(
    vars.ACCESS_TEAM_DOMAIN,
    "",
    "ACCESS_TEAM_DOMAIN must remain empty in public config; operator preflight supplies the value and runtime fails closed without it",
  );
  assert.equal(
    vars.ACCESS_AUD,
    "",
    "ACCESS_AUD must remain empty in public config; operator preflight supplies the value and runtime fails closed without it",
  );
  assert.equal(
    vars.OWNER_EMAIL,
    "",
    "OWNER_EMAIL must remain empty in public config; operator preflight supplies the value and runtime fails closed without it",
  );
  assert.ok(
    !("LOCAL_OWNER_EMAIL" in vars),
    "staging must never enable local auth",
  );
  assert.ok(
    !("LOCAL_OWNER_EMAIL" in (web.vars ?? {})),
    "LOCAL_OWNER_EMAIL belongs in .dev.vars, not wrangler.jsonc",
  );

  assert.equal(
    web.env.staging.workers_dev,
    true,
    "staging web is exposed on workers.dev",
  );
  assert.equal(
    web.env.staging.preview_urls,
    false,
    "staging web must not expose preview URLs",
  );
  assert.ok(
    !("routes" in web) && !("route" in web),
    "web must not define custom routes",
  );
  assert.ok(
    !("routes" in web.env.staging) && !("route" in web.env.staging),
    "web staging must not define custom routes",
  );

  const services = web.services ?? [];
  assert.ok(
    services.some((s) => s.binding === "API" && s.service),
    "web must bind the API service",
  );
  const stagingServices = web.env.staging.services ?? [];
  assert.ok(
    stagingServices.some((s) => s.binding === "API" && s.service),
    "web staging must bind the API service",
  );

  assert.ok(!("d1_databases" in web), "web must not bind D1");
  assert.ok(
    !("d1_databases" in web.env.staging),
    "web staging must not bind D1",
  );
});
