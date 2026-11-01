import { expect, test, type Page } from "@playwright/test";
import { expectNoSeriousA11yViolations, FRONT } from "./helpers";
import memberFixture from "../docs/v2/contracts/fixtures/member-entries.json";

const A = memberFixture.members[0];
const B = memberFixture.members[1];
const request = A.appointmentRequests[0];
const created = memberFixture.createCases.valid.response;
const detailPath = `/clinic/appointments/${request.id}`;
const UUID = /[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/i;

test.use({ timezoneId: "Asia/Taipei" });
test.beforeEach(async ({ page }) => {
  // Fixed wall clock only: browser timers keep running and production reads the current time.
  await page.clock.setFixedTime(new Date(memberFixture.clock));
});

async function openMember(page: Page, path: string, scenario = "none", user = A.principal.username) {
  await page.goto(`${FRONT}${path}?mock=${scenario}&mockUser=${user}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("query-loading")).toHaveCount(0);
}

async function signIn(page: Page) {
  await page.getByRole("textbox", { name: "帳號" }).fill(A.principal.username);
  await page.getByLabel("密碼", { exact: true }).fill("any-password");
  await page.getByTestId("login-submit").click();
}

async function fillAppointment(page: Page) {
  await expect(page.getByTestId("appointment-form")).toBeVisible();
  // Leo is the first owned pet and the form's default selection.
  await page.getByTestId("appointment-preferred-at").fill("2026-10-20T09:30");
  await page.getByTestId("appointment-reason").fill("皮膚搔癢");
}

async function expectNoLeak(page: Page) {
  const text = await page.getByRole("main").innerText();
  expect(text).not.toMatch(UUID);
  expect(text).not.toMatch(/PATCH|origin|publicationState|ownerPrincipalId|payload\.pet|\bdraft\b/);
}

test("W3b AC-10 anonymous member routes redirect to login and return after sign-in", async ({ page }) => {
  for (const path of ["/clinic/me", "/clinic/appointments/new", detailPath]) {
    await page.goto(`${FRONT}${path}?mock=none&mockUser=#ignored`);
    await expect(page).toHaveURL(`${FRONT}/login?next=${encodeURIComponent(path)}`);
    await signIn(page);
    await expect(page).toHaveURL(`${FRONT}${path}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
});

test("W3b AC-10 member dashboard shows only owned records at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMember(page, "/clinic/me");
  await expect(page.getByTestId("member-pet-card")).toHaveCount(2);
  await expect(page.getByTestId("member-appointment-card")).toHaveCount(2);
  await expect(page.getByTestId("member-pets")).toContainText("Leo");
  await expect(page.getByTestId("member-pets")).toContainText("Mochi");
  await expect(page.getByRole("main")).not.toContainText("Basil");
  await expect(page.getByRole("main")).not.toContainText(B.appointmentRequests[0].payload.reason);
  await openMember(page, "/clinic/me", "none", B.principal.username);
  await expect(page.getByTestId("member-pet-card")).toHaveCount(1);
  await expect(page.getByTestId("member-appointment-card")).toHaveCount(1);
  await expect(page.getByTestId("member-pets")).toContainText("Basil");
  await expect(page.getByRole("main")).not.toContainText("Leo");
});

test("W3b AC-11 foreign appointment is forbidden without leaked content", async ({ page }) => {
  await openMember(page, detailPath, "none", B.principal.username);
  await expect(page.getByTestId("member-forbidden")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "沒有權限" })).toBeVisible();
  for (const value of memberFixture.crossOwnerForbidden.mustNotContain) {
    await expect(page.getByRole("main")).not.toContainText(value);
  }
  await page.getByRole("link", { name: "回到我的資料" }).click();
  await expect(page).toHaveURL(`${FRONT}/clinic/me`);
  await expect(page.getByTestId("member-pets")).toContainText("Basil");
});

test("W3b AC-12 create stays on Front and sends no publication field", async ({ page }) => {
  const writes: { path: string; body: unknown }[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname.includes("/me/")) {
      writes.push({ path: new URL(r.url()).pathname, body: r.postDataJSON() });
    }
  });
  await openMember(page, "/clinic/appointments/new");
  await page.getByRole("combobox", { name: "寵物" }).click();
  const petOptions = page.getByRole("listbox");
  await expect(petOptions).toBeVisible();
  expect(await petOptions.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(247, 244, 238)");
  await page.getByRole("option", { name: "Mochi", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "寵物" })).toContainText("Mochi");
  await page.getByRole("combobox", { name: "寵物" }).click();
  await page.getByRole("option", { name: "Leo", exact: true }).click();
  await fillAppointment(page);
  await page.getByTestId("appointment-submit").click();
  await expect(page).toHaveURL(`${FRONT}/clinic/appointments/${created.id}`);
  await expect(page.getByTestId("appointment-detail")).toBeVisible();
  expect(writes).toEqual([{
    path: "/api/v1/me/content-types/appointment_request/entries",
    body: { payload: { pet: A.pets[0].id, preferredAt: "2026-10-20T01:30:00.000Z", reason: "皮膚搔癢" } },
  }]);
  await expect(page.getByTestId("appointment-pet")).toContainText("Leo");
  await expect(page.getByTestId("appointment-status")).toHaveText("待診所確認");
  await expectNoLeak(page);
});

test("W3b AC-13 malicious next remains on Front", async ({ page }) => {
  for (const next of ["https://evil.example/steal", "//evil.example", "/entries/pet", "/clinic/me?next=https://evil.example", "/clinic/appointments/a/extra"]) {
    await page.goto(`${FRONT}/login?mockUser=&next=${encodeURIComponent(next)}`);
    await signIn(page);
    await expect(page).toHaveURL(`${FRONT}/clinic/me`);
    await expect(page.getByTestId("member-home")).toBeVisible();
  }
});

test("W3b V2-AC-15 visible text contains no engineering term or UUID", async ({ page }) => {
  for (const path of ["/clinic/me", detailPath, "/clinic/appointments/new"]) {
    await openMember(page, path);
    await expectNoLeak(page);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  }
  await openMember(page, detailPath, "none", B.principal.username);
  await expect(page.getByTestId("member-forbidden")).toBeVisible();
  await expectNoLeak(page);
});

test("W3b V2-AC-14 eight member states have no serious accessibility violation", async ({ page }) => {
  test.setTimeout(120_000);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, path, scenario, user] of [
      ["dashboard", "/clinic/me", "none", A.principal.username],
      ["pets empty", "/clinic/me", "memberPetsEmpty", A.principal.username],
      ["appointments empty", "/clinic/me", "memberAppointmentsEmpty", A.principal.username],
      ["detail", detailPath, "none", A.principal.username],
      ["forbidden", detailPath, "none", B.principal.username],
      ["new form", "/clinic/appointments/new", "none", A.principal.username],
      ["form validation", "/clinic/appointments/new", "none", A.principal.username],
      ["rate-limited", "/clinic/appointments/new", "rateLimited", A.principal.username],
    ]) {
      await test.step(`${width}px ${name}`, async () => {
        await openMember(page, path, scenario, user);
        if (name === "pets empty") await expect(page.getByText("尚未登記寵物", { exact: true })).toBeVisible();
        if (name === "appointments empty") await expect(page.getByText("沒有預約", { exact: true })).toBeVisible();
        if (name === "forbidden") await expect(page.getByTestId("member-forbidden")).toBeVisible();
        if (name === "form validation") {
          await page.getByTestId("appointment-submit").click();
          await expect(page.getByText("請選擇未來的日期與時間。", { exact: true })).toBeVisible();
        }
        if (name === "rate-limited") {
          await fillAppointment(page);
          await page.getByTestId("appointment-submit").click();
          await expect(page.getByTestId("appointment-form-alert")).toContainText("送出次數過多，請稍後再試。");
          await expect(page.getByTestId("appointment-reason")).toHaveValue("皮膚搔癢");
        }
        await expectNoSeriousA11yViolations(page);
      });
    }
  }
});

test("W3b mobile pages have no horizontal overflow and member menu supports keyboard navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/clinic/me", detailPath, "/clinic/appointments/new"]) {
    await openMember(page, path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBe(0);
  }
  const menu = page.getByRole("button", { name: A.principal.displayName, exact: true });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  expect(await page.getByRole("menu").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(247, 244, 238)");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(menu).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${FRONT}/clinic/me`);
  await expect(page.getByRole("menu")).toBeHidden();
});
