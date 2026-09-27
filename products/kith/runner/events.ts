export type RoomEvent = {
  seq: number;
  kind: string;
  id: string;
  body: string;
  sender_id: string;
  thread_id: string | null;
  mentions: string[] | null;
  replay: boolean;
  wake: { mentioned: boolean; wake_allowed: boolean } | null;
};

export type StreamItem = { type: "event"; event: RoomEvent } | { type: "gap" };

/** GET /mcp/events reader: CRLF or LF, blank-line framed, `: gap` comment means reconnect (FM-RUN-02). */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamItem> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf = (buf + decoder.decode(value, { stream: true })).replace(/\r\n?/g, "\n");
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const lines = block.split("\n");
        if (lines.some((l) => l.startsWith(": gap"))) {
          yield { type: "gap" };
          continue;
        }
        const data = lines.filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
        if (data === "") continue;
        let o: Record<string, unknown>;
        try {
          o = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        const wake = o.wake && typeof o.wake === "object" ? (o.wake as Record<string, unknown>) : null;
        yield {
          type: "event",
          event: {
            seq: Number(o.seq),
            kind: String(o.kind ?? ""),
            id: typeof o.id === "string" ? o.id : "",
            body: typeof o.body === "string" ? o.body : "",
            sender_id: typeof o.sender_id === "string" ? o.sender_id : "",
            thread_id: typeof o.thread_id === "string" ? o.thread_id : null,
            mentions: Array.isArray(o.mentions) ? o.mentions.filter((m): m is string => typeof m === "string") : null,
            replay: o.replay === true,
            wake: wake ? { mentioned: wake.mentioned === true, wake_allowed: wake.wake_allowed === true } : null,
          },
        };
      }
    }
  } finally {
    reader.releaseLock();
  }
}
