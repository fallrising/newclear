import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { APIRequestContext, Page, TestInfo } from "@playwright/test";
import { runExport } from "../../reading/export.ts";
import { test, expect } from "../fixtures/kith.ts";
import { loginViaUi } from "../fixtures/actors.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { fakeProviderLog } from "../fixtures/console.ts";
import { note, shot } from "../harness/evidence.ts";
import { query, request } from "../harness/reading-db.ts";
import { ARTICLE_A, ARTICLE_B, BUNDLE_PATH, commitContent, contentRepo, exportRepo, git, publishContent, writeRegistry } from "../harness/reading-fixture.ts";
import { recordObservedSecret } from "../harness/redact.ts";

type Note = { id: string; article_id: string; body: string; revision: number; updated_at: string; exported_commit: string | null };
async function saveNote(client: APIRequestContext, article: string, body: string): Promise<Note> {
  const current = await request(client, "GET", `/api/notes/${article}`);
  expect(current.status()).toBe(200);
  const previous = (await current.json() as { note: Note | null }).note;
  const result = await request(client, "PUT", `/api/notes/${article}`, { body, revision: previous?.revision ?? 0 });
  expect(result.status()).toBe(previous ? 200 : 201);
  return (await result.json() as { note: Note }).note;
}
async function token(client: APIRequestContext): Promise<{ id: string; token: string }> {
  const result = await request(client, "POST", "/api/reading-export/tokens", {});
  expect(result.status()).toBe(201);
  const credential = await result.json() as { id: string; token: string };
  recordObservedSecret(credential.token);
  return credential;
}
async function capture(client: APIRequestContext, body: string): Promise<string> {
  const response = await request(client, "POST", "/api/captures", { body, client_key: randomUUID() });
  expect(response.status()).toBe(201);
  return (await response.json() as { capture_id: string }).capture_id;
}
function pendingCapture(id: string): unknown {
  return query("SELECT exported_commit FROM captures WHERE id = ?", id)[0]?.exported_commit;
}
function noteRow(id: string): Record<string, unknown> {
  const row = query("SELECT * FROM notes WHERE id = ?", id)[0];
  if (!row) throw new Error("expected isolated note");
  return row;
}
function remoteJson(remote: string, path: string): Record<string, unknown> {
  return JSON.parse(git(remote, "show", `main:${path}`)) as Record<string, unknown>;
}


async function exportRecovery(page: Page, info: TestInfo): Promise<void> {
  await loginViaUi(page, ACCOUNTS.ada);
  const messages = query("SELECT * FROM messages ORDER BY id");
  const providers = (await fakeProviderLog()).length;
  const credential = await token(page.request);
  const { repo, remote } = exportRepo("export-recovery");
  const options = { repo, branch: "main", baseUrl: process.env.KITH_E2E_API_ORIGIN!, token: credential.token };
  const bodies = ["  offline Runner capture 一\n", "offline Runner capture 二 📝  "];
  const stopped: string[] = [];
  for (const body of bodies) stopped.push(await capture(page.request, body));
  for (const id of stopped) expect(pendingCapture(id)).toBeNull();
  for (const stage of ["afterWrite", "afterCommit", "afterPush"] as const) {
    const id = await capture(page.request, `synthetic ${stage} capture`);
    let reached = false;
    await expect(runExport({ ...options, fault: (point) => {
      if (point === stage) { reached = true; throw new Error(`synthetic cut ${stage}`); }
    } })).rejects.toThrow(`synthetic cut ${stage}`);
    expect(reached).toBe(true);
    expect(pendingCapture(id)).toBeNull();
    const remoteBeforeRecovery = git(remote, "rev-parse", "main");
    const result = await runExport(options);
    expect(result.complete).toBe(true);
    const commit = pendingCapture(id);
    expect(commit).toMatch(/^[a-f0-9]{40}$/);
    expect(git(remote, "merge-base", "--is-ancestor", String(commit), "main")).toBe("");
    expect(remoteJson(remote, `captures/${id}.json`).body).toBe(`synthetic ${stage} capture`);
    if (stage === "afterPush") expect(git(remote, "rev-parse", "main")).toBe(remoteBeforeRecovery);
    const head = git(remote, "rev-parse", "main");
    await runExport(options);
    expect(git(remote, "rev-parse", "main"), "same snapshot does not create commits").toBe(head);
  }
  for (const [i, id] of stopped.entries()) expect(remoteJson(remote, `captures/${id}.json`).body).toBe(bodies[i]);
  const paths = git(remote, "ls-tree", "-r", "--name-only", "main").split("\n").filter((path) => path.startsWith("captures/"));
  expect(new Set(paths).size).toBe(paths.length);
  expect(paths).toHaveLength(query("SELECT id FROM captures").length);
  expect(query("SELECT * FROM messages ORDER BY id")).toEqual(messages);
  expect((await fakeProviderLog()).length).toBe(providers);
  note(info, "Actual local bare Git + D1: captures save while Runner is stopped; injected cuts after file writes, commit and pushed-before-ACK recover, confirmed remote hashes ACK once, identical reruns add no commits or paths.");
}

async function exportRace(page: Page, info: TestInfo): Promise<void> {
  // exportRecovery has already authenticated this browser.
  const messages = query("SELECT * FROM messages ORDER BY id");
  const providers = (await fakeProviderLog()).length;
  const credential = await token(page.request);
  const { repo, remote, rival } = exportRepo("export-note-race");
  const options = { repo, branch: "main", baseUrl: process.env.KITH_E2E_API_ORIGIN!, token: credential.token };
  const old = await saveNote(page.request, ARTICLE_A, "  D1 revision before push\n");
  let latest: Note | undefined;
  let raced = false;
  await runExport({ ...options, fault: async (stage, snapshot) => {
    if (stage !== "afterPush" || snapshot.kind !== "notes" || raced) return;
    raced = true;
    await expect(runExport(options), "another Runner cannot enter while snapshot is in flight").rejects.toThrow();
    latest = await saveNote(page.request, ARTICLE_A, "  D1 newer revision while old snapshot is pushed\n");
  } });
  expect(raced).toBe(true);
  expect(latest?.revision).toBe(old.revision + 1);
  expect(noteRow(old.id).exported_commit).toBeNull();
  expect(remoteJson(remote, `notes/${old.id}.json`).revision).toBe(old.revision);
  const stale = await page.request.post("/api/reading-export/ack", { headers: { Authorization: `Bearer ${credential.token}` }, data: { commit: git(remote, "rev-parse", "main"), captures: [], notes: [{ id: old.id, revision: old.revision }] } });
  expect(await stale.json()).toEqual({ captures: 0, notes: 0 });
  await runExport(options);
  expect(remoteJson(remote, `notes/${old.id}.json`)).toMatchObject({ body: latest?.body, revision: latest?.revision });
  expect(noteRow(old.id).exported_commit).toMatch(/^[a-f0-9]{40}$/);
  const acknowledged = noteRow(old.id);
  const replay = await page.request.post("/api/reading-export/ack", { headers: { Authorization: `Bearer ${credential.token}` }, data: { commit: git(remote, "rev-parse", "main"), captures: [], notes: [{ id: old.id, revision: latest!.revision }] } });
  expect(await replay.json()).toEqual({ captures: 0, notes: 0 });
  expect(noteRow(old.id)).toEqual(acknowledged);

  git(rival, "pull", "--ff-only");
  writeFileSync(join(rival, "notes", `${old.id}.json`), JSON.stringify({ ...remoteJson(remote, `notes/${old.id}.json`), body: "manual Git change" }));
  commitContent(rival, "manual synthetic note edit");
  git(rival, "push", "origin", "main");
  const events: { type: string; kind: string; id: string }[] = [];
  await runExport({ ...options, onEvent: (event) => { events.push(event); } });
  expect(events).toContainEqual({ type: "overwrite", kind: "notes", id: old.id });
  expect(remoteJson(remote, `notes/${old.id}.json`)).toMatchObject({ body: latest?.body, revision: latest?.revision });

  const pending = await capture(page.request, "push must reject after concurrent remote update");
  let rejected = false;
  await expect(runExport({ ...options, fault: (stage) => {
    if (stage !== "afterCommit" || rejected) return;
    rejected = true;
    git(rival, "pull", "--ff-only");
    writeFileSync(join(rival, "README.md"), "Concurrent unrelated owner edit.\n");
    commitContent(rival, "concurrent synthetic owner commit");
    git(rival, "push", "origin", "main");
  } })).rejects.toThrow();
  expect(rejected).toBe(true);
  expect(pendingCapture(pending)).toBeNull();
  expect(git(remote, "show", "main:README.md")).toBe("Concurrent unrelated owner edit.");
  expect(query("SELECT * FROM messages ORDER BY id")).toEqual(messages);
  expect((await fakeProviderLog()).length).toBe(providers);
  note(info, "Real remote note revision race leaves newer D1 pending; stale/replayed ACK changes zero; next export overwrites fixed path; manual Git note overwritten with event; concurrent Runner denied; actual non-fast-forward push rejection preserves pending D1 and owner commit.");
}

test("E2E-RC-05 exporter recovery revision races and real remote rejection", { tag: ["@RC"] }, async ({ page }, info) => {
  test.setTimeout(480_000);
  await exportRecovery(page, info);
  await exportRace(page, info);
});

test("E2E-RC-06 article rename auto refresh preserves human notes and unsaved editor @mobile", { tag: ["@RC"] }, async ({ page }, info) => {
  test.setTimeout(180_000);
  await loginViaUi(page, ACCOUNTS.ada);
  const messages = query("SELECT * FROM messages ORDER BY id");
  const providers = (await fakeProviderLog()).length;
  const suffix = info.project.name;
  let savedA = await saveNote(page.request, ARTICLE_A, `  human A ${suffix}\n\n**bold** 📝  `);
  const savedB = await saveNote(page.request, ARTICLE_B, `human B ${suffix}`);
  await page.goto(`/reading/${ARTICLE_A}`);
  await expect(page.getByTestId("note-body")).toHaveValue(savedA.body);
  const uiBody = `  UI raw human supplement ${suffix}\n\n**bold** 📝  `;
  await page.getByTestId("note-body").fill(uiBody);
  const saved = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/notes/${ARTICLE_A}` && response.request().method() === "PUT");
  await page.getByTestId("note-save").click();
  const response = await saved;
  expect(response.status()).toBe(200);
  savedA = (await response.json() as { note: Note }).note;
  expect(savedA.body).toBe(uiBody);
  expect(noteRow(savedA.id).body).toBe(uiBody);
  await expect(page.getByTestId("note-status")).toContainText(/已保存|saved/i);
  const notesBefore = query("SELECT * FROM notes ORDER BY id");
  const oldCommit = (await page.request.get("/api/reading")).json() as Promise<{ commit: string }>;
  await expect(page.getByTestId("reading-commit")).toContainText((await oldCommit).commit);
  await expect(page.getByTestId("reading-body").locator("h1")).toHaveCount(1);
  expect(await page.getByTestId("reading-body").locator("script,[href^='javascript:']").count()).toBe(0);
  const draft = `unsaved remains across build ${suffix}`;
  await page.getByTestId("note-body").fill(draft);
  const navigations: string[] = [];
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
  const repo = contentRepo();
  const nextPath = `renamed-${suffix}.md`;
  writeRegistry(repo, nextPath);
  writeFileSync(join(repo, nextPath), `# Synthetic A ${suffix} new\n\nAI body updated ${suffix}.\n\n- [B](/reading/${ARTICLE_B})\n`);
  const next = commitContent(repo, `renamed article stable id ${suffix}`);
  await publishContent(next);
  await expect(page.getByTestId("reading-commit")).toContainText(next, { timeout: 20_000 });
  await expect(page.getByTestId("reading-body")).toContainText(`AI body updated ${suffix}.`);
  await expect(page.getByTestId("note-body")).toHaveValue(draft);
  expect(navigations).toEqual([]);
  expect(query("SELECT * FROM notes ORDER BY id")).toEqual(notesBefore);
  const positions = await page.evaluate(() => {
    const body = document.querySelector('[data-testid="reading-body"]')!;
    const note = document.querySelector('[data-testid="note-body"]')!;
    const divider = document.querySelector("main hr, [data-testid='reading-divider']");
    return { bodyBeforeNote: !!(body.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING), dividerPresent: divider !== null };
  });
  expect(positions).toEqual({ bodyBeforeNote: true, dividerPresent: true });
  await shot(page, info, "new-commit-preserved-draft");
  await page.getByTestId(`reading-link-${ARTICLE_B}`).click();
  await expect(page.getByTestId("note-body")).toHaveValue(savedB.body);
  await page.getByTestId(`reading-link-${ARTICLE_A}`).click();
  await expect(page.getByTestId("note-body")).toHaveValue(draft);
  expect(noteRow(savedA.id)).toMatchObject({ body: savedA.body, revision: savedA.revision });
  expect(noteRow(savedB.id)).toMatchObject({ body: savedB.body, revision: savedB.revision });
  // A second writer advances D1; UI CAS must preserve the unsaved text and require explicit reload.
  const winner = await saveNote(page.request, ARTICLE_A, `competing saved supplement ${suffix}`);
  await page.getByTestId("note-save").click();
  await expect(page.getByTestId("note-status")).toContainText(/衝突|conflict/i);
  await expect(page.getByTestId("note-body")).toHaveValue(draft);
  await expect(page.getByTestId("note-save")).toBeDisabled();
  expect(noteRow(savedA.id).body).toBe(winner.body);
  await page.getByTestId("note-reload").click();
  await expect(page.getByTestId("note-body")).toHaveValue(winner.body);
  expect(query("SELECT * FROM messages ORDER BY id")).toEqual(messages);
  expect((await fakeProviderLog()).length).toBe(providers);
  note(info, "Actual fixed Git commit rebuilt and atomically published while page stays open; 5-second polling switches full commit/body after file rename, keeps unsaved text and stable A/B persisted notes. No reload, chat change or provider call.");
});

test("E2E-RC-07 broken builds and missing artifact preserve last readable version while captures save @mobile", { tag: ["@RC"] }, async ({ page }, info) => {
  test.setTimeout(180_000);
  await loginViaUi(page, ACCOUNTS.ada);
  const messages = query("SELECT * FROM messages ORDER BY id");
  const providers = (await fakeProviderLog()).length;
  await page.goto(`/reading/${ARTICLE_A}`);
  const original = readFileSync(BUNDLE_PATH);
  const bundle = JSON.parse(original.toString("utf8")) as { commit: string; articles: { id: string; body: string }[] };
  await expect(page.getByTestId("reading-commit")).toContainText(bundle.commit);
  const rendered = await page.getByTestId("reading-body").textContent();
  const repo = contentRepo();
  const registry = readFileSync(join(repo, "articles.json"));
  for (const broken of ["{invalid", JSON.stringify({ version: 1, articles: [{ id: ARTICLE_A, title: "missing", path: "missing.md" }] }), JSON.stringify({ version: 1, articles: [{ id: ARTICLE_A, title: "one", path: "b.md" }, { id: ARTICLE_A, title: "duplicate", path: "b.md" }] })]) {
    writeFileSync(join(repo, "articles.json"), broken);
    const badCommit = commitContent(repo, "invalid synthetic article build");
    await expect(publishContent(badCommit)).rejects.toThrow();
    expect(readFileSync(BUNDLE_PATH)).toEqual(original);
    const id = await capture(page.request, "capture remains available after failed reading build");
    expect(pendingCapture(id)).toBeNull();
    expect((await page.request.get("/api/reading")).status()).toBe(200);
    await expect(page.getByTestId("reading-commit")).toContainText(bundle.commit);
    expect(await page.getByTestId("reading-body").textContent()).toBe(rendered);
  }
  // Asset loss exercises the real Worker binding, not a mocked browser response.
  const missing = BUNDLE_PATH + ".held-by-rc07";
  renameSync(BUNDLE_PATH, missing);
  try {
    const failure = page.waitForResponse((res) => new URL(res.url()).pathname === "/api/reading" && res.status() === 503, { timeout: 20_000 });
    await failure;
    await expect(page.getByTestId("reading-commit")).toContainText(bundle.commit);
    expect(await page.getByTestId("reading-body").textContent()).toBe(rendered);
    await capture(page.request, "capture while artifact missing");
  } finally { renameSync(missing, BUNDLE_PATH); }
  writeFileSync(join(repo, "articles.json"), registry);
  const next = commitContent(repo, "recovered synthetic article build");
  await publishContent(next);
  await expect(page.getByTestId("reading-commit")).toContainText(next, { timeout: 20_000 });
  expect(query("SELECT * FROM messages ORDER BY id")).toEqual(messages);
  expect((await fakeProviderLog()).length).toBe(providers);
  await shot(page, info, "publication-recovered");
  note(info, "Malformed registry, missing blob and duplicate ID each fail actual builder without changing previous bundle bytes. Actual missing Worker asset yields 503 while open browser retains old whole version; captures continue and next valid atomic publication refreshes automatically.");
});
