import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pages } from "./pages";
import { openCase, settle } from "./helpers";

function forbiddenEngineeringText(text: string): string[] { return ["PATCH", "sortOrder", "origin", "(string)", "Unexpected token"].filter(word => text.includes(word)); }

test("W5 F03 F04 F05 computed tokens fonts titles", async ({ page }) => {
  for (const [id, selector, background, size, title] of [
    ["front-clinic-home", "[data-site=clinic]", "rgb(247, 244, 238)", "32px", "診所"],
    ["back-home", "body", "rgb(241, 241, 241)", "20px", "作業台 · CMS 作業台"],
    ["admin-overview", "body", "rgb(241, 241, 241)", "20px", "總覽 · Admin center"],
  ]) {
    await openCase(page, pages.find(c => c.id === id)!, "desktop");
    await expect(page.locator(selector)).toHaveCSS("background-color", background);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("font-size", size);
    expect(await page.locator("body").evaluate(el => getComputedStyle(el).fontFamily)).toContain("Noto Sans TC");
    if (id.startsWith("front")) expect(await page.locator("h1").evaluate(el => getComputedStyle(el).fontFamily)).toContain("Noto Serif TC");
    if (id === "front-clinic-home") await expect(page.getByRole("heading", { level: 1, name: "Cedar Pet Clinic", exact: true })).toBeVisible();
    await expect(page).toHaveTitle(title);
  }
});

test("W5 S03 CSRF is cached and one 403 retries once", async ({ page }) => {
  await openCase(page, pages.find(c => c.id === "back-detail")!, "desktop");
  // MSW owns these responses. Inject at the exact app fetch boundary and forward every untouched request to MSW.
  await page.evaluate(() => {
    const original = window.fetch.bind(window); const counters = { csrf: 0, patch: 0, injected: 0 };
    Object.assign(window, { __W5_REQUESTS__: counters });
    window.fetch = async (input, init) => {
      const request = new Request(input, init); const path = new URL(request.url).pathname;
      if (path === "/api/v1/auth/csrf") counters.csrf++;
      if (request.method === "PATCH" && path === "/api/v1/entries/30000000-0000-4000-8000-000000000008") {
        counters.patch++;
        if (counters.patch === 1) { counters.injected++; return new Response(JSON.stringify({ error: { code: "CSRF_FAILED", message: "CSRF failed" }, requestId: "w5-test" }), { status: 403, headers: { "Content-Type": "application/json" } }); }
      }
      return original(request);
    };
  });
  await page.getByLabel(/^標題/).fill("Studio renamed");
  await page.getByTestId("save-bar-save").click();
  await expect(page.getByText("已儲存", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __W5_REQUESTS__: object }).__W5_REQUESTS__)).toEqual({ csrf: 2, patch: 2, injected: 1 });
  // A subsequent write reuses the successful token, proving the cache without adding another forced failure.
  await page.getByLabel(/^標題/).fill("Studio twice"); await page.getByTestId("save-bar-save").click();
  await expect(page.getByTestId("save-bar")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __W5_REQUESTS__: object }).__W5_REQUESTS__)).toEqual({ csrf: 2, patch: 3, injected: 1 });
});

test("W5 S04 markdown never executes raw HTML", async ({ page }) => {
  await openCase(page, pages.find(c => c.id === "front-clinic-home")!, "desktop");
  await page.evaluate(() => {
    const original = window.fetch.bind(window); Object.assign(window, { __W5_INJECTED__: 0 });
    window.fetch = async (input, init) => {
      const request = new Request(input, init); const response = await original(request);
      if (new URL(request.url).pathname === "/api/v1/public/content-types/vet/slugs/james-carter") {
        const entry = await response.json(); entry.payload.bio = 'W5 safe markdown text\n\n<img id="w5-injected" src="invalid" onerror="window.__xss=1"><script>window.__xss=2</script>';
        (window as unknown as { __W5_INJECTED__: number }).__W5_INJECTED__++;
        return new Response(JSON.stringify(entry), { status: response.status, headers: response.headers });
      }
      return response;
    };
  });
  await page.getByTestId("vet-card").filter({ hasText: "James Carter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "James Carter", exact: true })).toBeVisible();
  await settle(page);
  const injectedBio = page.getByTestId("markdown-body").filter({ hasText: "W5 safe markdown text" });
  await expect(injectedBio).toHaveCount(1);
  await expect(injectedBio).toBeVisible();
  await expect(injectedBio).toContainText("W5 safe markdown text");
  expect(await page.evaluate(() => (window as unknown as { __W5_INJECTED__: number }).__W5_INJECTED__)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined();
  await expect(page.locator("#w5-injected")).toHaveCount(0);
});

test("W5 C10 board follows project query changes", async ({ page }) => {
  await openCase(page, pages.find(c => c.id === "back-board")!, "desktop");
  await expect(page.getByTestId("board-card").filter({ hasText: "Kanban DnD" })).toBeVisible();
  await page.evaluate(() => { history.pushState({}, "", "/views/projects.board?project=30000000-0000-4000-8000-000000000025"); dispatchEvent(new PopStateEvent("popstate")); });
  await expect(page.getByLabel("專案", { exact: true })).toContainText("Internal Ops");
  await expect(page.getByTestId("board-card").filter({ hasText: "Secret infra task" })).toBeVisible();
  await expect(page.getByTestId("board-card").filter({ hasText: "Kanban DnD" })).toHaveCount(0);
});

test("W5 C11 member navigation and logout", async ({ page }) => {
  await openCase(page, pages.find(c => c.id === "front-member-home")!, "desktop");
  await page.getByTestId("member-menu").click();
  for (const name of ["我的資料", "預約看診", "登出"]) await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "登出", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:5173/");
  await page.getByTestId("selector-card").filter({ hasText: "診所" }).click();
  await expect(page.getByTestId("member-login")).toBeVisible();
  await expect(page.getByTestId("member-menu")).toHaveCount(0);
});

test("W5 C13 C14 markdown images", async ({ page }) => {
  for (const id of ["front-album-detail", "front-photo", "front-vet-detail", "front-project-detail"]) {
    await openCase(page, pages.find(c => c.id === id)!, "desktop");
    if (id === "front-photo") {
      await expect(page.locator("main").getByText("Late sun on the flats.", { exact: true })).toBeVisible();
      await expect(page.getByTestId("markdown-body")).toHaveCount(0);
    } else {
      await expect(page.getByTestId("markdown-body")).toHaveCount(1);
      await expect(page.getByTestId("markdown-body")).toBeVisible();
    }
    const images = page.locator("main img");
    if (id === "front-album-detail" || id === "front-photo") expect(await images.count()).toBeGreaterThan(0);
    for (const image of await images.all()) {
      expect(await image.getAttribute("alt")).not.toBeNull();
      expect(Number(await image.getAttribute("width"))).toBeGreaterThan(0); expect(Number(await image.getAttribute("height"))).toBeGreaterThan(0);
      expect(await image.getAttribute("src")).toMatch(/\/api\/v1\/public\/media\/[0-9a-f-]+\/file\/(thumbnail|web|original)$/);
      await expect(image).toHaveAttribute("loading", id === "front-album-detail" ? "lazy" : "eager");
    }
  }
});

test("W5 C16 stale response cannot replace new route", async ({ page }, info) => {
  await openCase(page, pages.find(c => c.id === "front-album-list")!, "desktop");
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    const delayed = { started: 0, completed: 0, switchedAt: null as number | null, requests: [] as { startedAt: number; delayStartedAt: number | null; completedAt: number | null; status: number | null; failed: boolean }[] };
    Object.assign(window, { __W5_DELAYED__: delayed });
    window.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "GET" && new URL(request.url).pathname === "/api/v1/public/content-types/album/slugs/coast-light-2026") {
        const record = { startedAt: performance.now(), delayStartedAt: null as number | null, completedAt: null as number | null, status: null as number | null, failed: false };
        delayed.started++; delayed.requests.push(record);
        try {
          // The adapter deliberately delivers obsolete responses despite cancellation; the current route must still win.
          const response = await original(new Request(request, { signal: null }));
          record.status = response.status; record.delayStartedAt = performance.now();
          await new Promise(resolve => setTimeout(resolve, 1500));
          return response;
        } catch (error) { record.failed = true; throw error; }
        finally { record.completedAt = performance.now(); delayed.completed++; }
      }
      return original(request);
    };
  });
  await page.getByTestId("album-card").filter({ hasText: "Coast Light 2026" }).click();
  await expect.poll(() => page.evaluate(() => {
    const delayed = (window as unknown as { __W5_DELAYED__: { started: number; completed: number } }).__W5_DELAYED__;
    return delayed.started > delayed.completed;
  })).toBe(true);
  await page.evaluate(() => {
    const delayed = (window as unknown as { __W5_DELAYED__: { started: number; completed: number; switchedAt: number | null } }).__W5_DELAYED__;
    if (delayed.started === 0 || delayed.started <= delayed.completed) throw new Error("Old-album response must still be pending at the route switch");
    delayed.switchedAt = performance.now();
    history.pushState({}, "", "/album/albums/unlisted-proof"); dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByRole("heading", { level: 1, name: "Unlisted proof", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const delayed = (window as unknown as { __W5_DELAYED__: { started: number; completed: number } }).__W5_DELAYED__;
    return delayed.started > 0 && delayed.completed === delayed.started;
  })).toBe(true);
  const delayed = await page.evaluate(() => (window as unknown as { __W5_DELAYED__: { started: number; completed: number; switchedAt: number; requests: { startedAt: number; delayStartedAt: number | null; completedAt: number; status: number; failed: boolean }[] } }).__W5_DELAYED__);
  expect(delayed.started).toBeGreaterThan(0);
  expect(delayed.completed).toBe(delayed.started);
  expect(delayed.requests).toHaveLength(delayed.started);
  expect(delayed.requests.some(request => request.startedAt <= delayed.switchedAt && request.completedAt > delayed.switchedAt)).toBe(true);
  for (const request of delayed.requests) { expect(request.failed).toBe(false); expect(request.status).toBe(200); expect(request.delayStartedAt).not.toBeNull(); }
  await info.attach("delayed-old-album-responses", { body: JSON.stringify(delayed), contentType: "application/json" });
  await settle(page);
  await expect(page.getByRole("heading", { level: 1, name: "Unlisted proof", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: "Coast Light 2026", exact: true })).toHaveCount(0);
});

test("W5 C17 each app requests auth me once", async ({ page }) => {
  for (const id of ["front-member-home", "back-home", "admin-overview"]) {
    await openCase(page, pages.find(c => c.id === id)!, "desktop");
    const requests: string[] = [];
    const listener = (request: import("@playwright/test").Request) => { if (new URL(request.url()).pathname === "/api/v1/auth/me") requests.push(request.url()); };
    page.on("request", listener);
    await page.reload(); await settle(page);
    await expect.poll(() => requests.length).toBe(1);
    expect(requests).toHaveLength(1);
    page.off("request", listener);
  }
});

test("W5 C18 non JSON 502 is product error", async ({ page }) => {
  await openCase(page, pages.find(c => c.id === "front-clinic-home")!, "desktop");
  await page.evaluate(() => {
    const original = window.fetch.bind(window); Object.assign(window, { __W5_502__: 0 });
    window.fetch = async (input, init) => { const request = new Request(input, init); if (new URL(request.url).pathname === "/api/v1/public/content-types/vet/slugs/james-carter") { (window as unknown as { __W5_502__: number }).__W5_502__++; return new Response("<html>bad gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } }); } return original(request); };
  });
  await page.getByTestId("vet-card").filter({ hasText: "James Carter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "暫時無法載入" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重試", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __W5_502__: number }).__W5_502__)).toBeGreaterThan(0);
  expect(forbiddenEngineeringText(await page.locator("body").innerText())).toEqual([]);
});

test("W5 C19 U04 U05 confirmation feedback structure", async ({ page }) => {
  await openCase(page, pages.find(c => c.id === "admin-type-detail")!, "desktop");
  await page.getByTestId("type-toggle").click();
  await expect(page.getByTestId("confirm-submit")).toBeDisabled();
  await page.getByTestId("confirm-input").fill("Owner"); await expect(page.getByTestId("confirm-submit")).toBeEnabled();
  await page.getByTestId("confirm-cancel").click();
  await openCase(page, pages.find(c => c.id === "back-detail")!, "desktop");
  await page.getByLabel(/^標題/).fill("Studio feedback"); await page.getByTestId("save-bar-save").click();
  await expect(page.getByText("已儲存", { exact: true })).toBeVisible();
  await openCase(page, pages.find(c => c.id === "front-selector")!, "desktop");
  await expect(page.locator("main > section")).toBeVisible(); await expect(page.locator("footer")).toBeVisible();
  await openCase(page, pages.find(c => c.id === "front-album-detail")!, "desktop");
  await expect(page.getByRole("navigation", { name: "頁面路徑" })).toBeVisible();
});

test("W5 E01 E04 production versions", () => {
  for (const surface of ["front", "back", "admin"]) {
    const root = `apps/web-${surface}`;
    const manifest = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
    expect(Number(manifest.dependencies.react.split(".")[0])).toBe(19);
    expect(Number(manifest.dependencies["react-router"].split(".")[0])).toBe(7);
    const paths = [join(root, "src")]; const sources: string[] = [];
    while (paths.length) { const path = paths.pop()!; for (const entry of readdirSync(path, { withFileTypes: true })) { const file = join(path, entry.name); if (entry.isDirectory()) paths.push(file); else if (/\.tsx?$/.test(file) && !/test/.test(file)) sources.push(readFileSync(file, "utf8")); } }
    expect(sources.join("\n")).not.toMatch(/(?:function|const)\s+(?:Login|useMe)\b/);
    if (surface !== "front") expect(sources.join("\n")).toMatch(/from ["']@cms\/auth["']/);
  }
});
