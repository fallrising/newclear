import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi } from "../fixtures/actors.ts";
import { note, shot } from "../harness/evidence.ts";

test(
  "E2E-W3-04 members cannot wake operator_personal agents and see it beforehand",
  { tag: ["@W3"] },
  async ({ page, api }, info) => {
    const rand = Date.now().toString(36);
    await loginViaUi(page, ACCOUNTS.ben);
    await page.goto("/r/lobby");
    const input = page.getByTestId("composer-input");
    await input.fill("@co");
    const option = page.locator('[data-testid="mention-option"][data-handle="codex"]');
    await expect(option).toBeVisible();
    await expect(option.getByTestId("mention-option-operator-only")).toBeVisible();
    await expect(
      page.locator('[data-testid="members-row"][data-handle="codex"]').getByTestId("members-badge-operator-only"),
    ).toBeVisible();
    await shot(page, info, "01-limit-visible");

    await option.click();
    await input.pressSequentially("修一下 bug " + rand);
    await input.press("Enter");
    const body = "@codex 修一下 bug " + rand;
    await expect(page.getByTestId("message-row").filter({ hasText: rand })).toBeVisible();
    await page.waitForTimeout(3000);
    await expect(page.getByTestId("reply-placeholder")).toHaveCount(0);
    const history = await api.call("GET", "/api/rooms/room-lobby/messages?order=desc&limit=1");
    expect(history.status).toBe(200);
    const messages = (history.json as { messages: { body: string }[] }).messages;
    expect(messages[messages.length - 1]?.body).toBe(body);
    note(info, "operator_personal mention persisted without any replying state (UJ-06)");
    await shot(page, info, "02-no-reply");
  },
);
