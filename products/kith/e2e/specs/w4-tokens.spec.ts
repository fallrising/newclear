import { randomBytes } from "node:crypto";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi } from "../fixtures/actors.ts";
import { shot } from "../harness/evidence.ts";

test("E2E-W4-04 revoking one of two tokens is immediate and isolated", { tag: ["@W4"] }, async ({ page, api }, info) => {
  test.setTimeout(120_000);
  const rand = randomBytes(3).toString("hex");
  const handle = "w4t_" + rand;
  await loginViaUi(page, ACCOUNTS.ada);
  const created = await api.call("POST", "/api/agents", { handle, display_name: "Bot " + rand, quota_class: "api_key" });
  expect(created.status).toBeGreaterThanOrEqual(200);
  expect(created.status).toBeLessThan(300);
  const aid = (created.json as { id: string }).id;
  const runtime = await api.call("PUT", "/api/agents/" + aid + "/runtime", { runtime: "external", quota_class: "api_key" });
  expect(runtime.status).toBeGreaterThanOrEqual(200);
  expect(runtime.status).toBeLessThan(300);

  await page.goto("/console/agents/" + aid + "?tab=tokens");
  await expect(page.getByTestId("tokens-empty")).toBeVisible();

  await page.getByTestId("tokens-issue").click();
  await expect(page.getByTestId("token-issued")).toBeVisible();
  const t1 = (await page.getByTestId("token-issued").innerText()).trim();
  expect(t1).toMatch(/^kith_bot_[0-9a-f]{64}$/);

  await page.getByTestId("tokens-issue").click();
  await expect(page.getByTestId("token-issued")).not.toHaveText(t1);
  const t2 = (await page.getByTestId("token-issued").innerText()).trim();
  await expect(page.getByTestId("token-row")).toHaveCount(2);
  await expect(page.locator('[data-testid="token-row"][data-state="active"]')).toHaveCount(2);
  await shot(page, info, "01-two-tokens");

  const me = async (token: string) => api.call("GET", "/api/me", undefined, { Authorization: "Bearer " + token });
  expect((await me(t1)).status).toBe(200);
  expect(((await me(t2)).json as { handle: string }).handle).toBe(handle);

  const listed = await api.call("GET", "/api/agents/" + aid + "/tokens");
  expect(listed.status).toBe(200);
  const tokens = (listed.json as { tokens: { id: string; created_at: string }[] }).tokens;
  const earlier = [...tokens].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0]!;
  const row = page.locator(`[data-testid="token-row"][data-id="${earlier.id}"]`);
  await row.getByTestId("token-revoke").click();
  await page.getByTestId("token-revoke-confirm").click();
  await expect(row).toHaveAttribute("data-state", "revoked");
  await expect(row).toContainText("撤銷");
  await shot(page, info, "02-revoked");

  const revoked = await me(t1);
  expect(revoked.status).toBe(401);
  expect((revoked.json as { error: { code: string } }).error.code).toBe("token_revoked");
  expect((await me(t2)).status).toBe(200);

  await page.reload();
  await expect(page.getByTestId("tokens-list")).toBeVisible();
  await expect(page.getByTestId("token-issued")).toHaveCount(0);
  const agent = await api.call("GET", "/api/agents/" + aid);
  expect((agent.json as { token_count: number }).token_count).toBe(1);
});
