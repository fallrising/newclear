import { randomBytes } from "node:crypto";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS, PROVIDER_CANARY } from "../fixtures/accounts.ts";
import { loginViaUi, openActor } from "../fixtures/actors.ts";
import { FAKE, createHostedAgentViaApi, createProviderViaApi, fakeProviderLog, inviteAgentViaApi } from "../fixtures/console.ts";
import { note, shot } from "../harness/evidence.ts";

const SECRET_INVALID = "金鑰前後不能有空白，也不能包含換行";
const TEST_FAILED = "連線失敗：憑證被拒絕";

test(
  "E2E-W4-01 operator adds an OpenAI-compatible provider, tests it and lists models",
  { tag: ["@W4"] },
  async ({ page, browser, recorder, api }, info) => {
    test.setTimeout(120_000);
    const rand = randomBytes(3).toString("hex");
    const name = "w4p-openai-" + rand;
    await loginViaUi(page, ACCOUNTS.ada);
    await page.goto("/console");
    await expect(page.getByTestId("console-nav-agents")).toBeVisible();
    await expect(page).toHaveURL(/\/console\/agents$/);
    const nav = await page.locator("[data-testid^=console-nav-]").evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
    expect(nav).toEqual(["console-nav-agents", "console-nav-providers", "console-nav-people", "console-nav-rooms"]);

    await page.getByTestId("console-nav-providers").click();
    await page.getByTestId("providers-add").click();
    await expect(page.getByTestId("provider-preset")).toBeVisible();
    await expect(page.getByTestId("provider-save")).toBeDisabled();
    await shot(page, info, "01-empty-form");

    await page.getByTestId("provider-preset").selectOption("custom");
    await page.getByTestId("provider-format").selectOption("openai_chat");
    await page.getByTestId("provider-name").fill(name);
    await page.getByTestId("provider-base-url").fill(FAKE().openai);
    await page.getByTestId("provider-secret").fill(PROVIDER_CANARY + " ");
    await expect(page.getByTestId("provider-secret-error")).toBeVisible();
    await expect(page.getByTestId("provider-secret-error")).toHaveText(SECRET_INVALID);

    await page.getByTestId("provider-secret").fill("sk-wrong");
    await page.getByTestId("provider-test").click();
    await expect(page.getByTestId("provider-test-result")).toBeVisible();
    await expect(page.getByTestId("provider-test-result")).toHaveAttribute("data-ok", "false");
    await expect(page.getByTestId("provider-test-result")).toHaveText(TEST_FAILED);
    await shot(page, info, "02-test-failed");

    await page.getByTestId("provider-secret").fill(PROVIDER_CANARY);
    await page.getByTestId("provider-test").click();
    await expect(page.locator('[data-testid="provider-test-result"][data-ok="true"]')).toBeVisible();
    await expect(page.getByTestId("provider-test-result")).toContainText("2");
    await expect(page.getByTestId("provider-test-models").locator("li")).toHaveText(["fake-chat", "fake-chat-mini"]);
    await shot(page, info, "03-test-ok");

    await page.getByTestId("provider-quota-api_key").click();
    await page.getByTestId("provider-save").click();
    await expect(page).toHaveURL(/\/console\/providers$/);
    const row = page.locator(`[data-testid="provider-row"][data-name="${name}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId("provider-status")).toHaveAttribute("data-status", "untested");
    await expect(row).toContainText("5b7e");
    await shot(page, info, "04-list");

    await row.getByTestId("provider-open").click();
    await page.getByTestId("provider-test").click();
    await expect(page.locator('[data-testid="provider-test-result"][data-ok="true"]')).toBeVisible();
    await page.goto("/console/providers");
    await expect(page.locator(`[data-testid="provider-row"][data-name="${name}"]`).getByTestId("provider-status")).toHaveAttribute("data-status", "ok");

    const anthropic = await api.call("POST", "/api/providers/test", {
      preset: "custom",
      api_format: "anthropic_messages",
      base_url: FAKE().anthropic + "/v1/",
      secret_source: "stored",
      secret: PROVIDER_CANARY,
    });
    expect(anthropic.status).toBe(200);
    expect((anthropic.json as { models: string[] }).models).toEqual(["fake-claude", "fake-claude-haiku"]);
    note(info, "anthropic base URL with a trailing /v1/ is normalized");

    const loopback = await api.call("POST", "/api/providers/test", {
      preset: "custom",
      api_format: "openai_chat",
      base_url: "https://127.0.0.1/v1",
      secret_source: "none",
    });
    expect(loopback.status).toBe(200);
    const ftp = await api.call("POST", "/api/providers/test", {
      preset: "custom",
      api_format: "openai_chat",
      base_url: "ftp://x",
      secret_source: "none",
    });
    expect(ftp.status).toBe(400);
    expect((ftp.json as { error: { code: string } }).error.code).toBe("invalid_request");
    const extra = await api.call("POST", "/api/providers/test", {
      preset: "custom",
      api_format: "openai_chat",
      base_url: FAKE().openai,
      secret_source: "stored",
      secret: PROVIDER_CANARY,
      extra_headers: { Authorization: "x" },
    });
    expect(extra.status).toBe(400);

    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben" });
    try {
      const denied = await ben.page.request.get("/api/providers");
      expect(denied.status()).toBe(403);
    } finally {
      await ben.context.close();
    }
  },
);

test("E2E-W4-05 provider key never leaves the server", { tag: ["@W4"] }, async ({ page, browser, recorder, api }, info) => {
  test.setTimeout(180_000);
  const rand = randomBytes(3).toString("hex");
  const seen: string[] = [];
  const watch = (target: typeof page): void => {
    target.on("response", (response) => {
      if (!response.url().includes("/api/")) return;
      void response.text().then(
        (text) => seen.push(text),
        () => seen.push(""),
      );
    });
    target.on("websocket", (ws) => {
      ws.on("framereceived", (frame) => seen.push(String(frame.payload)));
    });
  };
  watch(page);
  await loginViaUi(page, ACCOUNTS.ada);
  const slug = "w4-canary-" + rand;
  const created = await api.call("POST", "/api/rooms", { slug, name: "Canary " + rand });
  expect(created.status).toBe(200);
  const roomId = (created.json as { id: string }).id;
  expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle: "ben" })).status).toBe(200);

  const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben" });
  try {
    watch(ben.page);
    await ben.page.goto("/r/" + slug);
    const pid = await createProviderViaApi(api, { name: "w4c-openai-" + rand, format: "openai_chat" });
    const pid2 = await createProviderViaApi(api, { name: "w4c-anthropic-" + rand, format: "anthropic_messages" });
    expect(pid2.length).toBeGreaterThan(0);
    for (const call of [
      await api.call("GET", "/api/providers"),
      await api.call("GET", "/api/providers/" + pid),
      await api.call("PATCH", "/api/providers/" + pid, { secret: PROVIDER_CANARY }),
      await api.call("POST", "/api/providers/" + pid + "/test"),
    ]) {
      expect(JSON.stringify(call.json)).not.toContain(PROVIDER_CANARY);
      expect(JSON.stringify(call.json)).not.toContain("secret_ciphertext");
    }
    const detail = await api.call("GET", "/api/providers/" + pid);
    expect((detail.json as { provider: { secret_last4: string } }).provider.secret_last4).toBe("5b7e");

    const aid = await createHostedAgentViaApi(api, {
      handle: "w4c_" + rand,
      display_name: "Canary " + rand,
      providerId: pid,
      model: "fake-chat",
    });
    await inviteAgentViaApi(api, roomId, "w4c_" + rand, aid);
    await ben.page.getByTestId("composer-input").fill("@" + "w4c_" + rand + " canary check");
    await ben.page.getByTestId("composer-input").press("Enter");
    await expect(ben.page.getByTestId("message-row").filter({ hasText: "hello from fake-chat" })).toBeVisible({ timeout: 30_000 });
    await page.goto("/r/" + slug);
    await expect(page.getByTestId("timeline")).toBeVisible();
    await expect(page.getByTestId("room-connection")).toHaveCount(0);
    await expect(page.getByTestId("room-offline-strip")).toHaveCount(0);
    await ben.page.getByTestId("composer-input").fill("@" + "w4c_" + rand + " [[fake:status=401]]");
    await ben.page.getByTestId("composer-input").press("Enter");
    await expect(page.getByTestId("reply-failed")).toBeVisible({ timeout: 30_000 });
    await shot(page, info, "01-reply");

    for (const path of ["/api/agents", "/api/agents/" + aid, "/api/rooms/" + roomId + "/members", "/api/metrics"]) {
      const res = await api.call("GET", path);
      expect(JSON.stringify(res.json)).not.toContain(PROVIDER_CANARY);
    }
    const log = await fakeProviderLog();
    const authed = log.filter((entry) => entry.auth_ok && entry.path.startsWith("/openai/v1/"));
    expect(authed.length).toBeGreaterThanOrEqual(3);
    const logText = await import("node:fs").then((fs) => fs.readFileSync(process.env.KITH_E2E_RUN_DIR + "/server.log", "utf8"));
    expect(logText).not.toContain(PROVIDER_CANARY);
    expect(seen.join("\n")).not.toContain(PROVIDER_CANARY);
    note(info, "canary absent from HTTP responses, WS frames and server.log");
  } finally {
    await ben.context.close();
  }
});
