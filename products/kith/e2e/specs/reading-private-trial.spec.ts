import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BrowserContext, Page } from "@playwright/test";
import { runExport } from "../../reading/export.ts";
import type { TrialConfig } from "../../reading/trial.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi } from "../fixtures/actors.ts";
import { test, expect } from "../fixtures/kith.ts";
import { buildSeed } from "../fixtures/seed.ts";
import { note, shot } from "../harness/evidence.ts";
import { KITH_DIR, WRANGLER_BIN } from "../harness/paths.ts";
import { request } from "../harness/reading-db.ts";
import { ARTICLE_A, commitContent, exportRepo, git, writeRegistry } from "../harness/reading-fixture.ts";
import { recordObservedSecret } from "../harness/redact.ts";
import { startStack, stopStack, wranglerEnv } from "../harness/server.ts";

function localSql(state: string, sql: string): Record<string, unknown>[] {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : entry.name.endsWith(".sqlite") ? [path] : [];
  });
  for (const path of walk(join(state, "v3", "d1"))) {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='members'").get()) return db.prepare(sql).all() as Record<string, unknown>[];
    } finally { db.close(); }
  }
  throw new Error("private-trial isolated D1 not found");
}

async function seedTrial(state: string): Promise<void> {
  mkdirSync(state, { recursive: true });
  const seedFile = join(state, "seed.sql");
  writeFileSync(seedFile, (await buildSeed()).sql);
  for (const args of [
    ["d1", "migrations", "apply", "kith", "--local", "--persist-to", state],
    ["d1", "execute", "kith", "--local", "--persist-to", state, "--file", seedFile, "-y"],
  ]) {
    const result = spawnSync(WRANGLER_BIN, args, { cwd: KITH_DIR, env: wranglerEnv(), encoding: "utf8", timeout: 60_000 });
    expect(result.status, "isolated local D1 migration/seed").toBe(0);
  }
}

async function saveCapture(page: Page, body: string): Promise<string> {
  await page.goto("/captures");
  await page.getByTestId("capture-body").fill(body);
  const response = page.waitForResponse((res) => new URL(res.url()).pathname === "/api/captures" && res.request().method() === "POST");
  await page.getByTestId("capture-save").click();
  expect((await response).status()).toBe(201);
  await expect(page.getByTestId("capture-status")).toContainText(/已保存|saved/i);
  return (await (await response).json() as { capture_id: string }).capture_id;
}

test("E2E-PT-01 prepared private release capture note export update and failed build @mobile", { tag: ["@PT"] }, async ({ browser, recorder }, info) => {
  test.setTimeout(480_000);
  // Import inside the test: RED is the missing preparation capability, after the real harness starts.
  const { preflight, prepareRelease, verifyRelease } = await import("../../reading/trial.ts");
  const { repo, remote, rival } = exportRepo(`private-trial-${info.project.name}`);
  writeRegistry(rival);
  writeFileSync(join(rival, "a.md"), "# Private trial synthetic article\n\nAI version one.\n");
  writeFileSync(join(rival, "b.md"), "# Synthetic B\n\nStable second article.\n");
  const firstCommit = commitContent(rival, "private trial synthetic article source");
  git(rival, "push", "origin", "main");
  git(repo, "pull", "--ff-only");
  const root = join(process.env.KITH_E2E_RUN_DIR!, "state", `trial-stack-${info.project.name}`);
  const state = join(root, "state");
  const releaseRoot = join(root, "releases");
  mkdirSync(releaseRoot, { recursive: true, mode: 0o700 });
  const tokenFile = join(root, "export-token");
  writeFileSync(tokenFile, "kith_export_synthetic_preflight_only", { mode: 0o600 });
  const config: TrialConfig = {
    version: 1, appDir: resolve(KITH_DIR), contentRepo: rival, contentCommit: firstCommit,
    registry: "articles.json", contentBranch: "main", contentRemote: remote,
    exportRepo: repo, exportBranch: "main", exportRemote: remote,
    baseUrl: "http://127.0.0.1:9", tokenFile, releaseRoot,
  };
  await preflight(config);
  const first = await prepareRelease(config);
  const current = join(releaseRoot, "current");
  expect(realpathSync(current)).toBe(first.releaseDir);
  await verifyRelease(current, firstCommit);
  const firstBundle = readFileSync(join(current, "assets", "_reading", "current.json"));
  expect(JSON.parse(firstBundle.toString()).commit).toBe(firstCommit);
  await seedTrial(state);
  const originalBaseUrl = process.env.KITH_E2E_BASE_URL;
  let context: BrowserContext | undefined;
  let started = false;
  try {
    // This process owns a second CF stack; the global regression stack stays untouched.
    started = true;
    let stack = await startStack(root, state, join(first.releaseDir, "assets"));
    const open = async (): Promise<Page> => {
      process.env.KITH_E2E_BASE_URL = stack.baseUrl;
      context = await browser.newContext({ ...info.project.use, baseURL: stack.baseUrl });
      const page = await context.newPage();
      recorder.watch(page, "private-trial");
      await loginViaUi(page, ACCOUNTS.ada);
      return page;
    };
    let page = await open();
    const messages = localSql(state, "SELECT * FROM messages ORDER BY id");
    const providerCalls = async (): Promise<unknown> => (await fetch(stack.fakeProviderUrl + "/__log")).json();
    const providers = await providerCalls();
    config.baseUrl = stack.apiOrigin;
    await page.goto(`/reading/${ARTICLE_A}`);
    await expect(page.getByTestId("reading-commit")).toContainText(firstCommit);
    await expect(page.getByTestId("reading-body")).toContainText("AI version one.");
    const humanNote = `  Human supplement ${info.project.name}\n\n原始文字 📝  `;
    await page.getByTestId("note-body").fill(humanNote);
    await page.getByTestId("note-save").click();
    await expect(page.getByTestId("note-status")).toContainText(/已保存|saved/i);
    const noteBefore = localSql(state, "SELECT * FROM notes ORDER BY id")[0]!;
    expect(noteBefore.body).toBe(humanNote);
    const captureBody = `  Trial capture ${info.project.name}\n原文  `;
    const captureId = await saveCapture(page, captureBody);
    const issued = await request(page.request, "POST", "/api/reading-export/tokens", {});
    expect(issued.status()).toBe(201);
    const credential = await issued.json() as { id: string; token: string };
    recordObservedSecret(credential.token);
    writeFileSync(tokenFile, credential.token);
    chmodSync(tokenFile, 0o600);
    await preflight(config);
    const exportOptions = { repo, branch: "main", baseUrl: stack.apiOrigin, token: credential.token };
    expect((await runExport(exportOptions)).complete).toBe(true);
    const remoteRecord = (kind: string, id: string): Record<string, unknown> => JSON.parse(git(remote, "show", `main:${kind}/${id}.json`)) as Record<string, unknown>;
    expect(remoteRecord("captures", captureId).body).toBe(captureBody);
    expect(remoteRecord("notes", String(noteBefore.id))).toMatchObject({ body: humanNote, revision: noteBefore.revision });
    for (const row of [...localSql(state, "SELECT exported_commit FROM captures"), ...localSql(state, "SELECT exported_commit FROM notes")]) {
      expect(row.exported_commit).toMatch(/^[a-f0-9]{40}$/);
      expect(git(remote, "merge-base", "--is-ancestor", String(row.exported_commit), "main")).toBe("");
    }
    const exportedHead = git(remote, "rev-parse", "main");
    await runExport(exportOptions);
    expect(git(remote, "rev-parse", "main")).toBe(exportedHead);
    const persistedNotes = localSql(state, "SELECT * FROM notes ORDER BY id");
    git(rival, "pull", "--ff-only");
    writeFileSync(join(rival, "a.md"), "# Private trial synthetic article\n\nAI version two.\n");
    const secondCommit = commitContent(rival, "private trial synthetic content update");
    git(rival, "push", "origin", "main");
    config.contentCommit = secondCommit;
    const second = await prepareRelease(config);
    await verifyRelease(current, secondCommit);
    expect(realpathSync(current)).toBe(second.releaseDir);
    expect(readFileSync(join(first.releaseDir, "assets", "_reading", "current.json"))).toEqual(firstBundle);
    expect(localSql(state, "SELECT * FROM notes ORDER BY id")).toEqual(persistedNotes);
    expect(localSql(state, "SELECT * FROM messages ORDER BY id")).toEqual(messages);
    expect(await providerCalls()).toEqual(providers);

    // A local restart models selecting the verified immutable deployment directory, preserving D1.
    await context?.close(); context = undefined;
    await stopStack(state); started = false;
    started = true;
    stack = await startStack(root, state, join(second.releaseDir, "assets"));
    page = await open();
    await page.goto(`/reading/${ARTICLE_A}`);
    await expect(page.getByTestId("reading-commit")).toContainText(secondCommit);
    await expect(page.getByTestId("reading-body")).toContainText("AI version two.");
    await expect(page.getByTestId("note-body")).toHaveValue(humanNote);
    const previous = realpathSync(current);
    const previousBundle = readFileSync(join(current, "assets", "_reading", "current.json"));
    let buildReached = false;
    await expect(prepareRelease(config, { buildWeb: async () => {
      buildReached = true;
      throw new Error("synthetic web build failure");
    } })).rejects.toThrow();
    expect(buildReached).toBe(true);
    expect(realpathSync(current)).toBe(previous);
    expect(readFileSync(join(current, "assets", "_reading", "current.json"))).toEqual(previousBundle);
    await verifyRelease(current, secondCommit);
    await page.reload();
    await expect(page.getByTestId("reading-commit")).toContainText(secondCommit);
    await expect(page.getByTestId("reading-body")).toContainText("AI version two.");
    await expect(page.getByTestId("note-body")).toHaveValue(humanNote);
    const pendingId = await saveCapture(page, `capture after failed build ${randomUUID()}`);
    expect(localSql(state, "SELECT id, exported_commit FROM captures").find((row) => row.id === pendingId)?.exported_commit).toBeNull();
    const revoked = await request(page.request, "DELETE", `/api/reading-export/tokens/${credential.id}`);
    expect(revoked.status()).toBe(204);
    await expect(runExport({ ...exportOptions, baseUrl: stack.apiOrigin })).rejects.toThrow();
    expect(localSql(state, "SELECT id, exported_commit FROM captures").find((row) => row.id === pendingId)?.exported_commit).toBeNull();
    expect(localSql(state, "SELECT * FROM notes ORDER BY id")).toEqual(persistedNotes);
    expect(localSql(state, "SELECT * FROM messages ORDER BY id")).toEqual(messages);
    expect(await providerCalls()).toEqual(providers);
    await page.goto(`/reading/${ARTICLE_A}`);
    await shot(page, info, "prepared-release-survives-failed-build");
    note(info, "Real web builds, exact synthetic Git commits, complete release verification and isolated CF assets; UI captures/notes export to bare remote before ACK. Updated AI content preserves D1 notes; build failure keeps current and reload-readable assets. Revoked token leaves new capture pending; no chat/provider changes. Local fixture only.");
  } finally {
    await context?.close();
    if (started) await stopStack(state);
    process.env.KITH_E2E_BASE_URL = originalBaseUrl;
  }
});
