import {
  test,
  expect,
  type Page,
  type BrowserContext,
} from "../web/node_modules/@playwright/test";
import { mkdir, readFile, writeFile, chmod, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import type { TaskDetail, Usage } from "../web/src/api";
import type { Approval } from "../web/src/Approvals";
import {
  OwnedProcess,
  assertSafeDatabase,
  confirmedFixtureShutdown,
  cleanupAll,
  publicText,
} from "./runtime.ts";

const base = "http://127.0.0.1:18600";
const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

test("M1 real fixture flow and explicitly synthetic presentation supplements", async ({
  browser,
}) => {
  const cwd = process.cwd();
  const id = process.env.FE_REVIEW_RUN_ID ?? "";
  expect(id).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,70}$/);
  assertSafeDatabase(process.env.TEST_DATABASE_URL ?? "");
  expect(process.env.CONNECTOR_ORIGIN).toBeUndefined();
  const python = process.env.PYTHON ?? join(cwd, ".venv/bin/python");
  const output = resolve(cwd, "fe-review/runs", id);
  await mkdir(join(output, "screenshots"), { recursive: true, mode: 0o700 });
  // Refuse to overwrite evidence or reuse an auth file from an earlier attempt.
  await writeFile(join(output, ".started"), new Date().toISOString(), {
    flag: "wx",
    mode: 0o600,
  });
  const secrets = [
    decodeURIComponent(new URL(process.env.TEST_DATABASE_URL!).password),
  ];
  const captures: Record<string, unknown>[] = [];
  const steps: Record<string, unknown>[] = [];
  const health: Record<string, unknown>[] = [];
  const shutdown: Record<string, unknown>[] = [];
  const sourceHashes: Record<string, string> = {};
  for (const file of [
    "fe-review/flows.spec.ts",
    "fe-review/runtime.ts",
    "fe-review/playwright.config.ts",
    "web/src/Approvals.tsx",
    "web/src/taskLocation.ts",
    "scripts/browser-fixture.py",
  ])
    sourceHashes[file] = hash(await readFile(join(cwd, file)));
  let server: OwnedProcess | undefined;
  let producer: OwnedProcess | undefined;
  let context: BrowserContext | undefined;
  let failure: string | null = null;
  let failurePhase: string | null = null;
  let phase = "launch";
  let fixture!: {
    username: string;
    password: string;
    task_id: string;
    run_id: string;
  };
  const capture = async (
    page: Page,
    name: string,
    kind: "real" | "override",
  ) => {
    for (const size of sizes) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await expect(page.locator("main")).toBeVisible();
      const visible = await page.locator("body").innerText();
      publicText(visible, secrets);
      const passwordValues = await page
        .locator("input[type=password]")
        .evaluateAll((inputs) =>
          inputs.map((input) => (input as HTMLInputElement).value),
        );
      expect(passwordValues.every((value) => value === "")).toBeTruthy();
      const metrics = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        height: innerHeight,
      }));
      if (name === "native-invalid-sha") {
        expect(
          await page
            .getByLabel("Base commit SHA", { exact: true })
            .evaluate((input) => (input as HTMLInputElement).reportValidity()),
        ).toBe(false);
      }
      const file = `screenshots/${name}-${size.name}.png`;
      await page.screenshot({ path: join(output, file), fullPage: true });
      captures.push({
        name,
        viewport: size.name,
        kind,
        path: file,
        sha256: hash(await readFile(join(output, file))),
        url: page.url().replace(base, ""),
        colorScheme: "light",
        metrics,
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  };
  const counts = async () => {
    const proc = new OwnedProcess(python, "counts", cwd);
    try {
      expect(await proc.wait()).toEqual({ code: 0, signal: null });
      return JSON.parse(proc.log) as {
        prompts: number;
        allocations: number;
        events: number;
      };
    } finally {
      await proc.stop();
    }
  };
  try {
    server = new OwnedProcess(python, "serve", cwd);
    await expect
      .poll(
        async () => {
          if (server!.child.exitCode !== null)
            throw new Error("fixture_exited_before_ready");
          try {
            return (await fetch(`${base}/api/v1/session`)).status;
          } catch {
            return 0;
          }
        },
        { timeout: 30000 },
      )
      .toBe(200);
    const credentialsPath = join(cwd, ".artifacts/browser-fixture.json");
    expect((await stat(credentialsPath)).mode & 0o777).toBe(0o600);
    fixture = JSON.parse(await readFile(credentialsPath, "utf8"));
    secrets.push(fixture.password);
    context = await browser.newContext({
      baseURL: base,
      locale: "zh-TW",
      timezoneId: "Asia/Taipei",
      colorScheme: "light",
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    page.on("pageerror", () => health.push({ kind: "pageerror", phase }));
    page.on("console", (message) => {
      if (message.type() === "error")
        health.push({ kind: "console-error", phase });
    });
    page.on("requestfailed", (request) =>
      health.push({
        kind: "requestfailed",
        phase,
        path: new URL(request.url()).pathname,
        reason: request.failure()?.errorText,
      }),
    );
    page.on("response", (response) => {
      if (response.status() >= 400)
        health.push({
          kind: "http",
          phase,
          path: new URL(response.url()).pathname,
          status: response.status(),
        });
    });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Operator 登入" }),
    ).toBeVisible();
    await capture(page, "login", "real");
    phase = "real-login";
    await page.getByLabel("帳號", { exact: true }).fill(fixture.username);
    await page.getByLabel("密碼", { exact: true }).fill(fixture.password);
    await page.getByRole("button", { name: "登入工作台" }).click();
    await expect(
      page.getByRole("heading", { name: "任務與進度" }),
    ).toBeVisible();
    const storagePath = join(output, "auth.storage.json");
    const storage = await context.storageState({ path: storagePath });
    secrets.push(...storage.cookies.map((cookie) => cookie.value));
    await chmod(storagePath, 0o600);
    await capture(page, "task-list", "real");
    await page.getByRole("button", { name: /100 durable events/ }).click();
    await expect(page).toHaveURL(`${base}/#${fixture.task_id}`);
    await expect(page.locator(".run-summary .state")).toHaveText("排隊中");
    await capture(page, "queued-detail", "real");
    const cursors: number[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith("/events"))
        cursors.push(Number(url.searchParams.get("after_seq")));
    });
    phase = "real-produce";
    producer = new OwnedProcess(python, "produce", cwd);
    await expect(
      page.getByText("AT03 event 20", { exact: true }),
    ).toBeVisible();
    phase = "real-offline";
    await context.setOffline(true);
    await expect(page.getByText("連線中斷，正在重新連線…")).toBeVisible();
    await capture(page, "reconnecting", "real");
    expect(await producer.wait()).toEqual({ code: 0, signal: null });
    phase = "real-restored";
    await context.setOffline(false);
    await expect(
      page.getByText("AT03 event 100", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".timeline li").filter({ hasText: "AT03 event " }),
    ).toHaveCount(100);
    await expect(page.locator(".run-summary .state")).toHaveText("已完成");
    await expect(page.locator(".result")).toContainText("100 events fixture");
    const sequences = await page
      .locator("[data-event-seq]")
      .evaluateAll((nodes) =>
        nodes.map((node) => Number(node.getAttribute("data-event-seq"))),
      );
    expect(sequences).toEqual(
      Array.from({ length: sequences.length }, (_, index) => index + 1),
    );
    expect(cursors.some((cursor) => cursor > 0)).toBeTruthy();
    for (const label of ["暫停", "繼續", "取消", "審批"])
      await expect(
        page.getByRole("button", { name: label, exact: true }),
      ).toBeDisabled();
    const effects = await counts();
    expect(effects).toEqual({ prompts: 1, allocations: 1, events: 100 });
    await capture(page, "succeeded-events-result", "real");
    await page.reload();
    await expect(
      page.getByText("AT03 event 100", { exact: true }),
    ).toBeVisible();
    expect(await counts()).toEqual(effects);
    steps.push({
      name: "real-login-produce-reconnect",
      status: "passed",
      effects,
      eventSequenceCount: sequences.length,
      resumedWithNonzeroCursor: true,
      hashDetail: true,
      replayDidNotRepeatEffects: true,
    });
    for (const view of [
      { button: "專案", heading: "專案", name: "projects" },
      { button: "Agent 設定", heading: "Agent 設定", name: "profiles" },
    ]) {
      await page
        .getByRole("button", { name: view.button, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: view.heading, exact: true }),
      ).toBeVisible();
      await capture(page, view.name, "real");
    }
    await page.getByRole("button", { name: "任務", exact: true }).click();
    await page.getByRole("button", { name: "＋ 建立任務" }).click();
    await page
      .getByLabel("任務名稱", { exact: true })
      .fill("Synthetic invalid base review");
    await page
      .getByLabel("工作目標", { exact: true })
      .fill("Browser native validation only");
    const sha = page.getByLabel("Base commit SHA", { exact: true });
    await sha.fill("not-a-commit");
    let createPosts = 0;
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/v1/tasks" &&
        request.method() === "POST"
      )
        createPosts++;
    });
    await page.getByRole("button", { name: "加入執行佇列" }).click();
    expect(
      await sha.evaluate(
        (input) => (input as HTMLInputElement).validity.patternMismatch,
      ),
    ).toBe(true);
    expect(
      await sha.evaluate(
        (input) => (input as HTMLInputElement).validationMessage.length,
      ),
    ).toBeGreaterThan(0);
    await expect(sha).toBeFocused();
    expect(createPosts).toBe(0);
    await capture(page, "native-invalid-sha", "real");
    steps.push({
      name: "real-settings-and-native-validation",
      status: "passed",
      createPosts,
      patternMismatch: true,
      nativeValidationMessagePresent: true,
    });
    const response = await page.request.get(`/api/v1/tasks/${fixture.task_id}`);
    expect(response.status()).toBe(200);
    const original = (await response.json()) as TaskDetail;
    expect(original.runs[0].state).toBe("succeeded");
    phase = "override";
    const cases = [
      "pausing",
      "paused",
      "resuming",
      "cancelling",
      "approval-pending",
      "approval-expired",
      "approval-denied",
      "usage",
      "approval-fetch-error",
      "approval-decision-error",
      "approval-accepted",
    ] as const;
    for (const name of cases) {
      const approvalCase = name.startsWith("approval");
      const detail: TaskDetail = structuredClone(original);
      const run = detail.runs[0];
      run.state = approvalCase
        ? "awaiting_approval"
        : name === "usage"
          ? "running"
          : name;
      run.result = null;
      run.require_approval = approvalCase;
      run.capabilities = {
        pause: true,
        resume: true,
        cancel: true,
        approval: true,
      };
      run.backend_cursor = "synthetic-review-cursor";
      const approval: Approval = {
        id: "11111111-1111-4111-8111-111111111111",
        generation: 1,
        action_digest: "a".repeat(64),
        status: name === "approval-denied" ? "denied" : "pending",
        expires_at:
          name === "approval-expired"
            ? "2000-01-01T00:00:00Z"
            : "2099-01-01T00:00:00Z",
        normalized_action: {
          actions: [
            {
              id: "synthetic-tool",
              tool_name: "terminal",
              action: { command: "echo synthetic-review-only" },
            },
          ],
        },
      };
      const usage: Usage = {
        configured: true,
        guest_connected: true,
        request_limit: 10,
        request_slots_consumed: 3,
        uncertain_requests: 1,
        cost_status: "unknown",
        amount_decimal: null,
        hard_money_limit_supported: false,
        published_price_preview: false,
        quote_committed_usd: null,
        quote_uncertain: null,
        fixture_credit_limit_supported: false,
        fixture_credits_committed_microcredits: null,
        fixture_credits_uncertain: null,
      };
      let decisionPosts = 0;
      await page.route(`${base}/api/v1/tasks/${fixture.task_id}`, (route) =>
        route.fulfill({ json: detail }),
      );
      await page.route(
        `${base}/api/v1/runs/${fixture.run_id}/approvals`,
        (route) =>
          route.fulfill(
            name === "approval-fetch-error"
              ? { status: 503, json: { error: "synthetic_review_unavailable" } }
              : { json: { items: approvalCase ? [approval] : [] } },
          ),
      );
      if (name === "usage")
        await page.route(
          `${base}/api/v1/runs/${fixture.run_id}/usage`,
          (route) => route.fulfill({ json: usage }),
        );
      if (["approval-accepted", "approval-decision-error"].includes(name))
        await page.route(
          `${base}/api/v1/approvals/${approval.id}/decision`,
          (route) => {
            expect(route.request().method()).toBe("POST");
            decisionPosts++;
            return route.fulfill(
              name === "approval-accepted"
                ? { status: 202, json: { status: "pending" } }
                : {
                    status: 503,
                    json: { error: "synthetic_review_unavailable" },
                  },
            );
          },
        );
      await page.goto(`/#${fixture.task_id}`);
      // Same-hash navigation alone retains React Query's non-polling usage cache.
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "100 durable events", exact: true }),
      ).toBeVisible();
      if (name === "pausing") {
        await expect(page.locator(".run-summary .state")).toHaveText(
          "正在暫停",
        );
        await expect(
          page.getByLabel("執行紀錄").locator("option:checked"),
        ).toContainText("正在暫停");
      } else if (["paused", "resuming", "cancelling"].includes(name))
        await expect(page.locator(`.run-summary .state-${name}`)).toBeVisible();
      if (approvalCase && name !== "approval-fetch-error") {
        const panel = page.getByRole("region", { name: "工具審批" });
        await expect(panel).toBeVisible();
        const formatted = await page.evaluate(
          (value) =>
            new Date(value).toLocaleString("zh-TW", {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }),
          approval.expires_at,
        );
        await expect(panel.getByText(/有效至/)).toHaveText(
          `有效至 ${formatted}`,
        );
        if (name === "approval-expired") {
          await expect(
            panel.getByRole("heading", { name: "審批已逾期" }),
          ).toBeVisible();
          await expect(
            panel.getByRole("button", { name: "核准這批操作" }),
          ).toBeDisabled();
        } else if (name === "approval-denied") {
          await expect(
            panel.getByRole("heading", { name: "已拒絕，正在停止環境" }),
          ).toBeVisible();
          await expect(
            panel.getByRole("button", { name: "核准這批操作" }),
          ).toBeDisabled();
        } else if (name === "approval-pending")
          await expect(
            panel.getByRole("button", { name: "核准這批操作" }),
          ).toBeEnabled();
        else {
          await panel.getByRole("button", { name: "核准這批操作" }).click();
          await expect.poll(() => decisionPosts).toBe(1);
          if (name === "approval-accepted")
            await expect(panel.getByRole("status")).toHaveClass("notice");
          else await expect(panel.getByRole("alert")).toHaveClass("error");
        }
      }
      if (name === "approval-fetch-error")
        await expect(page.locator(".detail-body [role=alert]")).toHaveClass(
          "error",
          { timeout: 15000 },
        );
      if (name === "usage")
        await expect(
          page.getByRole("region", { name: "模型用量" }),
        ).toContainText("3 / 10");
      await capture(page, name, "override");
      steps.push({
        name,
        status: "passed",
        evidenceKind: "page.route supplement, not backend capability",
        decisionPosts,
      });
      await page.unrouteAll({ behavior: "wait" });
    }
    phase = "restore-real";
    await page.goto(`/#${fixture.task_id}`);
    await page.reload();
    await expect(page.locator(".run-summary .state")).toHaveText("已完成");
    expect(await counts()).toEqual(effects);
    const finalDetail = (await (
      await page.request.get(`/api/v1/tasks/${fixture.task_id}`)
    ).json()) as TaskDetail;
    expect(finalDetail).toEqual(original);
    steps.push({
      name: "override-removal-restores-unchanged-real-state",
      status: "passed",
      effects,
    });
    expect(health.filter((item) => item.kind === "pageerror")).toHaveLength(0);
  } catch (error) {
    failurePhase = phase;
    failure =
      error instanceof Error
        ? error.message
            .replace(/\u001b\[[0-9;]*m/g, "")
            .replace(/\/home\/\S+/g, "<private-path>")
        : "unknown_failure";
    for (const secret of secrets)
      failure = failure.split(secret).join("<redacted>");
    throw error;
  } finally {
    phase = "cleanup";
    const cleanupFailures = await cleanupAll([
      async () => {
        if (context) await context.close();
      },
      async () => {
        if (producer)
          shutdown.push({ process: "produce", ...(await producer.stop()) });
      },
      async () => {
        if (server) {
          const result = await server.stop();
          const graceful = confirmedFixtureShutdown(result, server.log);
          shutdown.push({ process: "serve", ...result, graceful });
          expect(graceful).toBe(true);
        }
      },
    ]);
    await mkdir(join(cwd, "fe-review/runs/.state"), {
      recursive: true,
      mode: 0o700,
    });
    for (const [name, process] of [
      ["serve", server],
      ["produce", producer],
    ] as const) {
      if (process) {
        let redacted = process.log;
        for (const secret of secrets)
          redacted = redacted.split(secret).join("<redacted>");
        await writeFile(
          join(cwd, "fe-review/runs/.state", `${id}-${name}.log`),
          redacted,
          { mode: 0o600 },
        );
      }
    }
    const receipt = {
      schema: 1,
      runId: id,
      status: failure || cleanupFailures.length ? "failed" : "passed",
      failure,
      failurePhase,
      sourceHashes,
      versions: { node: process.version, browser: browser.version() },
      isolation:
        "root-owned fresh PostgreSQL namespace; loopback true FastAPI + fake backend",
      captures,
      steps,
      health,
      shutdown,
      cleanupFailures,
      limits: [
        "Page.route supplements do not prove real pause, approval or model usage",
        "No full Round3 accessibility/performance acceptance",
        "Screenshots and auth state are local ignored artifacts",
      ],
    };
    await writeFile(
      join(output, "capture.json"),
      publicText(receipt, secrets) + "\n",
    );
    // Preserve the original runtime assertion as the primary exception.
    if (!failure) expect(cleanupFailures).toEqual([]);
  }
});
