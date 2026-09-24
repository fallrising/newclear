import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi } from "../fixtures/actors.ts";
import { note, shot } from "../harness/evidence.ts";

test(
  "E2E-W2-04 non-operators cannot see or open the console",
  { tag: ["@W2", "@mobile"] },
  async ({ page, api }, info) => {
    const rand = Date.now().toString(36);
    const memberRequests: string[] = [];
    page.on("request", (req) => {
      if (new URL(req.url()).pathname === "/api/members") memberRequests.push(req.url());
    });

    await loginViaUi(page, ACCOUNTS.ben);
    await page.goto("/");
    await expect(page.getByTestId("room-list")).toBeVisible();
    await expect(page.getByTestId("console-link")).toHaveCount(0);
    await expect(page.getByTestId("room-create-open")).toHaveCount(0);
    await shot(page, info, "01-no-console-link");

    await page.goto("/console/people");
    await expect(page.getByTestId("console-forbidden")).toBeVisible();
    await expect(page.getByTestId("people-list")).toHaveCount(0);
    expect(memberRequests).toEqual([]);
    await shot(page, info, "02-forbidden");

    const members = await api.call("GET", "/api/members");
    const all = await api.call("GET", "/api/rooms?all=1");
    const created = await api.call("POST", "/api/members", {
      handle: "x_" + rand,
      display_name: "x",
      password: "long-enough-pass",
    });
    const renamed = await api.call("PATCH", "/api/rooms/room-lobby", { name: "hack" });
    expect(members.status).toBe(403);
    expect(all.status).toBe(403);
    expect(created.status).toBe(403);
    expect(renamed.status).toBe(403);
    note(info, "operator-only APIs return 403 to members");
  },
);
