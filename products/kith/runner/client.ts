export type FetchFn = typeof fetch;

export class AuthError extends Error {} // 401: token revoked or wrong (FM-RUN-06)

/** Kith HTTP for one bot token. Every call goes to kith_url; the token never appears in logs. */
export class KithClient {
  private readonly base: string;
  private readonly token: string;
  private readonly fetchImpl: FetchFn;

  // No TypeScript parameter properties: runner/ runs under Node's type stripping, which rejects them.
  constructor(base: string, token: string, fetchImpl: FetchFn = fetch) {
    this.base = base;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  private async call(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
    const res = await this.fetchImpl(`${this.base}${pathAndQuery}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${this.token}` },
    });
    if (res.status === 401) {
      await res.body?.cancel();
      throw new AuthError("Kith rejected the bot token (401); it was revoked or is wrong");
    }
    return res;
  }

  private async tool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await this.call("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const json = (await res.json().catch(() => null)) as { result?: { content?: Array<{ text?: string }> }; error?: { message?: string } } | null;
    if (!res.ok || !json || json.error) throw new Error(`${name} failed: HTTP ${res.status}`);
    const text = json.result?.content?.[0]?.text;
    try {
      return text ? (JSON.parse(text) as unknown) : null;
    } catch {
      return text ?? null;
    }
  }

  async me(): Promise<{ id: string; handle: string }> {
    const res = await this.call("/api/me");
    if (!res.ok) throw new Error(`GET /api/me: HTTP ${res.status}`);
    const json = (await res.json()) as { id?: string; handle?: string; member?: { id?: string; handle?: string } };
    const m = json.member ?? json;
    if (typeof m.id !== "string" || typeof m.handle !== "string") throw new Error("GET /api/me: unexpected shape");
    return { id: m.id, handle: m.handle };
  }

  async listRooms(): Promise<string[]> {
    const out = (await this.tool("list_rooms", {})) as { rooms?: Array<{ id?: unknown }> } | null;
    return (out?.rooms ?? []).map((r) => r.id).filter((id): id is string => typeof id === "string");
  }

  /** Newest seq in the room (-1 when empty); the first cursor is MAX(seq), never 0 (INV-19, v1 sidecar rule). */
  async maxSeq(roomId: string): Promise<number> {
    const res = await this.call(`/api/rooms/${encodeURIComponent(roomId)}/messages?order=desc&limit=1&kind=message,trace`);
    if (!res.ok) throw new Error(`messages: HTTP ${res.status}`);
    const json = (await res.json()) as { messages?: Array<{ seq?: number }> };
    const last = json.messages?.at(-1)?.seq;
    return typeof last === "number" ? last : -1;
  }

  events(roomId: string, afterSeq: number, signal: AbortSignal): Promise<Response> {
    return this.call(`/mcp/events?room_id=${encodeURIComponent(roomId)}&after_seq=${afterSeq}`, {
      headers: { accept: "text/event-stream" },
      signal,
    });
  }

  async postStatus(roomId: string, state: "accepted" | "running" | "blocked" | "idle", body = ""): Promise<void> {
    await this.tool("post_status", { room_id: roomId, state, body });
  }

  async sendMessage(roomId: string, body: string, clientMessageId: string, threadId: string | null): Promise<void> {
    await this.tool("send_message", { room_id: roomId, body, client_message_id: clientMessageId, thread_id: threadId, generation_id: null });
  }

  /** B-13: summary in the room (kind=trace, inside the thread), full text stored by Kith. */
  async postTrace(roomId: string, t: { client_message_id: string; summary: string; full: string | null; thread_id: string }): Promise<void> {
    const res = await this.call(`/api/rooms/${encodeURIComponent(roomId)}/traces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(t.full === null ? { client_message_id: t.client_message_id, summary: t.summary, thread_id: t.thread_id } : t),
    });
    if (!res.ok) throw new Error(`traces: HTTP ${res.status}`);
  }
}
