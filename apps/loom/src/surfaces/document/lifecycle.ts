import type { DocSnapshot, WriteOutcome } from "./doc_ipc";

// Editor state survives UI rerenders; this is also the concurrency boundary
// shared by toolbar and keyboard saves.
export class DocumentLifecycle {
  path = "";
  hash = "";
  dirty = false;
  version = 0;
  private readonly pendingSaves = new Set<object>();
  get saving() { return this.pendingSaves.size > 0; }
  creating = false;
  createError: string | null = null;
  private createRequest: object | null = null;
  private epoch = 0;
  private open = false;
  private acceptedHash: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  load(snapshot: DocSnapshot) {
    this.epoch++;
    this.clearCreate();
    this.pendingSaves.clear();
    this.open = true;
    this.path = snapshot.path;
    this.hash = snapshot.on_disk_hash;
    this.dirty = false;
    this.version++;
    this.acceptedHash = null;
  }
  get revision() { return this.epoch; }
  private clearCreate() {
    this.createRequest = null;
    this.creating = false;
    this.createError = null;
  }
  missing(path: string) {
    this.load({ path, content: "", on_disk_hash: "" });
  }
  close() { this.open = false; this.epoch++; this.clearCreate(); this.pendingSaves.clear(); }
  invalidate(): boolean {
    // Reload and watcher invalidation cannot release an IPC still in flight.
    // Closing/replacing the entire document lifetime uses close/load instead.
    if (this.creating) return false;
    this.epoch++;
    this.pendingSaves.clear();
    this.clearCreate();
    return true;
  }
  async create(content: string, create: (path: string, content: string) => Promise<DocSnapshot>): Promise<DocSnapshot | null> {
    if (!this.open || this.creating) return null;
    const request = {};
    this.createRequest = request;
    this.creating = true;
    this.createError = null;
    const savedVersion = this.version;
    try {
      const snapshot = await create(this.path, content);
      if (this.createRequest !== request) return null;
      this.recreated(snapshot, savedVersion);
      return snapshot;
    } catch (error) {
      if (this.createRequest !== request) return null;
      this.createError = String(error);
      throw error;
    } finally {
      // An old finalizer must not clear a newer document's pending action.
      if (this.createRequest === request) {
        this.creating = false;
        this.createRequest = null;
      }
    }
  }
  recreated(snapshot: DocSnapshot, savedVersion: number) {
    this.epoch++;
    this.open = true;
    this.path = snapshot.path;
    this.hash = snapshot.on_disk_hash;
    this.dirty = this.version !== savedVersion;
    this.acceptedHash = null;
  }
  edit() { this.version++; this.dirty = true; }
  keep(observedHash: string) { this.acceptedHash = observedHash; }
  save(content: () => string, write: (path: string, content: string, hash: string | null) => Promise<WriteOutcome>): Promise<WriteOutcome> {
    const requestedEpoch = this.epoch;
    const request = {};
    this.pendingSaves.add(request);
    const operation = this.queue.then(async () => {
      try {
        if (!this.open || this.epoch !== requestedEpoch) throw new Error("Document closed or reloaded before queued save");
        const savedVersion = this.version;
        const expected = this.acceptedHash ?? this.hash;
        // One confirmation authorizes one attempt against those observed bytes.
        this.acceptedHash = null;
        const outcome = await write(this.path, content(), expected);
        if (outcome.kind === "written" && this.open && this.epoch === requestedEpoch) {
          this.hash = outcome.new_hash;
          this.dirty = this.version !== savedVersion;
        }
        return outcome;
      } finally {
        this.pendingSaves.delete(request);
      }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}

export class DocumentReadGate {
  private request = 0;
  invalidate() { this.request++; }
  async read(read: () => Promise<DocSnapshot>): Promise<DocSnapshot | null> {
    const request = ++this.request;
    try {
      const snapshot = await read();
      return this.request === request ? snapshot : null;
    } catch (error) {
      if (this.request !== request) return null;
      throw error;
    }
  }
}
