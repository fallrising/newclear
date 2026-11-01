import { expect, test, type Page, type Request } from "@playwright/test";
import { readFileSync } from "node:fs";
import { ADMIN, expectNoSeriousA11yViolations } from "./helpers";

// Seed ids from docs/v2/contracts/fixtures.
const OPERATOR_ALBUM = "10000000-0000-4000-8000-000000000003";
const COAST = "30000000-0000-4000-8000-000000000001";
const BETTY = "30000000-0000-4000-8000-000000000017";
const RETENTION_EVENT = "70000000-0000-4000-8000-000000000007";
const FORBIDDEN_WORDS = ["PATCH", "sortOrder", "origin", "(string)"];
const AS_ADMIN = "mockUser=seed-admin";

async function settled(page: Page) {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("query-loading")).toHaveCount(0);
  await expect(page.getByTestId("index-row-loading")).toHaveCount(0);
}

test.describe("W4 Admin", () => {
  for (const [name, path] of [
    ["overview", "/"],
    ["types", "/types"],
    ["type detail", "/types/owner"],
    ["roles", "/roles"],
    ["role matrix", "/roles/member"],
    ["principals", "/principals"],
    ["new principal", "/principals/new"],
    ["principal detail", `/principals/${OPERATOR_ALBUM}`],
    ["audit", "/audit"],
    ["audit detail", `/audit/${RETENTION_EVENT}`],
    ["media", "/media"],
    ["settings", "/settings"],
    ["audit retention", "/settings/audit"],
    ["entry lookup", "/entries?type=album"],
    ["entry inspector", `/entries/${BETTY}`],
    ["403", "/403"],
    ["404", "/impersonate"],
  ] as const) {
    test(`V2-AC-14 V2-AC-15 axe and copy: ${name}`, async ({ page }) => {
      await page.goto(`${ADMIN}${path}${path.includes("?") ? "&" : "?"}${AS_ADMIN}`);
      await settled(page);
      await expectNoSeriousA11yViolations(page);
      const text = await page.locator("body").innerText();
      for (const word of FORBIDDEN_WORDS) expect(text).not.toContain(word);
    });
  }

  test("V2-AC-16 C-19 disabling a type needs its name typed (the dialog passes axe)", async ({ page }) => {
    await page.goto(`${ADMIN}/types/photo?${AS_ADMIN}`);
    await page.getByTestId("type-toggle").click();
    const dialog = page.getByTestId("confirm-dialog");
    await expect(dialog.getByTestId("confirm-submit")).toBeDisabled();
    await expectNoSeriousA11yViolations(page);
    await dialog.getByTestId("confirm-input").fill("Photo");
    const request = page.waitForRequest((r) => r.url().endsWith("/api/v1/admin/content-types/photo/disable"));
    await dialog.getByTestId("confirm-submit").click();
    await request;
    await expect(page.getByText("已停用「Photo」")).toBeVisible();
    await expect(page.getByTestId("page-header").getByText("已停用")).toBeVisible();
  });

  test("AC-K the matrix saves explicitly; leaving with changes asks, closing the tab triggers beforeunload", async ({ page }) => {
    await page.goto(`${ADMIN}/roles/editor?${AS_ADMIN}`);
    await page.getByTestId("cell-publish-album").click();
    await expect(page.getByTestId("save-bar")).toBeVisible();
    await page.getByTestId("nav-audit").click();
    await expect(page.getByTestId("leave-dialog")).toBeVisible();
    await page.getByTestId("leave-stay").click();
    await expect(page.getByTestId("cell-publish-album")).toBeChecked();
    const dialog = page.waitForEvent("dialog");
    await page.close({ runBeforeUnload: true });
    expect((await dialog).type()).toBe("beforeunload");
  });

  test("AC-K one PUT with the whole list after the diff dialog", async ({ page }) => {
    await page.goto(`${ADMIN}/roles/editor?${AS_ADMIN}`);
    await page.getByTestId("cell-publish-album").click();
    await page.getByTestId("save-bar-save").click();
    await expect(page.getByTestId("confirm-dialog")).toContainText("新增 1 項、移除 0 項");
    const request = page.waitForRequest((r) => r.method() === "PUT");
    await page.getByTestId("confirm-submit").click();
    expect((await request).postDataJSON()).toHaveLength(6);
    await expect(page.getByText("已儲存權限")).toBeVisible();
    await expect(page.getByTestId("save-bar")).toHaveCount(0);
  });

  test("flow B AC-D create a principal: the temporary password shows once, then the detail page", async ({ page }) => {
    await page.goto(`${ADMIN}/principals/new?${AS_ADMIN}`);
    await page.getByTestId("new-username").fill("clinic.op");
    await page.getByTestId("role-operator").click();
    for (const type of ["owner", "pet", "vet", "visit"]) await page.getByTestId(`role-operator-type-${type}`).click();
    await page.getByTestId("new-submit").click();
    await expect(page.getByTestId("temp-password")).toHaveText(/^mock-temporary-password-\d+$/);
    await expectNoSeriousA11yViolations(page);
    await page.getByTestId("password-done").click();
    await expect(page.getByRole("heading", { level: 1, name: "clinic.op" })).toBeVisible();
    await expect(page.getByTestId("role-operator-type-visit")).toBeChecked();
  });

  test("A-S3 the audit action filter (Radix Select in a form) reaches the URL and the API", async ({ page }) => {
    await page.goto(`${ADMIN}/audit?${AS_ADMIN}`);
    await settled(page);
    await page.getByTestId("audit-action").click();
    await page.getByRole("option", { name: "發布條目" }).click();
    const request = page.waitForRequest((r) => r.url().includes("/api/v1/admin/audit?") && r.url().includes("action=entry.publish"));
    await page.getByTestId("audit-apply").click();
    await request;
    await expect(page).toHaveURL(/action=entry\.publish/);
    await expect(page.getByTestId("index-row")).toHaveCount(3);
  });

  test("flow C AC-E from an entry's history to its audit events and back", async ({ page }) => {
    await page.goto(`${ADMIN}/entries/${COAST}?${AS_ADMIN}`);
    await expect(page.getByTestId("entry-history-row")).toHaveCount(2);
    await page.getByRole("link", { name: "在審計中查看全部" }).click();
    await expect(page).toHaveURL(new RegExp(`/audit\\?targetId=${COAST}`));
    await expect(page.getByTestId("index-row")).toHaveCount(2);
    await page.getByTestId("audit-target-link").first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Coast Light 2026" })).toBeVisible();
  });

  test("01 Q-13 B link a member account to an owner entry", async ({ page }) => {
    const entryPath = `/api/v1/entries/${BETTY}`;
    const initialRead = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === entryPath);
    const writes: Request[] = [];
    page.on("request", request => { if (request.method() === "PATCH") writes.push(request); });
    await page.goto(`${ADMIN}/entries/${BETTY}?${AS_ADMIN}`);
    const initialResponse = await initialRead;
    expect(initialResponse.status()).toBe(200);
    const initialEntry = await initialResponse.json() as { id: string; version: number };
    const packagedEntries = JSON.parse(readFileSync("packages/mocks/fixtures/work-entries.json", "utf8")) as { id: string; version: number }[];
    const packagedVersion = packagedEntries.find(entry => entry.id === BETTY)!.version;
    expect(packagedVersion).toBe(2);
    expect(initialEntry.id).toBe(BETTY);
    expect(initialEntry.version).toBe(packagedVersion);
    await page.getByTestId("member-edit").click();
    const dialog = page.getByTestId("member-dialog");
    await dialog.getByTestId("member-search").fill("member");
    await expect(dialog.getByTestId("member-option")).toHaveCount(2);
    await expectNoSeriousA11yViolations(page);
    await dialog.getByLabel(/Clinic member/).click();
    const request = page.waitForRequest(request => request.method() === "PATCH" && new URL(request.url()).pathname === entryPath);
    await dialog.getByTestId("member-save").click();
    const patch = await request;
    const expectedBody = { version: initialEntry.version, payload: { ownerPrincipalId: "10000000-0000-4000-8000-000000000004" } };
    expect(patch.postDataJSON()).toEqual(expectedBody);
    await expect(page.getByTestId("member-current")).toHaveText("Clinic member（seed-member-clinic）");
    expect(writes.map(write => ({ path: new URL(write.url()).pathname, body: write.postDataJSON() }))).toEqual([{ path: entryPath, body: expectedBody }]);
  });

  test("01 §6.2 at 390px the Admin pages do not scroll sideways; wide tables scroll inside their card", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ["/", "/roles/editor", "/principals", "/audit", `/entries/${BETTY}`]) {
      await page.goto(`${ADMIN}${path}?${AS_ADMIN}`);
      await settled(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    }
  });
});
