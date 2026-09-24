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
