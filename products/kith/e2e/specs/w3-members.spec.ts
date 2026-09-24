import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi } from "../fixtures/actors.ts";
import { note, shot } from "../harness/evidence.ts";

function panel(page: Page) {
  return page.getByTestId("members-panel");
}

async function expectPanel(page: Page, project: string): Promise<void> {
  if (project === "mobile") {
    await page.getByTestId("room-members-open").click();
    await expect(page.getByTestId("members-sheet").getByTestId("members-panel")).toBeVisible();
  } else {
    await expect(page.getByTestId("members-aside").getByTestId("members-panel")).toBeVisible();
  }
}

const COPY = {
  desktop: {
    wakeAnyone: "房內的人都能喚醒",
    mention: "被 @ 時",
    sidecarOff: "未啟用 · 需要 operator 的電腦",
    silent: "安靜",
  },
  mobile: {
    wakeAnyone: "Anyone in the room",
    mention: "On mention",
    sidecarOff: "Not enabled · Requires the operator's computer",
    silent: "Silent",
  },
} as const;

test(
  "E2E-W3-01 member panel shows people, AI, limits and operator actions",
  { tag: ["@W3", "@mobile"] },
  async ({ page, api }, info) => {
    test.setTimeout(180_000);
    const project = info.project.name === "mobile" ? "mobile" : "desktop";
    const copy = COPY[project];
    const rand = Date.now().toString(36);

    await loginViaUi(page, ACCOUNTS.ben);
    await page.goto("/r/lobby");
    await expectPanel(page, project);
    const humans = panel(page).getByTestId("members-group-human");
    const agents = panel(page).getByTestId("members-group-agent");
    for (const handle of ["ada", "ben", "chen"]) {
      await expect(humans.locator(`[data-testid="members-row"][data-handle="${handle}"]`)).toBeVisible();
    }
    for (const handle of ["grok", "codex"]) {
      await expect(agents.locator(`[data-testid="members-row"][data-handle="${handle}"]`)).toBeVisible();
    }
    const grok = agents.locator('[data-testid="members-row"][data-handle="grok"]');
    const codex = agents.locator('[data-testid="members-row"][data-handle="codex"]');
    await expect(grok.getByTestId("members-limit")).toContainText("hello from grok");
    await expect(codex.getByTestId("members-badge-operator-only")).toBeVisible();
    await expect(codex.getByTestId("members-limit")).toHaveCount(0);
    await expect(agents.getByTestId("members-badge-ai")).toHaveCount(2);
    await expect(panel(page).getByTestId("members-row-menu")).toHaveCount(0);
    await shot(page, info, "01-panel-ben");

    await grok.getByTestId("members-open-agent").click();
    await expect(page.getByTestId("agent-detail")).toBeVisible();
    await expect(page.getByTestId("agent-detail-wake")).toHaveText(copy.wakeAnyone);
    await expect(page.getByTestId("agent-detail-attention")).toHaveText(copy.mention);
    await expect(page.getByTestId("agent-detail-limit")).toContainText("hello from grok");
    await shot(page, info, "02-agent-detail");

    await page.getByTestId("agent-detail-back").click();
    await expect(agents).toBeVisible();

    if (project === "mobile") return;

    // QueryClient retries a 500 while failureCount < 2 (three attempts). One 500 does not stay failed.
    let blockMembers = true;
    await page.route("**/api/rooms/room-lobby/members", (route) => {
      if (blockMembers) return route.fulfill({ status: 500, body: "" });
      return route.continue();
    });
    await page.reload();
    await expect(page.getByTestId("members-error")).toBeVisible();
    await expect(page.getByTestId("members-group-human")).toHaveCount(0);
    blockMembers = false;
    await page.getByTestId("members-retry").click();
    await expect(page.getByTestId("members-group-human")).toBeVisible();
    await expect(page.getByTestId("members-error")).toHaveCount(0);
    note(info, "member load failure shows retry without an empty list");

    await page.context().clearCookies();
    await loginViaUi(page, ACCOUNTS.ada);
    await page.goto("/r/lobby");
    await expect(page.getByTestId("members-aside").getByTestId("members-panel")).toBeVisible();
    const adaCodex = page.locator('[data-testid="members-group-agent"] [data-testid="members-row"][data-handle="codex"]');
    await expect(adaCodex.getByTestId("members-limit")).toHaveText(copy.sidecarOff);
    await expect(adaCodex.getByTestId("members-badge-operator-only")).toHaveCount(0);
    await expect(page.getByTestId("members-invite")).toBeVisible();
    await shot(page, info, "03-panel-ada");

    const slug = "w3-panel-" + rand;
    const created = await api.call("POST", "/api/rooms", { slug, name: "Panel " + rand });
    expect(created.status).toBe(200);
    const roomId = (created.json as { id: string }).id;
    expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle: "ben" })).status).toBe(200);
    expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle: "grok" })).status).toBe(200);
    await page.goto("/r/" + slug);
    await expect(page.getByTestId("members-panel")).toBeVisible();
    const benRow = page.locator('[data-testid="members-row"][data-handle="ben"]');
    await benRow.getByTestId("members-row-menu").click();
    await page.getByTestId("members-action-remove").click();
    await page.getByTestId("remove-confirm").click();
    await expect(benRow).toHaveCount(0);
    await expect(page.getByTestId("room-members-open")).toHaveAttribute("aria-label", /2/);

    const grokRow = page.locator('[data-testid="members-row"][data-handle="grok"]');
    await grokRow.getByTestId("members-row-menu").click();
    await page.getByTestId("members-action-attention").click();
    await page.getByTestId("attention-mode-silent").click();
    await page.getByTestId("attention-submit").click();
    await expect(page.getByTestId("attention-submit")).toHaveCount(0);
    await grokRow.getByTestId("members-open-agent").click();
    await expect(page.getByTestId("agent-detail-attention")).toHaveText(copy.silent);

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/r/lobby");
    const origin = page.locator('[data-testid="message-row"][data-seq="0"]');
    const timeline = page.getByTestId("timeline");
    await expect(async () => {
      if (!(await origin.isVisible())) {
        await timeline.evaluate((el) => {
          el.scrollTop = Math.max(0, el.scrollTop - el.clientHeight);
        });
      }
      await expect(origin).toBeVisible({ timeout: 1_000 });
      await origin.hover({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await origin.getByTestId("message-actions").click();
    await page.getByTestId("message-action-copy").click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("歡迎來到 Kith，這裡是 Lobby。");
    await origin.hover();
    await origin.getByTestId("message-actions").click();
    await page.getByTestId("message-action-details").click();
    await expect(page.getByTestId("message-details-seq")).toHaveText("0");
    await expect(page.getByTestId("message-details-client_message_id")).toHaveText("seed-lobby-00");
    await shot(page, info, "04-details");
  },
);
