import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page, Request, TestInfo } from "@playwright/test";
import { redactHeaders, redactJson, redactText } from "./redact.ts";

// Per-test API / WS logs (docs/v2/milestones/W0.md §5.1.9).

export type ApiLogLine = {
  ts: string;
  actor: string;
  method: string;
  path: string;
  status: number | null;
  req_headers: Record<string, string>;
  req_body: unknown;
  res_headers: Record<string, string>;
  res_body: unknown;
  error: string | null;
};

export type WsLogLine = { ts: string; actor: string; path: string; dir: "out" | "in" | "close"; payload: unknown };

function isRecordedPath(url: URL): boolean {
  const base = process.env.KITH_E2E_BASE_URL;
  if (!base || url.origin !== new URL(base).origin) return false;
  return url.pathname.startsWith("/api/") || url.pathname === "/mcp" || url.pathname.startsWith("/mcp/");
}

function requestBody(req: Request): unknown {
  const raw = req.postData();
  if (raw === null) return null;
  try {
    return redactJson(JSON.parse(raw));
  } catch {
    return redactText(raw.slice(0, 2048));
  }
}

function framePayload(payload: string | Buffer): unknown {
  const text = typeof payload === "string" ? payload : payload.toString("utf8");
  try {
    return redactJson(JSON.parse(text));
  } catch {
    return redactText(text.slice(0, 2048));
  }
}

export class Recorder {
  readonly id: string | null;
  readonly project: string;
  private readonly apiPath: string | null;
  private readonly wsPath: string | null;

  constructor(runDir: string, id: string | null, project: string) {
    this.id = id;
    this.project = project;
    if (id === null) {
      this.apiPath = null;
      this.wsPath = null;
      return;
    }
    this.apiPath = join(runDir, "api", id + "." + project + ".jsonl");
    this.wsPath = join(runDir, "ws", id + "." + project + ".jsonl");
    writeFileSync(this.apiPath, "");
    writeFileSync(this.wsPath, "");
  }

  watch(page: Page, actor: string): void {
    if (this.id === null) return;
    page.on("response", async (res) => {
      const url = new URL(res.url());
      if (!isRecordedPath(url)) return;
      const req = res.request();
      let resBody: unknown = null;
      try {
        const text = await res.text();
        if (text.length > 8192) resBody = { truncated: true, chars: text.length };
        else if ((res.headers()["content-type"] ?? "").includes("application/json")) resBody = redactJson(JSON.parse(text));
      } catch {
        resBody = null;
      }
      this.logApi({
        ts: new Date().toISOString(),
        actor,
        method: req.method(),
        path: url.pathname,
        status: res.status(),
        req_headers: redactHeaders(await req.allHeaders().catch(() => req.headers())),
        req_body: requestBody(req),
        res_headers: redactHeaders(res.headers()),
        res_body: resBody,
        error: null,
      });
    });
    page.on("requestfailed", (req) => {
      const url = new URL(req.url());
      if (!isRecordedPath(url)) return;
      this.logApi({
        ts: new Date().toISOString(),
        actor,
        method: req.method(),
        path: url.pathname,
        status: null,
        req_headers: redactHeaders(req.headers()),
        req_body: requestBody(req),
        res_headers: {},
        res_body: null,
        error: req.failure()?.errorText ?? "failed",
      });
    });
    page.on("websocket", (ws) => {
      const path = new URL(ws.url()).pathname;
      const line = (dir: WsLogLine["dir"], payload: unknown): void => {
        if (this.wsPath === null) return;
        const entry: WsLogLine = { ts: new Date().toISOString(), actor, path, dir, payload };
        appendFileSync(this.wsPath, JSON.stringify(entry) + "\n");
      };
      ws.on("framesent", (f) => line("out", framePayload(f.payload)));
      ws.on("framereceived", (f) => line("in", framePayload(f.payload)));
      ws.on("close", () => line("close", null));
    });
  }

  logApi(line: ApiLogLine): void {
    if (this.apiPath === null) return;
    appendFileSync(this.apiPath, JSON.stringify(line) + "\n");
  }

  finish(info: TestInfo): void {
    if (this.id === null) return;
    const base = this.id + "." + this.project + ".jsonl";
    info.annotations.push({ type: "evidence", description: JSON.stringify({ kind: "api-log", path: "api/" + base }) });
    info.annotations.push({ type: "evidence", description: JSON.stringify({ kind: "ws-log", path: "ws/" + base }) });
  }
}
