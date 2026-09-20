import type { SidecarConfig } from "./config.ts";

export type FetchFn = typeof fetch;

export type HttpCall = {
  url: string;
  method: string;
  body: string;
};

export function eventsUrl(base: string, roomId: string, afterSeq: number): string {
  const root = base.replace(/\/$/, "");
  return `${root}/mcp/events?room_id=${encodeURIComponent(roomId)}&after_seq=${afterSeq}`;
}

export function mcpUrl(base: string): string {
  return `${base.replace(/\/$/, "")}/mcp`;
}

export function traceUrl(base: string, roomId: string): string {
  return `${base.replace(/\/$/, "")}/api/rooms/${encodeURIComponent(roomId)}/messages`;
}

export async function mcpToolCall(
  fetchImpl: FetchFn,
  config: SidecarConfig,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<Response> {
  return fetchImpl(mcpUrl(config.mcp_base_url), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}

export async function postStatusAccepted(
  fetchImpl: FetchFn,
  config: SidecarConfig,
  token: string,
  generationId: string,
): Promise<Response> {
  return mcpToolCall(fetchImpl, config, token, "post_status", {
    room_id: config.room_id,
    state: "accepted",
    generation_id: generationId,
  });
}

export async function sendMessage(
  fetchImpl: FetchFn,
  config: SidecarConfig,
  token: string,
  body: string,
  generationId: string,
): Promise<Response> {
  const clientId = `kith${generationId.replace(/-/g, "").slice(0, 20)}`;
  return mcpToolCall(fetchImpl, config, token, "send_message", {
    room_id: config.room_id,
    body,
    client_message_id: clientId,
    // Sidecar is not HostedGeneration; a generation_id here would 409 generation_dropped.
    generation_id: null,
  });
}

export async function postTrace(
  fetchImpl: FetchFn,
  config: SidecarConfig,
  token: string,
  body: string,
  generationId: string,
): Promise<Response> {
  return fetchImpl(traceUrl(config.mcp_base_url, config.room_id), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      kind: "trace",
      body,
      generation_id: generationId,
      client_message_id: `tr${generationId.replace(/-/g, "").slice(0, 22)}`,
    }),
  });
}
