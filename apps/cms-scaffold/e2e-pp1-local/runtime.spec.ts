import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { request } from "node:https";
import type { IncomingHttpHeaders } from "node:http";

const mode = process.env.CMS_PP1_TLS_MODE ?? "trusted";
const api = "https://api.cms.test:8443";
let ca: Buffer;
test.beforeAll(() => {
  const root = process.env.CMS_PP1_RUN_ROOT;
  if (!root || !["trusted", "untrusted"].includes(mode)) throw new Error("PP1_LOCAL_BROWSER_INPUT_INVALID");
  const receipt = JSON.parse(readFileSync(join(root, "receipt.json"), "utf8")) as { environment: string; apiOrigin: string; project: string };
  expect(receipt.environment).toBe("local-isolated");
  expect(receipt.apiOrigin).toBe(api);
  expect(receipt.project).toMatch(/^cms-pp1-local-[a-f0-9]{32}$/);
  ca = readFileSync(join(root, "ca.crt"));
});
function http(url: string, method = "GET", headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = request(url, { method, headers, ca, timeout: 5000 }, res => {
      let body = "";
      res.on("data", data => { body += data; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("PP1_LOCAL_BROWSER_TIMEOUT")));
    req.on("error", reject); req.end();
  });
}
if (mode === "untrusted") {
  test("PP1a-FM03 untrusted container rejects the local CA", async ({ page }) => {
    await expect(page.goto("https://front.cms.test:8443/")).rejects.toThrow(/ERR_CERT_AUTHORITY_INVALID/);
  });
} else {
  for (const [surface, route, title] of [
    ["front", "/login", "會員登入"],
    ["back", "/sign-in", "登入 CMS 作業台"],
    ["admin", "/login", "登入 Admin center"],
  ]) test(`PP1a-FM07 trusted ${surface} deep link uses its real HTTPS API build`, async ({ page }) => {
    const unexpected: string[] = [];
    const apiRequests: string[] = [];
    const origins: Promise<string | undefined>[] = [];
    const assets: { status: number; type: string; resource: string }[] = [];
    page.on("pageerror", error => unexpected.push(error.message));
    page.on("console", message => {
      if (message.type() !== "error") return;
      const url = message.location().url;
      if (url === `https://${surface}.cms.test:8443/favicon.ico` && /Failed to load resource.*\b404\b/.test(message.text())) return;
      if (url.startsWith(`${api}/api/v1/`) && /Failed to load resource.*\b(401|403)\b/.test(message.text())) return;
      unexpected.push(`${url ? new URL(url).pathname : "console"}: ${message.text()}`);
    });
    page.on("request", req => {
      if (req.url().includes("/api/v1/")) {
        apiRequests.push(req.url()); origins.push(req.allHeaders().then(headers => headers.origin));
      }
      if (req.url().includes("localhost:8080")) unexpected.push("stale API origin");
    });
    page.on("response", res => {
      const resource = res.request().resourceType();
      if (new URL(res.url()).pathname.startsWith("/assets/") && ["script", "stylesheet"].includes(resource)) {
        assets.push({ status: res.status(), type: res.headers()["content-type"] ?? "", resource });
      }
    });
    const response = await page.goto(`https://${surface}.cms.test:8443${route}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "帳號", exact: true })).toHaveValue("");
    await expect(page.getByRole("button", { name: "登入", exact: true })).toBeVisible();
    // Front login is intentionally passive; its public list exercises the built client.
    if (surface === "front") await page.goto("https://front.cms.test:8443/album");
    await expect.poll(() => apiRequests.length).toBeGreaterThan(0);
    expect(apiRequests.every(url => url.startsWith(`${api}/api/v1/`))).toBe(true);
    expect((await Promise.all(origins)).every(origin => origin === `https://${surface}.cms.test:8443`)).toBe(true);
    expect(assets.some(asset => asset.resource === "script")).toBe(true);
    expect(assets.some(asset => asset.resource === "stylesheet")).toBe(true);
    for (const asset of assets) {
      expect(asset.status).toBe(200);
      expect(asset.type).toMatch(asset.resource === "script" ? /^(text|application)\/javascript/ : /^text\/css/);
    }
    expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
    expect(unexpected).toEqual([]);
  });
  test("PP1a-FM07 real health, CORS and anonymous denial remain intact", async () => {
    const health = await http(`${api}/actuator/health`);
    expect(health.status).toBe(200); expect(JSON.parse(health.body).status).toBe("UP");
    for (const surface of ["front", "back", "admin"]) {
      const origin = `https://${surface}.cms.test:8443`;
      const preflight = await http(`${api}/api/v1/auth/login`, "OPTIONS", {
        Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-csrf-token",
      });
      expect(preflight.status).toBe(200);
      expect(preflight.headers["access-control-allow-origin"]).toBe(origin);
      expect(preflight.headers["access-control-allow-credentials"]).toBe("true");
      const denied = await http(`${api}/api/v1/principals`, "GET", { Origin: origin });
      expect([401, 403]).toContain(denied.status);
      const missing = await http(`https://${surface}.cms.test:8443/assets/pp1-missing.js`);
      expect(missing.status).toBe(404); expect(missing.headers["content-type"] ?? "").not.toContain("text/html");
    }
    const foreign = await http(`${api}/api/v1/auth/login`, "OPTIONS", {
      Origin: "https://outside.invalid", "Access-Control-Request-Method": "POST",
    });
    expect(foreign.headers["access-control-allow-origin"]).toBeUndefined();
  });
}
