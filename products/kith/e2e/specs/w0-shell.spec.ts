import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { note, shot } from "../harness/evidence.ts";
import { CONTRACTS_DIR } from "../harness/paths.ts";

test(
  "E2E-W0-01 isolated stack boots and the operator reaches the empty home",
  { tag: ["@W0", "@mobile"] },
  async ({ page, api }, info) => {
    const expectedLang = info.project.name === "desktop" ? "zh-TW" : "en";

    // 1. Unauthenticated "/" redirects to the login page with next=/.
    await page.goto("/");
    await page.waitForURL(/\/login\?next=%2F$/);
    await expect(page.getByTestId("login-page")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", expectedLang);
    await shot(page, info, "login");

    // 2. Empty form cannot be submitted.
    await expect(page.getByTestId("login-submit")).toBeDisabled();

    // 3. Wrong password.
    await page.getByTestId("login-handle").fill("ada");
    await page.getByTestId("login-password").fill("wrong-password");
    const r = page.waitForResponse((res) => res.url().endsWith("/api/auth/login"));
    await page.getByTestId("login-submit").click();
    expect((await r).status()).toBe(401);
    await expect(page.getByTestId("login-error")).toBeVisible();
    await expect(page.getByTestId("login-error")).not.toHaveText("");
    await expect(page.getByTestId("login-password")).toHaveValue("");
    expect(page.url()).toMatch(/\/login/);
    await shot(page, info, "login-error");

    // 4. Correct password reaches the empty home.
    await page.getByTestId("login-password").fill(ACCOUNTS.ada.password);
    await page.getByTestId("login-submit").click();
    await page.waitForURL((u) => u.pathname === "/");
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("home-greeting")).toContainText("Ada Lin");
    await expect(page.getByTestId("app-shell-user")).toHaveText("Ada Lin");
    await shot(page, info, "home");

    // 5. Reload keeps the session.
    await page.reload();
    await expect(page.getByTestId("app-shell")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");

    // 6. /api/me
    const me = await api.call("GET", "/api/me");
    expect(me.status).toBe(200);
    const meJson = me.json as { handle: string; is_operator: number };
    expect(meJson.handle).toBe("ada");
    expect(meJson.is_operator).toBe(1);
    note(info, "GET /api/me is the operator ada");

    // 7. /api/rooms in seed order.
    const rooms = await api.call("GET", "/api/rooms");
    expect(rooms.status).toBe(200);
    const roomsJson = rooms.json as { rooms: { slug: string }[] };
    expect(roomsJson.rooms.map((x) => x.slug)).toEqual(["long-history", "lobby", "quiet", "ada-private"]);
    note(info, "GET /api/rooms returned 4 rooms in seed order");

    // 8. seed.json matches the contract and base-v1 counts.
    const seed = JSON.parse(readFileSync(join(process.env.KITH_E2E_RUN_DIR!, "seed.json"), "utf8")) as {
      counts: Record<string, number>;
    };
    const schema = JSON.parse(readFileSync(join(CONTRACTS_DIR, "e2e-seed.json"), "utf8")) as object;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const valid = ajv.validate(schema, seed);
    expect(ajv.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
    expect(seed.counts).toEqual({ members: 6, rooms: 4, room_members: 10, messages: 1213, bot_tokens: 0 });
    note(info, "seed.json matches base-v1 counts");

    // 9. Logout returns to the login page.
    await page.getByTestId("app-shell-logout").click();
    await page.waitForURL((u) => u.pathname === "/login");
    await expect(page.getByTestId("login-page")).toBeVisible();
    await shot(page, info, "logged-out");
  },
);
