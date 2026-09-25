// W4 §6 W4-T05: golden fixtures for 03 §2.7 FM-LLM-01…16 (non-streaming part). Written before the adapters.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isNoReply } from "../../worker/hosted/prompt.ts";
import { adapterFor } from "../../worker/providers/registry.ts";
import { LlmError, type ApiFormat, type NormalizedRequest, type ResolvedConnection } from "../../worker/providers/types.ts";
import { checkHeaders, checkSecret, normalizeBaseUrl } from "../../worker/providers/validate.ts";

type Fixture = {
  fm: string;
  format: ApiFormat;
  call: "complete" | "listModels";
  response: { status: number; headers: Record<string, string>; body: string };
  expect: {
    text?: string;
    finish?: string;
    usage?: Record<string, number> | null;
    models?: string[];
    error_class?: string;
    retry_after_ms?: number | null;
    no_text?: string;
  };
};

const DIR = join(import.meta.dirname, "fixtures", "llm");
const NOW = Date.parse("2026-09-24T00:00:00Z");
const CONN = (format: ApiFormat): ResolvedConnection => ({
  id: "c1",
  api_format: format,
  base_url: format === "anthropic_messages" ? "https://llm.example" : "https://llm.example/v1",
  secret: "sk-test-1234",
  extra_headers: { "X-Title": "kith" },
  token_param: "max_tokens",
});
const REQ: NormalizedRequest = { model: "m1", system: "sys", transcript: "UNTRUSTED_ROOM_TRANSCRIPT:\nhi", max_output_tokens: 64, stream: false };

function responseFor(f: Fixture): Response {
  const headers = new Headers(f.response.headers);
  if (headers.get("retry-after") === "@NOW+5s") headers.set("retry-after", new Date(NOW + 5000).toUTCString());
  const body = f.response.body === "@BIG" ? "x".repeat(1024 * 1024 + 1) : f.response.body;
  const status = f.response.status;
  return new Response(status === 204 || status === 304 ? null : body, { status, headers });
}

describe("LLM adapters (FM-LLM fixtures)", () => {
  const files = readdirSync(DIR).filter((n) => n.endsWith(".json")).sort();
  it("has fixtures", () => expect(files.length).toBeGreaterThanOrEqual(40));
  for (const name of files) {
    const f = JSON.parse(readFileSync(join(DIR, name), "utf8")) as Fixture;
    it(`${f.fm} ${name}`, async () => {
      const realNow = Date.now;
      Date.now = () => NOW;
      const seen: Array<{ url: string; init: RequestInit }> = [];
      const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: String(input), init: init ?? {} });
        return responseFor(f);
      };
      try {
        const adapter = adapterFor(f.format)!;
        const run = f.call === "complete" ? adapter.complete(CONN(f.format), REQ, fetchImpl) : adapter.listModels(CONN(f.format), fetchImpl);
        if (f.expect.error_class) {
          const err = await run.then(() => null, (e: unknown) => e);
          expect(err).toBeInstanceOf(LlmError);
          expect((err as LlmError).errorClass).toBe(f.expect.error_class);
          if (f.expect.retry_after_ms !== undefined) expect((err as LlmError).retryAfterMs ?? null).toBe(f.expect.retry_after_ms);
          if (f.expect.no_text) expect(String((err as Error).message)).not.toContain(f.expect.no_text);
        } else if (f.expect.models) {
          expect(await run).toEqual(f.expect.models);
        } else {
          const result = (await run) as { text: string; finish: string; usage?: unknown };
          expect(result.text).toBe(f.expect.text);
          expect(result.finish).toBe(f.expect.finish);
          if (f.expect.usage !== undefined) expect(result.usage ?? null).toEqual(f.expect.usage);
        }
        // Request shape: no tools key (RT-05), fixed paths, auth header per format, no "//" in the URL.
        const first = seen[0]!;
        expect(first.url.replace("https://", "")).not.toContain("//");
        const headers = first.init.headers as Record<string, string>;
        expect(headers["X-Title"]).toBe("kith");
        if (f.format === "openai_chat") expect(headers.authorization).toBe("Bearer sk-test-1234");
        else {
          expect(headers["x-api-key"]).toBe("sk-test-1234");
          expect(headers["anthropic-version"]).toBe("2023-06-01");
        }
        if (f.call === "complete") {
          const sent = JSON.parse(String(first.init.body)) as Record<string, unknown>;
          expect("tools" in sent).toBe(false);
          expect("temperature" in sent).toBe(false);
          expect(first.url).toBe(f.format === "openai_chat" ? "https://llm.example/v1/chat/completions" : "https://llm.example/v1/messages");
        }
      } finally {
        Date.now = realNow;
      }
    });
  }

  it("FM-LLM-10 aborted signal → timeout", async () => {
    const controller = new AbortController();
    const fetchImpl = (_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const run = adapterFor("openai_chat")!.complete(CONN("openai_chat"), REQ, fetchImpl, controller.signal);
    controller.abort();
    const err = await run.then(() => null, (e: unknown) => e);
    expect((err as LlmError).errorClass).toBe("timeout");
  });

  it("network error → network", async () => {
    const err = await adapterFor("anthropic_messages")!
      .complete(CONN("anthropic_messages"), REQ, async () => { throw new TypeError("fetch failed"); })
      .then(() => null, (e: unknown) => e);
    expect((err as LlmError).errorClass).toBe("network");
  });

  it("FM-LLM-13 NO_REPLY only when trimmed text is exactly NO_REPLY", () => {
    expect(isNoReply("  NO_REPLY\n")).toBe(true);
    expect(isNoReply("`NO_REPLY`")).toBe(false);
    expect(isNoReply("```\nNO_REPLY\n```")).toBe(false);
    expect(isNoReply("NO_REPLY.")).toBe(false);
  });

  it("FM-LLM-15 base URL normalization", () => {
    const n = (raw: string, format: ApiFormat, dev = false) => normalizeBaseUrl(raw, format, dev);
    expect(n("https://api.openai.com/v1/", "openai_chat")).toEqual({ ok: true, value: "https://api.openai.com/v1" });
    expect(n("https://api.openai.com//v1//", "openai_chat")).toEqual({ ok: true, value: "https://api.openai.com/v1" });
    expect(n("https://api.anthropic.com/v1", "anthropic_messages")).toEqual({ ok: true, value: "https://api.anthropic.com" });
    expect(n("https://api.anthropic.com/", "anthropic_messages")).toEqual({ ok: true, value: "https://api.anthropic.com" });
    expect(n("https://api.deepseek.com", "openai_chat")).toEqual({ ok: true, value: "https://api.deepseek.com" });
    expect(n("http://api.example.com/v1", "openai_chat").ok).toBe(false);
    expect(n("http://127.0.0.1:8931/openai/v1", "openai_chat", true)).toEqual({ ok: true, value: "http://127.0.0.1:8931/openai/v1" });
    for (const bad of ["https://u:p@api.example.com", "https://localhost/v1", "https://127.0.0.1/v1", "https://10.1.2.3",
      "https://192.168.0.1", "https://172.20.0.1", "https://169.254.169.254", "https://[::1]/v1", "https://api.example.com/v1?x=1", "ftp://x"]) {
      expect(n(bad, "openai_chat").ok, bad).toBe(false);
    }
  });

  it("FM-LLM-16 secrets with whitespace or control characters are refused at write time", () => {
    expect(checkSecret("sk-abc").ok).toBe(true);
    for (const bad of ["", " sk", "sk ", "sk\nx", "sk\tx", "sk\u0000x", "x".repeat(513)]) expect(checkSecret(bad).ok, JSON.stringify(bad)).toBe(false);
    expect(checkHeaders({ "HTTP-Referer": "https://kith.example" }).ok).toBe(true);
    for (const name of ["Authorization", "x-api-key", "X-Goog-Api-Key", "Cookie", "anthropic-version"]) expect(checkHeaders({ [name]: "v" }).ok).toBe(false);
    expect(checkHeaders({ "X-A": "line\nbreak" }).ok).toBe(false);
  });
});
