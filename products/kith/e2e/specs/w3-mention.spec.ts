import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi, openActor } from "../fixtures/actors.ts";
import { note, shot } from "../harness/evidence.ts";

async function expectLive(page: Page): Promise<void> {
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByTestId("room-connection")).toHaveCount(0);
  await expect(page.getByTestId("room-offline-strip")).toHaveCount(0);
}

test(
  "E2E-W3-02 mention autocomplete follows the keyboard rules",
  { tag: ["@W3"] },
  async ({ page, browser, recorder }, info) => {
    const rand = Date.now().toString(36);
    await loginViaUi(page, ACCOUNTS.ada);
    await page.goto("/r/lobby");
    await expectLive(page);
    await expect(page.getByTestId("members-panel")).toBeVisible();
    const input = page.getByTestId("composer-input");

    await input.fill("");
    await input.pressSequentially("@");
    await expect(page.getByTestId("mention-listbox")).toBeVisible();
    await expect(page.getByTestId("mention-option")).toHaveCount(5);
    const firstId = await page.getByTestId("mention-option").first().getAttribute("id");
    await expect(input).toHaveAttribute("aria-expanded", "true");
    await expect(input).toHaveAttribute("aria-activedescendant", firstId ?? "");
    await expect(input).toBeFocused();
    await shot(page, info, "01-list");

    await input.pressSequentially("gr");
    await expect(page.getByTestId("mention-option")).toHaveCount(1);
    await expect(page.getByTestId("mention-option")).toHaveAttribute("data-handle", "grok");
    await expect(page.getByTestId("mention-option-limit")).toContainText("hello from grok");

    await input.press("Backspace");
    await input.press("Backspace");
    await input.press("ArrowDown");
    const secondId = await page.getByTestId("mention-option").nth(1).getAttribute("id");
    await expect(input).toHaveAttribute("aria-activedescendant", secondId ?? "");

    await input.fill("");
    await input.pressSequentially("@gr");
    await input.press("Enter");
    await expect(page.getByTestId("mention-listbox")).toHaveCount(0);
    await expect(input).toHaveValue("@grok ");
    await expect(page.getByTestId("pending-row")).toHaveCount(0);

    await input.pressSequentially("and @co");
    await page.locator('[data-testid="mention-option"][data-handle="codex"]').click();
    await expect(page.getByTestId("mention-listbox")).toHaveCount(0);
    await expect(input).toHaveValue("@grok and @codex ");

    await input.fill("");
    await input.pressSequentially("@b");
    await input.press("Escape");
    await expect(page.getByTestId("mention-listbox")).toHaveCount(0);
    await expect(input).toHaveValue("@b");
    await input.pressSequentially("e");
    await expect(page.getByTestId("mention-listbox")).toHaveCount(0);

    await input.fill("");
    await input.pressSequentially("@c");
    await input.press("Shift+Enter");
    await expect(page.getByTestId("mention-listbox")).toHaveCount(0);
    await expect(input).toHaveValue("@c\n");

    await input.fill("");
    await input.pressSequentially("@g");
    await input.evaluate((el) => {
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          keyCode: 229,
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
    await expect(page.getByTestId("mention-listbox")).toBeVisible();
    await expect(input).toHaveValue("@g");
    note(info, "Enter during IME composition neither picks nor sends");

    await input.fill("@ben 看這裡 " + rand);
    await input.press("Enter");
    const row = page.getByTestId("message-row").filter({ hasText: rand });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("mention")).toHaveCount(1);
    await expect(row.locator('[data-testid="mention"][data-handle="ben"]')).toHaveCount(1);

    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben" });
    try {
      await ben.page.goto("/r/lobby");
      const benRow = ben.page.getByTestId("message-row").filter({ hasText: rand });
      await expect(benRow).toBeVisible();
      await expect(benRow).toHaveAttribute("data-mentions-me", "true");
      await shot(ben.page, info, "02-mentions-me");
    } finally {
      await ben.context.close();
    }

    await page.keyboard.press("Control+K");
    await expect(page.getByTestId("quick-switcher")).toBeVisible();
    await expect(page.getByTestId("quick-switcher-input")).toBeFocused();
    await page.getByTestId("quick-switcher-input").pressSequentially("quiet");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/r\/quiet$/);
    await expect(page.getByTestId("quick-switcher")).toHaveCount(0);

    const slugs = await page.getByTestId("room-list-item").evaluateAll((els) => els.map((el) => el.getAttribute("data-slug")));
    const index = slugs.indexOf("quiet");
    const previous = slugs[(index - 1 + slugs.length) % slugs.length];
    await page.keyboard.press("Alt+ArrowUp");
    await expect(page).toHaveURL(new RegExp("/r/" + previous + "$"));

    await page.keyboard.press("Control+/");
    await expect(page.getByTestId("shortcuts-dialog")).toBeVisible();
    await expect(page.getByTestId("shortcuts-dialog").locator("tr")).toHaveCount(5);
    await shot(page, info, "03-shortcuts");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shortcuts-dialog")).toHaveCount(0);
  },
);
