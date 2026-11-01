import type { ContextSource } from "../canvas/edges";
import type { AiEvent, PinnedContext } from "./ai_ipc";

export async function collectContext(sources: ContextSource[], readDoc: (path: string) => Promise<{ content: string }>, scrollback: (session: string) => Promise<string>): Promise<PinnedContext[]> {
  return Promise.all(sources.map(async (source) => {
    const label = source.kind === "doc" ? `doc:${source.path}` : `term:${source.label}`;
    try {
      const content = source.kind === "doc" ? (await readDoc(source.path)).content : await scrollback(source.sessionId);
      return { source: label, content };
    } catch (error) { throw new Error(`Cannot read AI context ${label}: ${String(error)}`); }
  }));
}

export class AiEventGate {
  private id: string | null = null;
  private pending = false;
  private events: AiEvent[] = [];
  private overflow = false;
  begin() { this.reset(); this.pending = true; }
  accept(event: AiEvent, deliver: (event: AiEvent) => void) {
    if (this.pending) {
      // Buffer only while invoke is pending, then discard other requests.
      // Bound the buffer and surface overflow instead of claiming success.
      if (this.events.length >= 4096) { this.overflow = true; return; }
      this.events.push(event);
      return;
    }
    if (event.request_id !== this.id) return;
    if (event.kind === "done" || event.kind === "error" || event.kind === "cancelled") this.id = null;
    deliver(event);
  }
  activate(id: string, deliver: (event: AiEvent) => void) {
    const buffered = this.events;
    const overflow = this.overflow;
    this.reset();
    if (overflow) throw new Error("AI event buffer overflow before request registration");
    this.id = id;
    buffered.forEach((event) => this.accept(event, deliver));
  }
  reset() { this.id = null; this.pending = false; this.events = []; this.overflow = false; }
}
