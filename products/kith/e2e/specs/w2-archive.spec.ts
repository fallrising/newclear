import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi, openActor, sendViaComposer } from "../fixtures/actors.ts";
import { note, shot } from "../harness/evidence.ts";

function errorCode(json: unknown): string | undefined {
  if (typeof json !== "object" || json === null || !("error" in json)) return undefined;
  const error = (json as { error: unknown }).error;
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

async function expectLive(page: Page): Promise<void> {
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByTestId("room-connection")).toHaveCount(0);
  await expect(page.getByTestId("room-offline-strip")).toHaveCount(0);
}

test(
  "E2E-W2-05 archived rooms are read-only everywhere and can be restored",
  { tag: ["@W2"] },
  async ({ page, browser, recorder, api }, info) => {
    test.setTimeout(180_000);
    const rand = Date.now().toString(36);
    const slug = "w2-arch-" + rand;
    await loginViaUi(page, ACCOUNTS.ada);
    const created = await api.call("POST", "/api/rooms", { slug, name: "Archive " + rand });
    expect(created.status).toBe(200);
    const roomId = (created.json as { id: string }).id;
    expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle: "ben" })).status).toBe(200);
    expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle: "grok" })).status).toBe(200);
    const issued = await api.call("POST", "/api/agents/m-grok/tokens", {});
    expect(issued.status).toBe(200);
    const tok = (issued.json as { token: string }).token;

    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben" });
    try {
      await ben.page.goto("/r/" + slug);
      await expectLive(ben.page);
      await sendViaComposer(ben.page, "before");
      await expect(ben.page.getByTestId("message-row").filter({ hasText: "before" })).toBeVisible();

      await page.goto("/console/rooms");
      const adminRow = page.locator(`[data-testid="console-room-row"][data-slug="${slug}"]`);
      await adminRow.getByTestId("console-room-archive").click();
      await page.getByTestId("archive-confirm").click();
      await expect(adminRow.getByTestId("console-room-archived-badge")).toBeVisible();
      await shot(page, info, "01-archived-admin");

      await ben.page.reload();
      await expect(ben.page.getByTestId("room-archived-banner")).toBeVisible();
      await expect(ben.page.getByTestId("composer-input")).toBeDisabled();
      await expect(ben.page.getByTestId("composer-archived")).toBeVisible();
      await expect(ben.page.getByTestId("room-unarchive")).toHaveCount(0);
      await shot(ben.page, info, "02-ben-readonly");

      await ben.page.locator('[data-testid="room-list-item"][data-slug="lobby"]').click();
      await expect(ben.page.locator(`[data-testid="room-list-item"][data-slug="${slug}"]`)).toHaveCount(0);
      await ben.page.getByTestId("room-list-archived-toggle").click();
      await expect(ben.page.locator(`[data-testid="room-list-item"][data-slug="${slug}"]`)).toBeVisible();
      await shot(ben.page, info, "03-archived-group");

      const csrfRes = await ben.page.request.get("/api/csrf");
      const csrf = ((await csrfRes.json()) as { csrf: string }).csrf;
      const rest = await ben.page.request.post("/api/rooms/" + roomId + "/messages", {
        headers: { "X-CSRF-Token": csrf, "content-type": "application/json" },
        data: { body: "rest", client_message_id: "e2e-arch-rest-" + rand },
      });
      expect(rest.status()).toBe(409);
      expect(errorCode(await rest.json())).toBe("room_archived");

      const packet = await ben.page.evaluate(
        ({ id, cmid }) =>
          new Promise<string>((resolve, reject) => {
            const url =
              (location.protocol === "https:" ? "wss://" : "ws://") +
              location.host +
              "/api/rooms/" +
              encodeURIComponent(id) +
              "/ws";
            const ws = new WebSocket(url);
            const timer = setTimeout(() => reject(new Error("ws timeout")), 10_000);
            ws.addEventListener("error", () => {
              clearTimeout(timer);
              reject(new Error("ws error"));
            });
            ws.addEventListener("open", () => {
              ws.send(JSON.stringify({ v: 1, type: "send", client_message_id: cmid, body: "ws" }));
            });
            ws.addEventListener("message", (ev) => {
              clearTimeout(timer);
              ws.close();
              resolve(String(ev.data));
            });
          }),
        { id: roomId, cmid: "e2e-arch-ws-" + rand },
      );
      expect(JSON.parse(packet)).toEqual({ v: 1, type: "error", code: "room_archived" });

      const mcp = await api.call(
        "POST",
        "/mcp",
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "send_message",
            arguments: { room_id: roomId, body: "@ben mcp", client_message_id: "e2e-arch-mcp-" + rand },
          },
        },
        { Authorization: "Bearer " + tok },
      );
      expect(mcp.status).toBe(409);
      expect(errorCode(mcp.json)).toBe("room_archived");

      const history = await api.call("GET", "/api/rooms/" + roomId + "/messages?order=desc&limit=5");
      expect(history.status).toBe(200);
      const messages = (history.json as { messages: { body: string }[] }).messages;
      expect(messages[messages.length - 1]?.body).toBe("before");
      note(info, "WS, REST and MCP sends are rejected with room_archived; nothing persisted so nothing can wake");

      await page.goto("/r/" + slug);
      await page.getByTestId("room-unarchive").click();
      await expect(page.getByTestId("room-archived-banner")).toHaveCount(0);

      await ben.page.goto("/r/" + slug);
      await ben.page.reload();
      await expectLive(ben.page);
      await expect(ben.page.getByTestId("composer-input")).toBeEnabled();
      await sendViaComposer(ben.page, "after");
      await expect(ben.page.getByTestId("message-row").filter({ hasText: "after" })).toBeVisible();
      note(info, "unarchive restores sending");
      await shot(ben.page, info, "04-restored");
    } finally {
      await ben.context.close();
    }
  },
);
