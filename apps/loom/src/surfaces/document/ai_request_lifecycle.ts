import { AiEventGate } from "./ai_lifecycle";
import type { AiEvent } from "./ai_ipc";

export interface AiRequestState {
  busy: boolean;
  requestId: string | null;
}

/** One document effect lifetime; never reused after close. */
export class AiRequestLifecycle {
  private readonly gate = new AiEventGate();
  private closed = false;
  private busy = false;
  private requestId: string | null = null;

  constructor(
    private readonly cancelRequest: (id: string) => Promise<unknown>,
    private readonly deliver: (event: AiEvent) => void,
    private readonly changed: (state: AiRequestState) => void,
    private readonly failed: (error: unknown, operation: "request" | "cancel") => void,
  ) {}

  private notify() {
    if (!this.closed) this.changed({ busy: this.busy, requestId: this.requestId });
  }

  private readonly receive = (event: AiEvent) => {
    if (this.closed) return;
    if (event.kind === "done" || event.kind === "error" || event.kind === "cancelled") {
      this.busy = false;
      this.requestId = null;
      this.notify();
    }
    this.deliver(event);
  };

  accept(event: AiEvent) {
    if (!this.closed) this.gate.accept(event, this.receive);
  }

  async submit<Input>(
    ready: Promise<void> | null,
    prepare: () => Promise<Input>,
    ask: (input: Input) => Promise<string>,
    submitted: () => void,
  ): Promise<void> {
    if (this.closed || this.busy) return;
    this.busy = true;
    this.notify();
    try {
      if (!ready) throw new Error("AI listener is not ready");
      await ready;
      if (this.closed) return;
      const input = await prepare();
      if (this.closed) return;
      this.gate.begin();
      const id = await ask(input);
      if (this.closed) {
        this.cancelQuietly(id);
        return;
      }
      this.requestId = id;
      this.gate.activate(id, this.receive);
      this.notify();
      if (!this.closed) submitted();
    } catch (error) {
      if (this.closed) return;
      if (this.requestId) this.cancelQuietly(this.requestId);
      this.gate.reset();
      this.busy = false;
      this.requestId = null;
      this.notify();
      this.failed(error, "request");
    }
  }

  async cancel(): Promise<void> {
    const id = this.requestId;
    if (this.closed || !id) return;
    try {
      await this.cancelRequest(id);
    } catch (error) {
      if (!this.closed && this.requestId === id) this.failed(error, "cancel");
    }
  }

  private cancelQuietly(id: string) {
    void this.cancelRequest(id).catch(() => undefined);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const id = this.requestId;
    this.gate.reset();
    this.requestId = null;
    this.busy = false;
    if (id) this.cancelQuietly(id);
  }
}
