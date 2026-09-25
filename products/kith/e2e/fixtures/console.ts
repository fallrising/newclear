import { expect } from "@playwright/test";
import { PROVIDER_CANARY } from "./accounts.ts";
import type { ApiClient } from "./kith.ts";

export const FAKE = () => {
  const url = process.env.KITH_E2E_FAKE_PROVIDER_URL;
  if (!url) throw new Error("KITH_E2E_FAKE_PROVIDER_URL is not set; global setup did not run");
  return { openai: `${url}/openai/v1`, anthropic: `${url}/anthropic`, log: `${url}/__log` };
};

export type ProviderSpec = { name: string; format: "openai_chat" | "anthropic_messages" };

/** API path (for specs whose subject is not the provider form). */
export async function createProviderViaApi(api: ApiClient, spec: ProviderSpec): Promise<string> {
  const res = await api.call("POST", "/api/providers", {
    name: spec.name,
    preset: "custom",
    api_format: spec.format,
    base_url: spec.format === "openai_chat" ? FAKE().openai : FAKE().anthropic,
    secret_source: "stored",
    secret: PROVIDER_CANARY,
    default_quota_class: "api_key",
  });
  expect(res.status).toBe(201);
  return (res.json as { provider: { id: string } }).provider.id;
}

export async function createHostedAgentViaApi(
  api: ApiClient,
  a: { handle: string; display_name: string; providerId: string; model: string },
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

export async function fakeProviderLog(): Promise<
  Array<{ format: string; path: string; model: string | null; auth_ok: boolean; status: number }>
> {
  const res = await fetch(FAKE().log);
  if (!res.ok) throw new Error("fake provider log " + res.status);
  return (await res.json()) as Array<{ format: string; path: string; model: string | null; auth_ok: boolean; status: number }>;
}
