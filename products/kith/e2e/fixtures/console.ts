import { expect } from "@playwright/test";
import { PROVIDER_CANARY } from "./accounts.ts";
import type { ApiClient } from "./kith.ts";

export const FAKE = () => {
  const url = process.env.KITH_E2E_FAKE_PROVIDER_URL;
  if (!url) throw new Error("KITH_E2E_FAKE_PROVIDER_URL is not set; global setup did not run");
  return { openai: `${url}/openai/v1`, anthropic: `${url}/anthropic`, google: `${url}/google/v1beta`, log: `${url}/__log` };
};

export type ProviderFormat = "openai_chat" | "openai_responses" | "anthropic_messages" | "gemini";
export type ProviderSpec = { name: string; format: ProviderFormat };

function providerBaseUrl(format: ProviderFormat): string {
  if (format === "anthropic_messages") return FAKE().anthropic;
  if (format === "gemini") return FAKE().google;
  return FAKE().openai;
}

/** API path (for specs whose subject is not the provider form). */
export async function createProviderViaApi(api: ApiClient, spec: ProviderSpec): Promise<string> {
  const res = await api.call("POST", "/api/providers", {
    name: spec.name,
    preset: "custom",
    api_format: spec.format,
    base_url: providerBaseUrl(spec.format),
    secret_source: "stored",
    secret: PROVIDER_CANARY,
    default_quota_class: "api_key",
  });
  expect(res.status).toBe(201);
  return (res.json as { provider: { id: string } }).provider.id;
}

export async function createHostedAgentViaApi(
  api: ApiClient,
  a: { handle: string; display_name: string; providerId: string; model: string; stream?: boolean },
): Promise<string> {
  const created = await api.call("POST", "/api/agents", {
    handle: a.handle,
    display_name: a.display_name,
    quota_class: "api_key",
  });
  expect(created.status).toBeGreaterThanOrEqual(200);
  expect(created.status).toBeLessThan(300);
  const id = (created.json as { id: string }).id;
  const runtime = await api.call("PUT", "/api/agents/" + id + "/runtime", {
    runtime: "hosted",
    quota_class: "api_key",
    connection_id: a.providerId,
    model: a.model,
    ...(a.stream === undefined ? {} : { stream: a.stream }),
  });
  expect(runtime.status).toBeGreaterThanOrEqual(200);
  expect(runtime.status).toBeLessThan(300);
  return id;
}

export async function inviteAgentViaApi(api: ApiClient, roomId: string, handle: string, agentId: string): Promise<void> {
  const invited = await api.call("POST", "/api/rooms/" + roomId + "/members", { handle });
  expect(invited.status).toBeGreaterThanOrEqual(200);
  expect(invited.status).toBeLessThan(300);
  const attention = await api.call("PATCH", "/api/rooms/" + roomId + "/members/" + agentId + "/attention", {
    mode: "mention",
    cooldown_ms: 0,
  });
  expect(attention.status).toBeGreaterThanOrEqual(200);
  expect(attention.status).toBeLessThan(300);
}

/** Read /mcp/events for `ms`, then abort and return whatever text arrived. */
export async function readMcpEvents(token: string, roomId: string, afterSeq: number, ms: number): Promise<string> {
  const base = process.env.KITH_E2E_BASE_URL;
  if (!base) throw new Error("KITH_E2E_BASE_URL is not set; global setup did not run");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  let text = "";
  try {
    const res = await fetch(`${base}/mcp/events?room_id=${encodeURIComponent(roomId)}&after_seq=${afterSeq}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    const reader = res.body?.getReader();
    if (!reader) return text;
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (err) {
    if (!(err instanceof Error && err.name === "AbortError")) throw err;
  } finally {
    clearTimeout(timer);
  }
  return text;
}

export async function fakeProviderLog(): Promise<
  Array<{ format: string; path: string; model: string | null; auth_ok: boolean; status: number; stream: boolean }>
> {
  const res = await fetch(FAKE().log);
  if (!res.ok) throw new Error("fake provider log " + res.status);
  return (await res.json()) as Array<{ format: string; path: string; model: string | null; auth_ok: boolean; status: number; stream: boolean }>;
}
