import type { SessionMeta } from "../../contracts/SessionMeta";
import type { SessionHistorySnapshot } from "../../ipc";

export interface HistoryApi {
  listen(handler: () => void): Promise<() => void>;
  read(): Promise<SessionHistorySnapshot>;
  restart(id: string): Promise<string>;
  forget(id: string): Promise<void>;
  meta(id: string): Promise<SessionMeta | null>;
  kill(id: string): Promise<void>;
}

export interface HistoryState {
  snapshot: SessionHistorySnapshot | null;
  loading: boolean;
  error: string | null;
  pending: Map<string, "restart" | "forget">;
  actionErrors: Map<string, string>;
  cleanupErrors: Map<string, string>;
}

// A canvas can disappear while its restart is still awaiting IPC. Keep late
// cleanup failures until the next mounted history view can show and retry them.
const cleanupFailures = new Map<string, string>();
const cleanupObservers = new Set<() => void>();

export async function cleanupUnattachedSession(id: string, kill: (id: string) => Promise<void>): Promise<void> {
  try { await kill(id); cleanupFailures.delete(id); }
  catch (error) { cleanupFailures.set(id, `Terminal cleanup failed: ${String(error)}`); }
  cleanupObservers.forEach((changed) => changed());
}

export function eligibleForRecovery(session: SessionMeta, snapshot: SessionHistorySnapshot): boolean {
  return !snapshot.live_session_ids.includes(session.id)
    && (session.state.kind === "exited" || session.state.kind === "tombstone");
}

// History owns metadata requests only. Canvas layout and editor state remain
// with CanvasSurface; attach adds one node and never rehydrates the canvas.
export class SessionHistoryController {
  state: HistoryState = { snapshot: null, loading: false, error: null, pending: new Map(), actionErrors: new Map(), cleanupErrors: new Map() };
  private alive = false;
  private generation = 0;
  private off?: () => void;
  private registration?: Promise<void>;
  private operations = new Map<string, { canceled: boolean }>();
  private cleanupChanged = () => { this.update({ cleanupErrors: new Map(cleanupFailures) }); };

  constructor(private api: HistoryApi, private changed: (state: HistoryState) => void, private attach: (meta: SessionMeta) => boolean) {}

  private update(patch: Partial<HistoryState>) {
    if (!this.alive) return;
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }

  async start() {
    this.alive = true;
    cleanupObservers.add(this.cleanupChanged);
    this.cleanupChanged();
    await this.refresh();
  }

  private async register() {
    if (this.off) return;
    if (!this.registration) {
      this.registration = this.api.listen(() => { void this.refresh(); }).then((off) => {
        if (this.alive) this.off = off;
        else off();
      });
    }
    const registration = this.registration;
    try { await registration; }
    finally { if (this.registration === registration) this.registration = undefined; }
  }

  async refresh() {
    if (!this.alive) return;
    const generation = ++this.generation;
    this.update({ loading: true, error: null });
    try {
      await this.register();
      if (!this.alive || generation !== this.generation) return;
      const snapshot = await this.api.read();
      if (this.alive && generation === this.generation) this.update({ snapshot, loading: false, error: null });
    } catch (error) {
      if (this.alive && generation === this.generation) this.update({ loading: false, error: `Session history could not be read: ${String(error)}` });
    }
  }

  private begin(id: string, action: "restart" | "forget") {
    const snapshot = this.state.snapshot;
    const session = snapshot?.sessions.find((item) => item.id === id);
    if (!this.alive || !snapshot || !session || this.state.error || this.state.loading || this.operations.has(id) || !eligibleForRecovery(session, snapshot)) return null;
    const operation = { canceled: false };
    this.operations.set(id, operation);
    const pending = new Map(this.state.pending).set(id, action);
    const actionErrors = new Map(this.state.actionErrors); actionErrors.delete(id);
    this.update({ pending, actionErrors });
    return operation;
  }

  private finish(id: string) {
    this.operations.delete(id);
    const pending = new Map(this.state.pending); pending.delete(id);
    this.update({ pending });
  }

  private fail(id: string, action: string, error: unknown) {
    this.update({ actionErrors: new Map(this.state.actionErrors).set(id, `${action} failed: ${String(error)}`) });
  }

  private async cleanup(id: string) {
    await cleanupUnattachedSession(id, (sessionId) => this.api.kill(sessionId));
  }

  async retryCleanup(id: string) { await this.cleanup(id); }

  async restart(id: string) {
    const operation = this.begin(id, "restart");
    if (!operation) return;
    let spawned: string | null = null;
    try {
      spawned = await this.api.restart(id);
      if (!this.alive || operation.canceled) { await this.cleanup(spawned); return; }
      const meta = await this.api.meta(spawned);
      if (!meta) throw new Error("New session metadata is unavailable");
      if (!this.alive || operation.canceled || !this.attach(meta)) { await this.cleanup(spawned); return; }
      spawned = null; // Ownership transferred to the canvas terminal.
    } catch (error) {
      if (spawned) await this.cleanup(spawned);
      this.fail(id, "Restart", error);
    } finally {
      this.finish(id);
      await this.refresh();
    }
  }

  async forget(id: string) {
    if (!this.begin(id, "forget")) return;
    try { await this.api.forget(id); }
    catch (error) { this.fail(id, "Forget history", error); }
    finally { this.finish(id); await this.refresh(); }
  }

  cancel(id: string) { const operation = this.operations.get(id); if (operation) operation.canceled = true; }

  dispose() {
    this.alive = false; ++this.generation;
    cleanupObservers.delete(this.cleanupChanged);
    this.operations.forEach((operation) => { operation.canceled = true; });
    this.off?.(); this.off = undefined;
  }
}
