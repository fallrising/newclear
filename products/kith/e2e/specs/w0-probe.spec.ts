import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS, CANARY, canaryBotToken } from "../fixtures/accounts.ts";
import { note, saveFile, shot } from "../harness/evidence.ts";

// Only run nested by E2E-W0-02 (KITH_E2E_PROBE=1); excluded by grepInvert otherwise.

test("PROBE-W0-01 login and canary traffic", { tag: ["@probe", "@probe-good"] }, async ({ page }, info) => {
  await page.goto("/login");
  await page.getByTestId("login-handle").fill("ada");
  await page.getByTestId("login-password").fill(ACCOUNTS.ada.password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await shot(page, info, "after-login");

  const status = await page.evaluate(
    async (token) => (await fetch("/api/me", { headers: { Authorization: "Bearer " + token } })).status,
    canaryBotToken(),
  );
  expect(status).toBe(401);
  note(info, "canary bearer rejected with 401");
});

test("PROBE-W0-02 deliberate leak", { tag: ["@probe", "@probe-bad"] }, async ({}, info) => {
  saveFile(info, "leak.txt", "leaked " + CANARY);
  info.annotations.push({
    type: "evidence",
    description: JSON.stringify({ kind: "file", path: "files/PROBE-W0-02/missing.txt" }),
  });
});

test("probe without an acceptance id", { tag: ["@probe", "@probe-bad"] }, async () => {
  expect(1).toBe(1);
});
