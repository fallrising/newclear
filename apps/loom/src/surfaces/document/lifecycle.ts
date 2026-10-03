import type { DocSnapshot, WriteOutcome } from "./doc_ipc";

// Editor state survives UI rerenders; this is also the concurrency boundary
// shared by toolbar and keyboard saves.
export class DocumentLifecycle {
  path = "";
  hash = "";
  dirty = false;
  version = 0;
  saving = false;
  private epoch = 0;
  private open = false;
  private acceptedHash: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  load(snapshot: DocSnapshot) {
    this.epoch++;
    this.open = true;
    this.path = snapshot.path;
    this.hash = snapshot.on_disk_hash;
    this.dirty = false;
    this.version++;
    this.acceptedHash = null;
  }
  get revision() { return this.epoch; }
  close() { this.open = false; this.epoch++; }
  invalidate() { this.epoch++; }
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
    const operation = this.queue.then(async () => {
      if (!this.open || this.epoch !== requestedEpoch) throw new Error("Document closed or reloaded before queued save");
      const savedVersion = this.version;
      const expected = this.acceptedHash ?? this.hash;
      // One confirmation authorizes one attempt against those observed bytes.
      // It never authorizes skipping optimistic concurrency altogether.
      this.acceptedHash = null;
      this.saving = true;
      try {
        const outcome = await write(this.path, content(), expected);
        if (outcome.kind === "written" && this.open && this.epoch === requestedEpoch) {
          this.hash = outcome.new_hash;
          this.dirty = this.version !== savedVersion;
        }
        return outcome;
      } finally {
        this.saving = false;
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

export async function createMissingDocument(path: string, content: string, write: (path: string, content: string, hash: string | null) => Promise<WriteOutcome>, read: (path: string) => Promise<DocSnapshot>) {
  const outcome = await write(path, content, null);
  if (outcome.kind !== "written") throw new Error("Document creation conflicted with on-disk bytes");
  return read(path);
}
