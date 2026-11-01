import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import * as paths from "./build-paths.mjs";
import { distributionDirectory, tauriArguments } from "./build-paths.mjs";

test("Vite and Tauri use the same external artifact directory", () => {
  const env = { AGENT_BUILD_DIR: "/build with spaces" };
  assert.equal(distributionDirectory(env), "/build with spaces/dist");
  const args = tauriArguments(["build", "--debug", "--no-bundle", "--ci"], env);
  assert.deepEqual(args.slice(0, -2), ["build", "--debug", "--no-bundle", "--ci"]);
  assert.equal(args.at(-2), "--config");
  assert.equal(JSON.parse(args.at(-1)).build.frontendDist, distributionDirectory(env));
  assert.deepEqual(tauriArguments(["info"], env), ["info"]);
  assert.equal(distributionDirectory({}), resolve("dist"));
});

test("relative Cargo output remains stable when Tauri changes working directory", () => {
  const env = { CARGO_TARGET_DIR: "relative-target", AGENT_BUILD_DIR: "/build" };
  const result = paths.tauriEnvironment(env);
  assert.equal(result.CARGO_TARGET_DIR, resolve("relative-target"));
  assert.equal(result.AGENT_BUILD_DIR, "/build");
  assert.equal(env.CARGO_TARGET_DIR, "relative-target");
  assert.equal(paths.tauriEnvironment({}).CARGO_TARGET_DIR, undefined);
});
