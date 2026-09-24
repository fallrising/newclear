import type { Page, WebSocketRoute } from "@playwright/test";

// Controlled WebSocket faults (docs/v2/08-testing-e2e.md §5.2; docs/v2/milestones/W1.md §5.1.2).

export type FrameDir = "in" | "out"; // in = server→browser; out = browser→server
export type FrameMatch = {
  dir: FrameDir;
  type?: "event" | "status" | "error" | "draft" | "send" | "ack";
  seq?: number;
  bodyIncludes?: string;
};
export type ChaosFrame = { dir: FrameDir; at: number; raw: string; json: unknown | null };
export type ChaosRule =
  | { kind: "hold"; match: FrameMatch }
  | { kind: "delay"; match: FrameMatch; ms: number }
  | { kind: "drop"; match: FrameMatch }
  | { kind: "closeAfter"; match: FrameMatch; code: number };
export interface WsChaos {
  attach(page: Page): Promise<void>;
  add(rule: ChaosRule): string;
  remove(ruleId: string): void;
  release(ruleId: string): void;
  inject(raw: string): void;
  closeFromServer(code: number): void;
  frames(): ChaosFrame[];
  waitForFrame(match: FrameMatch, timeoutMs: number): Promise<ChaosFrame>;
}

type Json = { type?: unknown; event?: { seq?: unknown } } | null;

function matches(match: FrameMatch, dir: FrameDir, json: unknown, raw: string): boolean {
  if (match.dir !== dir) return false;
  const j = (typeof json === "object" ? json : null) as Json;
  if (match.type !== undefined && j?.type !== match.type) return false;
  if (match.seq !== undefined && !(j?.type === "event" && j.event?.seq === match.seq)) return false;
  if (match.bodyIncludes !== undefined && !raw.includes(match.bodyIncludes)) return false;
  return true;
}

class Chaos implements WsChaos {
  private readonly seen: ChaosFrame[] = [];
  private readonly rules = new Map<string, { rule: ChaosRule; held: Array<() => void> }>();
  private ruleSeq = 0;
  private current: { page: WebSocketRoute; server: WebSocketRoute } | null = null;

  async attach(page: Page): Promise<void> {
    await page.routeWebSocket(/\/api\/rooms\/[^/]+\/ws$/, (ws) => {
      const server = ws.connectToServer();
      this.current = { page: ws, server };
      ws.onMessage((m) => this.route("out", String(m), () => server.send(m)));
      server.onMessage((m) => this.route("in", String(m), () => ws.send(m)));
      // No onClose: keep Playwright's default of closing the other side too.
    });
  }

  private route(dir: FrameDir, raw: string, deliver: () => void): void {
    let json: unknown | null = null;
    try {
      json = JSON.parse(raw) as unknown;
    } catch {
      json = null;
    }
    this.seen.push({ dir, at: Date.now(), raw, json });
    for (const entry of this.rules.values()) {
      if (!matches(entry.rule.match, dir, json, raw)) continue;
      const rule = entry.rule;
      if (rule.kind === "hold") entry.held.push(deliver);
      else if (rule.kind === "delay") setTimeout(deliver, rule.ms);
      else if (rule.kind === "closeAfter") {
        deliver();
        void this.current?.page.close({ code: rule.code });
      }
      // drop: never delivered
      return;
    }
    deliver();
  }

  add(rule: ChaosRule): string {
    const id = "r" + ++this.ruleSeq;
    this.rules.set(id, { rule, held: [] });
    return id;
  }

  remove(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  release(ruleId: string): void {
    const entry = this.rules.get(ruleId);
    if (!entry) return;
    const held = entry.held.splice(0);
    for (const deliver of held) deliver();
  }

  inject(raw: string): void {
    this.current?.page.send(raw);
  }

  closeFromServer(code: number): void {
    void this.current?.page.close({ code });
  }

  frames(): ChaosFrame[] {
    return [...this.seen];
  }

  async waitForFrame(match: FrameMatch, timeoutMs: number): Promise<ChaosFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const f = this.seen.find((x) => matches(match, x.dir, x.json, x.raw));
      if (f) return f;
      if (Date.now() > deadline) throw new Error("frame not seen: " + JSON.stringify(match));
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

export function createWsChaos(): WsChaos {
  return new Chaos();
}

export function framesOfType(frames: ChaosFrame[], dir: FrameDir, type: string): ChaosFrame[] {
  return frames.filter((f) => f.dir === dir && (f.json as Json)?.type === type);
}
