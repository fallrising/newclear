import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const DONE_MAX = 500;

type StateFile = { version: 1; rooms: Record<string, { cursor: number }>; done: string[] };

/** Persistent cursor per room and the last executed triggers (FM-RUN-01, FM-RUN-05). Written atomically. */
export class RunnerState {
  private data: StateFile;
  private readonly file: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, "state.json");
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as StateFile;
      this.data = parsed.version === 1 ? parsed : { version: 1, rooms: {}, done: [] };
    } catch {
      this.data = { version: 1, rooms: {}, done: [] };
    }
  }

  cursor(roomId: string): number | null {
    return this.data.rooms[roomId]?.cursor ?? null;
  }

  setCursor(roomId: string, seq: number): void {
    const cur = this.data.rooms[roomId]?.cursor ?? -1;
    if (seq <= cur) return;
    this.data.rooms[roomId] = { cursor: seq };
    this.save();
  }

  isDone(roomId: string, seq: number): boolean {
    return this.data.done.includes(`${roomId}:${seq}`);
  }

  markDone(roomId: string, seq: number): void {
    const key = `${roomId}:${seq}`;
    if (this.data.done.includes(key)) return;
    this.data.done.push(key);
    if (this.data.done.length > DONE_MAX) this.data.done.splice(0, this.data.done.length - DONE_MAX);
    this.save();
  }

  private save(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
