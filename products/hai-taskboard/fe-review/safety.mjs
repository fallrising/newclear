import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
export function artifactJSON(value, secrets) {
  const output = JSON.stringify(value, null, 2) + "\n";
  for (const secret of secrets) {
    assert(secret.length >= 12, "invalid secret guard");
    for (const representation of [
      secret,
      Buffer.from(secret).toString("base64"),
      encodeURIComponent(secret),
    ])
      assert(
        !output.includes(representation),
        "artifact contains protected secret",
      );
  }
  return output;
}
export function privateDirectory(directory, checkout) {
  const absolute = resolve(directory),
    tree = resolve(checkout),
    info = lstatSync(absolute);
  assert(
    info.isDirectory() &&
      !info.isSymbolicLink() &&
      info.uid === process.getuid() &&
      (info.mode & 0o777) === 0o700,
    "private state ownership/mode invalid",
  );
  assert(
    realpathSync(absolute) === absolute,
    "private state path has a symlink",
  );
  assert(
    absolute !== tree &&
      !absolute.startsWith(tree + sep) &&
      !tree.startsWith(absolute + sep),
    "private state must be separate from checkout",
  );
  return absolute;
}
export function fixtureManifest(workItem, acBytes) {
  assert(
    /^wi_[0-9A-HJKMNP-TV-Z]+$/.test(workItem),
    "actual work-item identity required",
  );
  return {
    schema_version: 1,
    nodes: [
      {
        id: "REVIEW-SYNTHETIC",
        path: "spec.txt",
        required: true,
        work_item_ids: [workItem],
        required_ac_revisions: [
          { ac_id: "local", ac_revision_digest: sha256(acBytes) },
        ],
        recipe_digest: sha256("local-recipe-v1"),
      },
    ],
    edges: [],
  };
}

export function acceptanceReference(previous) {
  const accepted = previous.commands
    .filter((command) => command.operation === "AcceptInitialSpecification")
    .at(-1);
  assert(
    accepted && /^cmd_[0-9A-HJKMNP-TV-Z]{20}$/.test(accepted.commandID),
    "original accepted command identity required",
  );
  const match =
    /^\/api\/v1\/projects\/(prj_[0-9A-HJKMNP-TV-Z]{20})\/commands$/.exec(
      accepted.path,
    );
  assert(match, "original accepted project path required");
  assert(
    previous.shutdown.length > 0 &&
      previous.shutdown.every((value) => value.exit === 0),
    "completed owned graceful lifecycle required",
  );
  return { ...accepted, project: match[1] };
}
export function resumeItem(board, project, remaining) {
  assert.equal(
    board.projection.project_id,
    project,
    "resume project must match original command",
  );
  const phase = remaining ? "Developing" : "Draft";
  const items = board.projection.lanes.find(
    (lane) => lane.key === phase,
  )?.items;
  assert.equal(items?.length, 1, "one expected synthetic subject required");
  const item = items[0];
  assert.equal(item.phase, phase);
  assert(
    /^wi_[0-9A-HJKMNP-TV-Z]{20}$/.test(item.work_item_id),
    "actual work item identity required",
  );
  if (remaining) assert.equal(item.current_run?.observed_state, "Succeeded");
  else assert.equal(item.current_run ?? null, null);
  return item;
}

export async function cleanupOwned(context, browser, stop) {
  const errors = [];
  for (const [stage, close] of [
    ["context", () => context?.close()],
    ["browser", () => browser?.close()],
    ["runtime", stop],
  ]) {
    try {
      await close();
    } catch (error) {
      errors.push({ stage, error });
    }
  }
  return errors;
}
