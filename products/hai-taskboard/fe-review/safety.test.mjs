import test from "node:test";
import assert from "node:assert/strict";
import { artifactJSON, privateDirectory, fixtureManifest } from "./safety.mjs";
import { mkdtempSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("artifact refuses secret and encoded secret before serialization is released", () => {
  const secret = "synthetic-secret-for-test-only";
  for (const value of [
    secret,
    Buffer.from(secret).toString("base64"),
    encodeURIComponent(secret),
  ])
    assert.throws(() => artifactJSON({ message: value }, [secret]));
  assert.equal(
    JSON.parse(artifactJSON({ passed: true }, [secret])).passed,
    true,
  );
});
test("private state must be owned mode0700 and outside checkout", () => {
  const dir = mkdtempSync(join(tmpdir(), "hai-review-test-"));
  try {
    chmodSync(dir, 0o700);
    assert.equal(privateDirectory(dir, "/unrelated-checkout"), dir);
    assert.throws(() => privateDirectory(dir, dir));
    chmodSync(dir, 0o755);
    assert.throws(() => privateDirectory(dir, "/unrelated-checkout"));
  } finally {
    rmSync(dir, { recursive: true });
  }
});
test("synthetic manifest binds actual work-item and exact AC bytes to current recipe", () => {
  const fixture = fixtureManifest(
    "wi_0123456789ABCDEFGHJK",
    "exact synthetic bytes\n",
  );
  assert.deepEqual(fixture.nodes[0].work_item_ids, ["wi_0123456789ABCDEFGHJK"]);
  assert.equal(fixture.nodes[0].required_ac_revisions[0].ac_id, "local");
  assert.equal(
    fixture.nodes[0].required_ac_revisions[0].ac_revision_digest,
    "26313e8a49cdc4d5ce03b83ee22be4d9b9d8c97b11ed7d8b0d1d96982549cb57",
  );
  assert.equal(
    fixture.nodes[0].recipe_digest,
    "31c92e9bb359a30771fcf35a409d26ea0f5d9c1769d887354ddc6d47e7eaa817",
  );
});

import { acceptanceReference, resumeItem } from "./safety.mjs";
const originalProject = "prj_WBX1HSW519EAN7BS1D2H";
const acceptedHistory = {
  commands: [
    {
      operation: "AcceptInitialSpecification",
      commandID: "cmd_PR3ZMD0NE0YJGQTPS4S4",
      path: "/api/v1/projects/" + originalProject + "/commands",
    },
  ],
  shutdown: [{ exit: 0 }],
};
test("resume binds original command/project identity and completed owned shutdown", () => {
  assert.equal(acceptanceReference(acceptedHistory).project, originalProject);
  assert.throws(() =>
    acceptanceReference({ ...acceptedHistory, commands: [] }),
  );
  assert.throws(() =>
    acceptanceReference({ ...acceptedHistory, shutdown: [] }),
  );
  assert.throws(() =>
    acceptanceReference({
      ...acceptedHistory,
      commands: [{ ...acceptedHistory.commands[0], commandID: undefined }],
    }),
  );
  assert.throws(() =>
    acceptanceReference({
      ...acceptedHistory,
      commands: [
        {
          ...acceptedHistory.commands[0],
          path: "/api/v1/projects/other/commands",
        },
      ],
    }),
  );
});
test("remaining-fault resume accepts only the actual completed Developing subject and never a Draft or running Fake", () => {
  const item = {
    work_item_id: "wi_0123456789ABCDEFGHJK",
    phase: "Developing",
    current_run: { observed_state: "Succeeded" },
  };
  const board = {
    projection: {
      project_id: originalProject,
      lanes: [
        { key: "Draft", items: [] },
        { key: "Developing", items: [item] },
      ],
    },
  };
  assert.equal(resumeItem(board, originalProject, true), item);
  assert.throws(() => resumeItem(board, originalProject, false));
  assert.throws(() => resumeItem(board, "prj_0123456789ABCDEFGHJK", true));
  assert.throws(() =>
    resumeItem(
      {
        projection: {
          ...board.projection,
          lanes: [
            {
              key: "Developing",
              items: [{ ...item, current_run: { observed_state: "Running" } }],
            },
          ],
        },
      },
      originalProject,
      true,
    ),
  );
});

import { cleanupOwned } from "./safety.mjs";
for (const rejectedStage of ["context", "browser"])
  test(
    "owned stop and receipt path remain reachable after " +
      rejectedStage +
      " close rejection",
    async () => {
      const calls = [];
      const close = (stage) => async () => {
        calls.push(stage);
        if (stage === rejectedStage)
          throw new Error("synthetic " + stage + " rejection");
      };
      let errors;
      try {
        errors = await cleanupOwned(
          { close: close("context") },
          { close: close("browser") },
          close("runtime"),
        );
      } catch {}
      assert.deepEqual(calls, ["context", "browser", "runtime"]);
      assert.deepEqual(
        errors.map((error) => error.stage),
        [rejectedStage],
      );
    },
  );
test("runtime cleanup error remains explicit after all close attempts", async () => {
  const calls = [];
  const errors = await cleanupOwned(
    { close: async () => calls.push("context") },
    { close: async () => calls.push("browser") },
    async () => {
      calls.push("runtime");
      throw new Error("synthetic runtime outcome unknown");
    },
  );
  assert.deepEqual(calls, ["context", "browser", "runtime"]);
  assert.equal(errors[0].stage, "runtime");
  assert.match(errors[0].error.message, /outcome unknown/);
});
