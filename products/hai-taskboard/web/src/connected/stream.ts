import {
  APIError,
  cursorText,
  newer,
  projectPath,
  type Board,
  type Cursor,
} from './client';
type Source = {
  addEventListener(type: string, listener: EventListener): void;
  close(): void;
};
// Every event invalidates the projection. Only a successful snapshot advances the applied cursor.
export class BoardStream {
  private source?: Source;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private refreshing = false;
  private dirty = false;
  private dirtyReconnect = false;
  private generation = 0;
  cursor?: Cursor;
  constructor(
    readonly project: string,
    readonly snapshot: () => Promise<Board>,
    readonly apply: (board: Board) => void,
    readonly status: (status: string) => void,
    readonly authFailure: () => void,
    readonly factory: (url: string) => Source = (url) => new EventSource(url),
  ) {}
  async start() {
    await this.refresh(true);
  }
  private closeSource() {
    const source = this.source;
    this.source = undefined;
    source?.close();
  }
  private invalidateAuthority(status: string) {
    this.generation += 1;
    this.closeSource();
    this.status(status);
  }
  stop() {
    this.stopped = true;
    this.generation += 1;
    this.closeSource();
    clearTimeout(this.timer);
  }
  private connect() {
    if (this.stopped || !this.cursor) return;
    this.closeSource();
    const source = this.factory(
      projectPath(this.project) + '/events?cursor=' + cursorText(this.cursor),
    );
    this.source = source;
    const current = () => !this.stopped && this.source === source;
    source.addEventListener('open', () => {
      if (current()) this.status('Connected');
    });
    const invalidate = (event: Event) => {
      if (!current()) return;
      try {
        const value = JSON.parse((event as MessageEvent).data);
        if (value.reason === 'authorization_revoked') {
          this.invalidateAuthority('Authentication required');
          this.stop();
          this.authFailure();
          return;
        }
        if (
          value.reason ||
          !value.cursor ||
          value.cursor.stream_epoch !== this.cursor?.stream_epoch
        ) {
          void this.refresh(true);
          return;
        }
        if (this.cursor && newer(value.cursor, this.cursor))
          void this.refresh(false);
      } catch {
        void this.refresh(true);
      }
    };
    for (const name of [
      'projection',
      'projection_reset_required',
      'message',
      'project.changed',
      'work_item.changed',
      'attention.changed',
      'impact_plan.created',
      'run.changed',
      'reset_required',
      'reset-required',
    ])
      source.addEventListener(name, invalidate);
    source.addEventListener('error', () => {
      if (!current()) return;
      this.invalidateAuthority('Disconnected');
      clearTimeout(this.timer);
      // Recreate instead of permitting native reconnect with a contradictory Last-Event-ID.
      this.timer = setTimeout(() => {
        void this.refresh(true);
      }, 3000);
    });
  }
  async refresh(reconnect = false): Promise<boolean> {
    if (this.stopped) return false;
    // Reset removes authority synchronously, even if another snapshot is already in flight.
    if (reconnect) this.invalidateAuthority('Revalidating');
    if (this.refreshing) {
      this.dirty = true;
      this.dirtyReconnect ||= reconnect;
      return false;
    }
    this.refreshing = true;
    const generation = this.generation;
    clearTimeout(this.timer);
    try {
      const board = await this.snapshot();
      if (this.stopped || generation !== this.generation) return false;
      this.cursor = board.cursor;
      this.apply(board);
      if (reconnect || !this.source) this.connect();
      return true;
    } catch (error) {
      if (this.stopped || generation !== this.generation) return false;
      this.closeSource();
      if (
        error instanceof APIError &&
        (error.status === 401 || error.status === 403)
      ) {
        this.invalidateAuthority('Authentication required');
        this.stop();
        this.authFailure();
      } else {
        this.status('Disconnected — snapshot unavailable');
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          void this.refresh(true);
        }, 3000);
      }
      return false;
    } finally {
      this.refreshing = false;
      if (this.dirty) {
        const reconnectNext = this.dirtyReconnect;
        this.dirty = false;
        this.dirtyReconnect = false;
        void this.refresh(reconnectNext);
      }
    }
  }
}
