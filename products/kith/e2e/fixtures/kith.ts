import { test as base, expect, type Page } from "@playwright/test";
import { acceptanceId } from "../harness/evidence.ts";
import { Recorder } from "../harness/recorder.ts";
import { redactHeaders, redactJson } from "../harness/redact.ts";

// Playwright fixtures (docs/v2/milestones/W0.md §5.1.9).

export type ApiResult = { status: number; json: unknown };
export type ApiClient = {
  call(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<ApiResult>;
};

/** Shares the page's cookies: after a UI login the calls are authenticated. */
function createApiClient(page: Page, recorder: Recorder): ApiClient {
  return {
    async call(method, path, body, headers) {
      const merged: Record<string, string> = { ...(headers ?? {}) };
      const hasAuthorization = Object.keys(merged).some((key) => key.toLowerCase() === "authorization");
      if (method !== "GET" && !hasAuthorization) {
        const c = await page.request.get("/api/csrf");
        merged["X-CSRF-Token"] = ((await c.json()) as { csrf: string }).csrf;
      }
      if (body !== undefined) merged["content-type"] = "application/json";
      const res = await page.request.fetch(path, {
        method,
        headers: merged,
        data: body === undefined ? undefined : JSON.stringify(body),
      });
      const json: unknown = (res.headers()["content-type"] ?? "").includes("application/json") ? await res.json() : null;
      recorder.logApi({
        ts: new Date().toISOString(),
        actor: "api",
        method,
        path,
        status: res.status(),
        req_headers: redactHeaders(merged),
        req_body: redactJson(body ?? null),
        res_headers: redactHeaders(res.headers()),
        res_body: redactJson(json),
        error: null,
      });
      return { status: res.status(), json };
    },
  };
}

export const test = base.extend<{ recorder: Recorder; api: ApiClient }>({
  browser: [async ({ browser, browserName }, use) => {
    if (process.env.KITH_E2E_LOOPBACK_ONLINE !== "1") { await use(browser); return; }
    if (browserName !== "chromium") throw new Error("loopback online signal requires pinned Chromium CDP");
    // --network none has reachable loopback HTTP/WS but native navigator.onLine=false.
    // Initialize actual CDP network conditions before exposing pages; native offline
    // toggles remain authoritative. No navigator getter or application API is replaced.
    const original = browser.newContext;
    const createContext = browser.newContext.bind(browser);
    browser.newContext = async (options) => {
      const context = await createContext(options);
      let offline = options?.offline ?? false;
      const createPage = context.newPage.bind(context);
      const setOffline = context.setOffline.bind(context);
      context.setOffline = async (value) => { await setOffline(value); offline = value; };
      context.newPage = async () => {
        const page = await createPage();
        if (!offline) {
          const session = await context.newCDPSession(page);
          await session.send("Network.enable");
          await session.send("Network.emulateNetworkConditions", {
            offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: "ethernet",
          });
        }
        return page;
      };
      return context;
    };
    try { await use(browser); } finally { browser.newContext = original; }
  }, { scope: "worker" }],
  baseURL: async ({}, use) => {
    const url = process.env.KITH_E2E_BASE_URL;
    if (!url) throw new Error("KITH_E2E_BASE_URL is not set; global setup did not run");
    await use(url);
  },
  recorder: [
    async ({ page }, use, info) => {
      const rec = new Recorder(process.env.KITH_E2E_RUN_DIR!, acceptanceId(info), info.project.name);
      rec.watch(page, "main");
      await use(rec);
      rec.finish(info);
    },
    { auto: true },
  ],
  api: async ({ page, recorder }, use) => {
    await use(createApiClient(page, recorder));
  },
});
export { expect };
