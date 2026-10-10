import type { WindowCloseParticipant } from "../document/window_participant";

export interface WindowCloseState {
  phase: "idle" | "prompt" | "saving" | "committing";
  error: string | null;
}
type Registration = { participant: WindowCloseParticipant };
type Snapshot = { id: string; entry: Registration; revision: string; dirty: boolean };
interface Dependencies {
  /** null means hydration or an admitted canvas operation is still pending. */
  expected(): string[] | null;
  flush(): Promise<void>;
  approve(): Promise<void>;
  changed(state: WindowCloseState): void;
}

/** Runtime-only window intent. No document removal callback belongs here. */
export class WindowCloseCoordinator {
  state: WindowCloseState = { phase: "idle", error: null };
  private participants = new Map<string, Registration>();
  private intent = 0;
  private operation = false;
  private disposed = false;
  private membership = 0;
  constructor(private readonly deps: Dependencies) {}

  register(id: string, participant: WindowCloseParticipant): () => void {
    const entry = { participant };
    this.participants.set(id, entry);
    this.membership++;
    return () => {
      if (this.participants.get(id) === entry) {
        this.participants.delete(id);
        this.membership++;
      }
    };
  }
  private publish(phase: WindowCloseState["phase"], error: string | null = null) {
    this.state = { phase, error };
    this.deps.changed(this.state);
  }
  private capture(): Snapshot[] {
    const ids = this.deps.expected();
    if (!ids) throw new Error("Workspace is still loading or has an operation in progress. Retry when it finishes.");
    return ids.map((id) => {
      const entry = this.participants.get(id);
      const snapshot = entry?.participant.snapshot();
      if (!entry || !snapshot) throw new Error("A document is not ready. Retry when it finishes loading.");
      if (snapshot.busy) throw new Error("A document has work in progress. Wait for it to finish or cancel that work.");
      return { id, entry, revision: snapshot.revision, dirty: snapshot.dirty };
    });
  }
  private validate(original: Snapshot[], membership: number) {
    const current = this.capture();
    if (membership !== this.membership || current.length !== original.length || current.some((item, index) => {
      const before = original[index]!;
      return item.id !== before.id || item.entry !== before.entry || item.revision !== before.revision || item.dirty;
    })) throw new Error("Documents changed while closing. Review them and try Save all again.");
  }
  async request(): Promise<void> {
    if (this.disposed || this.state.phase !== "idle") return;
    this.intent++;
    this.publish("prompt");
    try {
      if (!this.operation && this.capture().every((item) => !item.dirty)) await this.saveAll();
    } catch { /* Unready workspaces remain behind the explicit decision. */ }
  }
  cancel() {
    if (this.disposed || this.state.phase === "committing") return;
    this.intent++;
    this.publish("idle");
  }
  async saveAll(): Promise<void> { await this.finish(false); }
  async discard(): Promise<void> { await this.finish(true); }
  private async finish(discard: boolean) {
    if (this.disposed || this.state.phase !== "prompt") return;
    // Cancel does not undo a submitted write. Keep this lock until all of that
    // attempt's work settles, even if another native request opened a prompt.
    if (this.operation && !discard) {
      this.publish("prompt", "The previous save is still finishing. Retry when it completes.");
      return;
    }
    if (!discard) this.operation = true;
    const intent = this.intent;
    const active = () => !this.disposed && intent === this.intent;
    this.publish("saving");
    try {
      const membership = this.membership;
      const original = discard ? [] : this.capture();
      // Preflight all participants before submitting any document writes.
      for (const item of original) {
        if (item.dirty && !item.entry.participant.snapshot()?.canSave) {
          throw new Error("A document cannot be saved. Resolve its conflict or missing file first.");
        }
      }
      for (const item of original) {
        if (!active()) return;
        if (item.dirty && !await item.entry.participant.save()) {
          throw new Error("A document could not be saved. Resolve the error in that document and retry.");
        }
      }
      if (!active()) return;
      if (!discard) this.validate(original, membership);
      await this.deps.flush();
      if (!active()) return;
      if (!discard) this.validate(original, membership);
      // changed() synchronously freezes input before dispatch. There is no
      // await between final validation, the freeze and the native invocation.
      this.publish("committing");
      await this.deps.approve();
    } catch (error) {
      if (active()) this.publish("prompt", `Window remains open: ${String(error)}`);
    } finally {
      if (!discard) this.operation = false;
    }
  }
  activate() { this.disposed = false; }
  dispose() { this.disposed = true; this.intent++; }
}
