// Review-only real ConnectedApp harness. No provider or production-repository access.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  artifactJSON,
  acceptanceReference,
  resumeItem,
  cleanupOwned,
  privateDirectory,
  fixtureManifest,
  sha256,
} from "./safety.mjs";

const review = dirname(fileURLToPath(import.meta.url));
const component = resolve(review, "..");
const require = createRequire(join(component, "web/package.json"));
const { chromium, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
assert.deepEqual(
  readdirSync("/sys/class/net"),
  ["lo"],
  "dedicated network-none namespace required",
);
const state = privateDirectory(
  process.env.HAI_REVIEW_STATE ?? "/state",
  resolve(component, "../.."),
);
const binary = process.env.HAI_REVIEW_BINARY ?? "/opt/hai/taskboard";
const webRoot = process.env.HAI_REVIEW_WEB_ROOT ?? "/opt/hai/web";
const base = "http://127.0.0.1:8080";
const token = randomBytes(32).toString("base64url");
const wrongToken = randomBytes(32).toString("base64url");
const secrets = [token, wrongToken];
const runId = new Date().toISOString().replace(/[^0-9TZ]/g, "");
const resumeState = process.env.HAI_REVIEW_RESUME_STATE;
const remainingFaults = process.env.HAI_REVIEW_REMAINING_FAULTS === "1";
assert(
  !remainingFaults || resumeState,
  "remaining faults require existing synthetic state",
);
if (resumeState)
  assert(/^[0-9TZ]+$/.test(resumeState), "invalid synthetic state identifier");
const privateRun = join(state, resumeState ?? runId);
if (resumeState) privateDirectory(privateRun, resolve(component, "../.."));
else mkdirSync(privateRun, { mode: 0o700 });
const output = join(review, "runs", runId);
mkdirSync(output, { mode: 0o700 });
mkdirSync(join(output, "screenshots"));
const priorCaptureRun = process.env.HAI_REVIEW_PRIOR_CAPTURE;
const reusedStates = new Set();
if (priorCaptureRun) {
  assert(
    /^[0-9TZ]+$/.test(priorCaptureRun),
    "invalid prior capture identifier",
  );
  const prior = JSON.parse(
    readFileSync(join(review, "runs", priorCaptureRun, "capture.json")),
  );
  for (const name of ["login-rejected", "projects", "draft-rejected"]) {
    const rows = prior.captures.filter((row) => row.state === name);
    const keys = new Set(rows.map((row) => row.viewport + "|" + row.theme));
    assert(
      rows.length === 6 &&
        keys.size === 6 &&
        rows.every(
          (row) =>
            row.screenshot &&
            row.heading &&
            ["light", "dark"].includes(row.theme),
        ),
      "incomplete earlier capture evidence",
    );
    reusedStates.add(name);
  }
}
const logs = [],
  steps = [],
  captures = [],
  health = [],
  commands = [],
  shutdown = [];
let runtime, browser, context, page, approval, currentStep;
const actor = "review-operator";
const dataRoot = join(privateRun, "runtime");
const receipt = {
  scope: "original R2 ConnectedApp local evidence only",
  fullProductAcceptance: false,
  doneAcceptance: false,
  runId,
  reusedCaptureFrom: priorCaptureRun ?? null,
  resumedSyntheticStateFrom: resumeState ?? null,
  remainingFaultsOnly: remainingFaults,
  driverSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
  node: process.version,
  steps,
  captures,
  health,
  commands,
  shutdown,
};
const safe = (value) => artifactJSON(value, secrets);
function cleanError(error) {
  let message = String(error instanceof Error ? error.message : error);
  for (const secret of secrets)
    message = message.split(secret).join("[REDACTED]");
  for (const path of [component, state, binary, webRoot])
    message = message.split(path).join("[private-path]");
  return message;
}
async function start() {
  assert(!runtime, "runtime already held");
  runtime = spawn(binary, [], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: "C.UTF-8",
      HAI_TASKBOARD_DATA_ROOT: dataRoot,
      HAI_TASKBOARD_LISTEN_ADDR: "127.0.0.1:8080",
      HAI_TASKBOARD_ORIGIN: base,
      HAI_TASKBOARD_SESSION_ACTOR: actor,
      HAI_TASKBOARD_SESSION_TOKEN: token,
      HAI_TASKBOARD_WEB_ROOT: webRoot,
      ...(approval
        ? { HAI_TASKBOARD_APPROVED_REPOSITORIES_FILE: approval }
        : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  runtime.stdout.on("data", (b) => logs.push(b.toString()));
  runtime.stderr.on("data", (b) => logs.push(b.toString()));
  let ready = false;
  for (let n = 0; n < 100; n++) {
    assert(runtime.exitCode === null, "runtime exited before readiness");
    try {
      const r = await fetch(base + "/healthz");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready, "runtime health readiness timeout");
}
async function stop() {
  if (!runtime) return;
  const child = runtime;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  let timer;
  const [code, signal] = await Promise.race([
    exited,
    new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new Error("owned graceful shutdown timeout; state retained")),
        10000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  assert.equal(code, 0);
  assert.equal(signal, null);
  shutdown.push({ signal: "SIGTERM", exit: code });
  runtime = undefined;
}
async function step(name, fn) {
  currentStep = name;
  await fn();
  steps.push({ name, status: "passed" });
  console.log(JSON.stringify({ step: name, status: "passed" }));
}
async function snapshot(name) {
  if (reusedStates.has(name)) return;
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 834, height: 1112 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const theme of ["light", "dark"]) {
      if (
        (await page.locator(".connected-shell").getAttribute("data-theme")) !==
        theme
      )
        await page
          .getByRole("button", { name: `Use ${theme} theme`, exact: true })
          .click();
      await expect(page.locator(".connected-shell")).toHaveAttribute(
        "data-theme",
        theme,
      );
      const input = page.getByLabel("Local operator secret");
      if (await input.count())
        assert.equal(
          await input.inputValue(),
          "",
          "password must be empty before capture",
        );
      safe(await page.content());
      const screenshot = `screenshots/${name}__${viewport.name}__${theme}.png`;
      await page.screenshot({ path: join(output, screenshot), fullPage: true });
      let axe;
      try {
        const result = await new AxeBuilder({ page }).analyze();
        axe = {
          violations: result.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.length,
          })),
        };
      } catch (error) {
        axe = { error: cleanError(error) };
      }
      await expect(page.locator(".connected-shell")).toHaveAttribute(
        "data-theme",
        theme,
      );
      captures.push({
        state: name,
        viewport: viewport.name,
        theme,
        url: page.url(),
        heading: await page.locator("main h2").innerText(),
        screenshot,
        documentOverflow: await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        axe,
      });
    }
  }
}
async function connected() {
  await expect(page.locator(".cursor")).toContainText(/^Connected ·/);
}
async function browserRead(path) {
  return page.evaluate(async (path) => {
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    return { status: response.status, body: await response.json() };
  }, path);
}
async function boardJSON(project) {
  const r = await browserRead(`/api/v1/projects/${project}/board`);
  assert.equal(r.status, 200);
  return r.body;
}
async function newPage() {
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
  });
  await context.addInitScript(() => {
    const Native = window.EventSource;
    window.__reviewEventSources = [];
    window.EventSource = class extends Native {
      constructor(...args) {
        super(...args);
        window.__reviewEventSources.push(this);
      }
    };
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  observe(page);
}
function observe(page) {
  page.on("console", (message) => {
    if (message.type() === "error")
      health.push({
        type: "consoleerror",
        step: currentStep,
        message: cleanError(message.text()),
      });
  });
  page.on("requestfailed", (request) =>
    health.push({
      type: "requestfailed",
      step: currentStep,
      path: new URL(request.url()).pathname,
      error: request.failure()?.errorText,
    }),
  );
  page.on("pageerror", (e) =>
    health.push({
      type: "pageerror",
      step: currentStep,
      message: cleanError(e),
    }),
  );
  page.on("response", (r) => {
    if (r.status() >= 400)
      health.push({
        type: "http",
        step: currentStep,
        method: r.request().method(),
        path: new URL(r.url()).pathname,
        status: r.status(),
      });
  });
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).pathname.includes("/projects")
    ) {
      const body = r.postDataJSON();
      commands.push({
        method: "POST",
        path: new URL(r.url()).pathname,
        commandID: body.command_id,
        operation: body.operation ?? "CreateProject",
      });
    } else if (r.method() === "GET" && /\/commands\//.test(r.url()))
      commands.push({ method: "GET", path: new URL(r.url()).pathname });
  });
}
let project, item;
const acBytes = "Synthetic review AC: successful Fake remains Developing.\n";
async function inspectComboboxes() {
  receipt.comboboxes = [];
  for (const name of ["ref", "manifest"]) {
    const control = page.locator(`select[name=${name}]`);
    await expect(control).toBeVisible();
    receipt.comboboxes.push({
      name,
      ariaSnapshot: await control.ariaSnapshot(),
      labels: await control.evaluate((element) =>
        Array.from(element.labels, (label) =>
          label.textContent.replace(/\s+/g, " ").trim(),
        ),
      ),
    });
  }
}
if (resumeState) approval = join(privateRun, "approved-repositories.json");
try {
  await start();
  browser = await chromium.launch();
  receipt.browser = browser.version();
  await newPage();
  if (!resumeState) {
    await step(
      "actual static shell and wrong-token visible feedback",
      async () => {
        await page.goto(base);
        await expect(page.getByLabel("Local operator secret")).toBeVisible();
        await page.getByLabel("Local operator secret").fill(wrongToken);
        await page.getByRole("button", { name: "Log in", exact: true }).click();
        await expect(page.getByRole("alert")).toContainText("Login rejected");
        assert.equal(
          await page.getByLabel("Local operator secret").inputValue(),
          "",
        );
        await snapshot("login-rejected");
      },
    );
    await step("same-origin login and cookie attributes", async () => {
      await page.getByLabel("Local operator secret").fill(token);
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Log out " + actor }),
      ).toBeVisible();
      const cookies = await context.cookies();
      const cookie = cookies.find((c) => c.name === "__Host-hai_session");
      assert(
        cookie &&
          cookie.secure &&
          cookie.httpOnly &&
          cookie.sameSite === "Strict" &&
          cookie.path === "/",
      );
      assert.equal(
        await page.evaluate(() => localStorage.length + sessionStorage.length),
        0,
      );
      const response = await browserRead("/api/v1/session");
      assert.equal(response.status, 200);
      await snapshot("projects");
    });
    await step("real project creation and board open", async () => {
      await page
        .getByLabel("Project name", { exact: true })
        .fill("Synthetic review project");
      await page
        .getByLabel("Repository hint (does not grant approval)", {
          exact: true,
        })
        .fill("synthetic-review-only");
      await page
        .getByLabel("Repository ref hint", { exact: true })
        .fill("refs/heads/main");
      await page
        .getByRole("button", { name: "Create project", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Synthetic review project",
          exact: true,
        }),
      ).toBeVisible();
      const listing = await browserRead("/api/v1/projects");
      assert.equal(listing.status, 200);
      const data = listing.body;
      assert.equal(data.items.length, 1);
      project = data.items[0].project_id;
      await page
        .getByRole("button", { name: "Synthetic review project", exact: true })
        .click();
      await connected();
      await expect(
        page.getByRole("region", { name: "Project board", exact: true }),
      ).toBeVisible();
    });
    await step(
      "empty Draft and headless Ready rejection preserve focus and lane",
      async () => {
        await page
          .getByLabel("Work item title", { exact: true })
          .fill("Synthetic review task");
        await page
          .getByLabel("Goal", { exact: true })
          .fill("Exercise explicit admission and deterministic Fake only.");
        await page.getByLabel("Human owner ID", { exact: true }).fill(actor);
        await page
          .getByRole("button", { name: "Create empty Draft", exact: true })
          .click();
        const mark = page.getByRole("button", {
          name: "Mark Synthetic review task Ready",
          exact: true,
        });
        await expect(mark).toBeEnabled();
        const board = await boardJSON(project);
        const draft = board.projection.lanes.find(
          (l) => l.key === "Draft",
        ).items;
        assert.equal(draft.length, 1);
        item = draft[0].work_item_id;
        assert.equal(draft[0].required_ac_count, 0);
        await mark.click();
        await expect(
          page.getByRole("region", { name: "Command result" }),
        ).toContainText("Rejected by server");
        await expect(mark).toBeFocused();
        assert(
          (await boardJSON(project)).projection.lanes
            .find((l) => l.key === "Draft")
            .items.some((i) => i.work_item_id === item),
        );
        await snapshot("draft-rejected");
      },
    );
    await step(
      "graceful lifecycle and explicit synthetic immutable repository approval",
      async () => {
        await context.close();
        context = undefined;
        await stop();
        const repo = join(privateRun, "synthetic-repository");
        mkdirSync(repo, { mode: 0o700 });
        writeFileSync(join(repo, "spec.txt"), acBytes, { mode: 0o600 });
        writeFileSync(
          join(repo, "specification.json"),
          JSON.stringify(fixtureManifest(item, acBytes)) + "\n",
          { mode: 0o600 },
        );
        const git = realpathSync("/usr/bin/git");
        const run = (args) =>
          execFileSync(git, args, {
            cwd: repo,
            env: {
              PATH: process.env.PATH,
              HOME: process.env.HOME,
              GIT_CONFIG_NOSYSTEM: "1",
              GIT_CONFIG_GLOBAL: "/dev/null",
            },
            stdio: ["ignore", "pipe", "pipe"],
          });
        run(["init", "-b", "main"]);
        run(["add", "spec.txt", "specification.json"]);
        run([
          "-c",
          "user.name=Synthetic Review",
          "-c",
          "user.email=synthetic@example.invalid",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "-m",
          "Synthetic admission fixture",
        ]);
        receipt.syntheticCommit = run(["rev-parse", "HEAD"]).toString().trim();
        approval = join(privateRun, "approved-repositories.json");
        writeFileSync(
          approval,
          JSON.stringify({
            schema_version: 1,
            repositories: [
              {
                project_id: project,
                id: "review-spec",
                version: 1,
                object_format: "sha1",
                configuration_id: "synthetic-review-v1",
                approved_by_actor: actor,
                refs: ["refs/heads/main"],
                manifest_paths: ["specification.json"],
                git_executable: git,
                git_dir: join(repo, ".git"),
              },
            ],
          }),
          { mode: 0o600 },
        );
        await start();
        await newPage();
        await page.goto(base);
        await page.getByLabel("Local operator secret").fill(token);
        await page.getByRole("button", { name: "Log in", exact: true }).click();
        await page
          .getByRole("button", {
            name: "Synthetic review project",
            exact: true,
          })
          .click();
        await connected();
      },
    );
    await step(
      "binding proposal preparation and explicit exact-AC acceptance",
      async () => {
        await page
          .getByLabel("Approved binding ID", { exact: true })
          .fill("review-spec");
        await page
          .getByRole("button", {
            name: "Inspect approved binding",
            exact: true,
          })
          .click();
        await inspectComboboxes();
        await page.locator("select[name=ref]").selectOption("refs/heads/main");
        await page
          .locator("select[name=manifest]")
          .selectOption("specification.json");
        await page
          .getByRole("button", { name: "Propose specification", exact: true })
          .click();
        await expect(
          page.getByLabel("Stored proposal digest", { exact: true }),
        ).toHaveValue(/^sha256:[0-9a-f]{64}$/);
        await page
          .getByRole("button", {
            name: "Prepare initial acceptance",
            exact: true,
          })
          .click();
        await expect(
          page.getByLabel("Exact AC bytes for local", { exact: true }),
        ).toBeVisible();
        await snapshot("prepared-admission");
        await page
          .getByLabel("Exact AC bytes for local", { exact: true })
          .fill(Buffer.from(acBytes).toString("base64"));
        await page.getByRole("checkbox").check();
        await page
          .getByRole("button", {
            name: "Accept initial specification",
            exact: true,
          })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "InitialSpecificationAccepted",
        );
        const draft = (await boardJSON(project)).projection.lanes
          .find((l) => l.key === "Draft")
          .items.find((i) => i.work_item_id === item);
        assert(draft, "accepted item must remain Draft");
        receipt.admission = {
          phase: draft.phase,
          projectedLegacyRequiredACCount: draft.required_ac_count,
          acContentDigest: sha256(acBytes),
          note: "Board count reads legacy requirements; successful acceptance/current-head Ready guards are separate authority.",
        };
      },
    );
  } else {
    await step(
      "resume stopped synthetic admission via real login and exact original result",
      async () => {
        const previous = JSON.parse(
          readFileSync(join(review, "runs", resumeState, "capture.json")),
        );
        const accepted = acceptanceReference(previous);
        project = accepted.project;
        await page.goto(base);
        await page.getByLabel("Local operator secret").fill(token);
        await page.getByRole("button", { name: "Log in", exact: true }).click();
        await page
          .getByRole("button", {
            name: "Synthetic review project",
            exact: true,
          })
          .click();
        await connected();
        const original = await browserRead(
          accepted.path + "/" + accepted.commandID,
        );
        assert.equal(original.status, 200);
        assert.equal(original.body.ok, true);
        assert.equal(original.body.result.type, "InitialSpecificationAccepted");
        const subject = resumeItem(
          await boardJSON(project),
          project,
          remainingFaults,
        );
        item = subject.work_item_id;
        receipt.admission = {
          originalCommandID: accepted.commandID,
          result: original.body.result,
          phase: subject.phase,
          projectedLegacyRequiredACCount: subject.required_ac_count,
        };
        await page
          .getByLabel("Approved binding ID", { exact: true })
          .fill("review-spec");
        await page
          .getByRole("button", {
            name: "Inspect approved binding",
            exact: true,
          })
          .click();
        await inspectComboboxes();
      },
    );
  }
  // The following faults affect this browser's transport only; every delivered response remains real backend data.
  if (!remainingFaults) {
    await step(
      "lost Ready response once-only original-result lookup without repost",
      async () => {
        let post = 0,
          lookup = 0,
          identity;
        await page.route("**/api/v1/projects/**/commands", async (route) => {
          if (
            route.request().method() === "POST" &&
            route.request().postDataJSON().operation === "MarkReady"
          ) {
            post++;
            identity = route.request().postDataJSON().command_id;
            await route.fetch();
            await route.abort("failed");
          } else await route.continue();
        });
        await page.route("**/api/v1/projects/**/commands/*", async (route) => {
          lookup++;
          await route.abort("failed");
        });
        await page
          .getByRole("button", {
            name: "Mark Synthetic review task Ready",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("button", {
            name: "Look up original command result",
            exact: true,
          }),
        ).toBeVisible();
        assert.equal(post, 1);
        assert.equal(lookup, 1);
        await page.unroute("**/api/v1/projects/**/commands/*");
        await page
          .getByRole("button", {
            name: "Look up original command result",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("button", {
            name: "Dispatch Synthetic review task to Developing",
            exact: true,
          }),
        ).toBeVisible();
        assert.equal(post, 1);
        assert(identity);
        const lookups = commands.filter(
          (r) => r.method === "GET" && r.path.endsWith("/commands/" + identity),
        );
        assert.equal(lookups.length, 2);
        receipt.recovery = {
          postCount: post,
          automaticResultLookupCount: lookup,
          totalSameIdentityResultGET: lookups.length,
          commandID: identity,
        };
        await page.unroute("**/api/v1/projects/**/commands");
      },
    );
    await step("actual Fake and SSE success stays Developing", async () => {
      await page
        .getByLabel("Fake scenario ID for Synthetic review task", {
          exact: true,
        })
        .fill("local-success");
      await page
        .getByRole("button", {
          name: "Dispatch Synthetic review task to Developing",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("region", { name: "Developing lane", exact: true }),
      ).toContainText("Succeeded");
      const board = await boardJSON(project);
      const developing = board.projection.lanes
        .find((l) => l.key === "Developing")
        .items.find((i) => i.work_item_id === item);
      assert.equal(developing.current_run.observed_state, "Succeeded");
      assert.equal(
        board.projection.lanes.find((l) => l.key === "Done").items.length,
        0,
      );
      receipt.finalBoard = {
        phase: developing.phase,
        runState: developing.current_run.observed_state,
        cursor: board.cursor,
        doneItems: 0,
      };
      await snapshot("developing-succeeded");
    });
  }
  await step(
    "keyboard Tab entry, visible focus and horizontal board scroll",
    async () => {
      await page.setViewportSize({ width: 834, height: 1112 });
      const board = page.getByRole("region", {
        name: "Project board",
        exact: true,
      });
      await page
        .getByRole("button", { name: "Refresh board", exact: true })
        .focus();
      await page.keyboard.press("Tab");
      await expect(board).toBeFocused();
      const outline = await board.evaluate((element) => ({
        width: getComputedStyle(element).outlineWidth,
        style: getComputedStyle(element).outlineStyle,
        color: getComputedStyle(element).outlineColor,
      }));
      assert(
        parseFloat(outline.width) >= 2 && outline.style !== "none",
        "actual keyboard focus must be visible",
      );
      const before = await board.evaluate((element) => element.scrollLeft);
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(() => board.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(before);
      receipt.keyboard = {
        tabEntry: true,
        outline,
        scrollBefore: before,
        scrollAfter: await board.evaluate((element) => element.scrollLeft),
      };
    },
  );
  await step(
    "owned runtime stop withdraws authority and restart restores actual snapshot",
    async () => {
      await stop();
      await expect(page.locator(".cursor")).toContainText("Disconnected");
      await expect(
        page.getByRole("button", { name: "Create empty Draft", exact: true }),
      ).toBeDisabled();
      const disconnected = await page.locator(".cursor").innerText();
      await start();
      await connected();
      await expect(
        page.getByRole("button", { name: "Create empty Draft", exact: true }),
      ).toBeEnabled();
      receipt.disconnect = {
        method: "owned runtime SIGTERM/wait then same-state restart",
        disconnected,
        statusAfter: await page.locator(".cursor").innerText(),
        commandsDisabledWhileDisconnected: true,
      };
    },
  );
  await step(
    "controlled reset event removes authority until real snapshot revalidation",
    async () => {
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      await page.route("**/api/v1/projects/**/board", async (route) => {
        await held;
        await route.continue();
      });
      await page.evaluate(() =>
        window.__reviewEventSources.at(-1).dispatchEvent(
          new MessageEvent("reset_required", {
            data: JSON.stringify({ reason: "review-controlled-reset" }),
          }),
        ),
      );
      await expect(page.locator(".cursor")).toContainText("Revalidating");
      await expect(
        page.getByRole("button", { name: "Create empty Draft", exact: true }),
      ).toBeDisabled();
      release();
      await connected();
      await page.unroute("**/api/v1/projects/**/board");
      receipt.resetFault = {
        injection: "browser EventSource reset_required event",
        snapshot: "real backend read",
        authorityDisabledWhileHeld: true,
      };
    },
  );
  await step(
    "browser session loss withdraws authority and explicit login restores it",
    async () => {
      await context.clearCookies();
      await page
        .getByRole("button", { name: "Refresh board", exact: true })
        .click();
      await expect(page.getByLabel("Local operator secret")).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Project board", exact: true }),
      ).toHaveCount(0);
      await page.getByLabel("Local operator secret").fill(token);
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await page
        .getByRole("button", { name: "Synthetic review project", exact: true })
        .click();
      await connected();
      receipt.sessionLoss =
        "cookie removed in owned browser; no global secret rotation claimed";
    },
  );
  await step(
    "logout revokes this browser session and clears private UI",
    async () => {
      await page
        .getByRole("button", { name: "Log out " + actor, exact: true })
        .click();
      await expect(page.getByLabel("Local operator secret")).toBeVisible();
      assert.equal(
        await page.getByLabel("Local operator secret").inputValue(),
        "",
      );
      const response = await browserRead("/api/v1/session");
      assert.equal(response.status, 401);
      await expect(
        page.getByRole("region", { name: "Project board", exact: true }),
      ).toHaveCount(0);
    },
  );
  receipt.status = "passed";
} catch (error) {
  receipt.status = "failed";
  receipt.error = cleanError(error);
  process.exitCode = 1;
} finally {
  const cleanupErrors = await cleanupOwned(context, browser, stop);
  if (cleanupErrors.length) {
    receipt.cleanupErrors = cleanupErrors.map(({ stage, error }) => ({
      stage,
      error: cleanError(error),
    }));
    receipt.status = "failed";
    process.exitCode = 1;
  }
  // Runtime logs stay memory-only until the same secret guard passes; state is retained for root-owned cleanup.
  try {
    safe(logs);
    receipt.runtimeLogSha256 = sha256(logs.join(""));
    receipt.runtimeLogLines = logs.join("").split("\n").filter(Boolean).length;
  } catch {
    receipt.secretGuardFailure =
      "Runtime output rejected; raw output was not persisted";
    receipt.status = "failed";
    process.exitCode = 1;
  }
  writeFileSync(join(output, "capture.json"), safe(receipt));
  console.log(
    JSON.stringify({
      runId,
      status: receipt.status,
      steps: steps.length,
      captures: captures.length,
    }),
  );
}
