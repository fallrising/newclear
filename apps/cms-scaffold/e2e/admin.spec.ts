import { expect, test, type Page } from "@playwright/test";
import { ADMIN, API, BACK, expectHeading, login } from "./helpers";

type AuditEvent = { id: string; action: string; targetId: string | null; detail: Record<string, unknown> | null };
async function openAuditEvent(page: Page, id: string): Promise<AuditEvent> {
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/admin/audit/${id}` && r.request().method() === "GET");
  await page.locator(`a[href="/audit/${id}"]`).click();
  const actual = await response;
  expect(actual.status()).toBe(200);
  const event = await actual.json() as AuditEvent;
  expect(event.id).toBe(id);
  if (event.detail === null) {
    await expect(page.getByTestId("audit-detail-none")).toHaveText("這筆事件沒有其他內容。");
    await expect(page.getByTestId("audit-detail-none")).toBeVisible();
    await expect(page.getByTestId("audit-detail-json")).toHaveCount(0);
  } else {
    await expect(page.getByTestId("audit-detail-json")).toBeVisible();
    expect(JSON.parse(await page.getByTestId("audit-detail-json").innerText())).toEqual(event.detail);
    await expect(page.getByTestId("audit-detail-none")).toHaveCount(0);
  }
  return event;
}

test.describe("W5 real Admin", () => {
  test.describe.configure({ mode: "serial" });

  test("W5 real Admin overview types and principals", async ({ page }) => {
    await login(page, ADMIN, "seed-admin");
    await expectHeading(page, "總覽");
    await expect(page.getByText("類型啟停、角色與使用者、審計與儲存。日常編輯請用 Back office。", { exact: true })).toBeVisible();
    await page.getByTestId("nav-types").click(); await expectHeading(page, "內容類型");
    await expect(page.getByTestId("index-row").filter({ hasText: "album" })).toBeVisible();
    await page.getByTestId("nav-principals").click(); await expectHeading(page, "使用者");
    await expect(page.getByTestId("index-row").filter({ hasText: "seed-admin" })).toBeVisible();
    await expect(page.getByTestId("nav-audit")).toBeVisible();
    await expect(page.getByRole("link", { name: "專案看板", exact: true })).toHaveCount(0);
    // Preserve the prior cross-surface navigation isolation regression.
    await login(page, BACK, "seed-admin"); await expectHeading(page, "作業台");
    await expect(page.getByRole("navigation", { name: "主要導覽" }).getByRole("link", { name: "內容類型", exact: true })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "主要導覽" }).getByRole("link", { name: "設定", exact: true })).toHaveCount(0);
  });

  test("W5 real Admin audit list and detail", async ({ page }) => {
    await login(page, ADMIN, "seed-admin");
    await page.goto(`${ADMIN}/audit`); await expectHeading(page, "審計");
    const href = await page.getByTestId("index-row").first().locator('a[href^="/audit/"]').getAttribute("href");
    expect(href).toMatch(/^\/audit\/[0-9a-f-]{36}$/i);
    await openAuditEvent(page, href!.slice("/audit/".length));

    const targetId = process.env.CMS_E2E_AUDIT_TARGET_ID;
    expect(targetId, "global setup provides only the newly created owned album").toMatch(/^[0-9a-f-]{36}$/i);
    await page.goto(`${ADMIN}/audit?targetId=${targetId}`);
    await expectHeading(page, "審計");
    await expect(page.getByTestId("audit-target-filter")).toBeVisible();
    await page.getByTestId("audit-action").click();
    await page.getByRole("option", { name: "發布條目", exact: true }).click();
    const filtered = page.waitForResponse((r) => {
      const url = new URL(r.url());
      return url.origin === API && url.pathname === "/api/v1/admin/audit" && r.request().method() === "GET"
        && url.searchParams.get("action") === "entry.publish" && url.searchParams.get("targetId") === targetId;
    });
    await page.getByTestId("audit-apply").click();
    const actual = await filtered; expect(actual.status()).toBe(200);
    const body = await actual.json() as { items: AuditEvent[]; total: number };
    expect(body.total).toBe(1); expect(body.items).toHaveLength(1);
    expect(body.items[0].action).toBe("entry.publish"); expect(body.items[0].targetId).toBe(targetId);
    await expect(page.getByTestId("index-row")).toHaveCount(1);
    const event = await openAuditEvent(page, body.items[0].id);
    expect(event.action).toBe("entry.publish"); expect(event.targetId).toBe(targetId);
    expect(event.detail).not.toBeNull();
    expect(Number.isInteger(event.detail?.revisionNo)).toBe(true);
    expect(event.detail?.revisionNo).toBeGreaterThan(0);
  });

  test("W5 real Admin operator is forbidden", async ({ page }) => {
    await login(page, ADMIN, "seed-operator-album");
    await expect(page.getByRole("alert")).toContainText("這個帳號不能使用這個作業台。");
    for (const id of ["nav-types", "nav-principals", "nav-audit"]) await expect(page.getByTestId(id)).toHaveCount(0);
  });
});
