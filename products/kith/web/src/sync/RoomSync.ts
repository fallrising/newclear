import { ApiError } from "../api/client";
import type { fetchAfter, fetchLatest, fetchOlder, postMessage, probeMe } from "../api/messages";
import type { ServerMessage } from "../api/types";
import { useDraftStore } from "../store/drafts";
import { useStatusStore } from "../store/statuses";
import { useTimelineStore } from "../store/timeline";
import { backoffDelay } from "./backoff";
import { newClientMessageId } from "./clientMessageId";
import { CATCHUP_MAX_PAGES, GAP_GRACE_MS, SEND_ACK_TIMEOUT_MS, type PendingSend, type RoomTimeline, type SyncPhase } from "./types";

// Per-room sync engine (docs/v2/05-frontend-architecture.md §5; docs/v2/milestones/W1.md §5.3.6).
// After every await the first thing is `if (this.stopped) return` (FM-SYNC-10).

export type RoomSyncDeps = {
  roomId: string;
  meId: string;
  api: {
    fetchLatest: typeof fetchLatest;
    fetchOlder: typeof fetchOlder;
    fetchAfter: typeof fetchAfter;
    postMessage: typeof postMessage;
    probeMe: typeof probeMe;
  };
  openSocket: (url: string) => WebSocket;
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
  random: () => number;
  onAuthLost: () => void;
};

function status(e: unknown): number | null {
  return e instanceof ApiError ? e.status : null;
}

export class RoomSync {
  private readonly d: RoomSyncDeps;
  private readonly roomId: string;
  private stopped = false;
  private readonly abort = new AbortController();
  private ws: WebSocket | null = null;
  private wsOpened = false;
  private attempt = 0;
  private reconnectTimer: number | null = null;
  private gapTimer: number | null = null;
  private gapRunning = false;
  private gapRerun = false;
  private inFlight: string | null = null;
  private ackTimer: number | null = null;
  private orderSeq = 0;
  private catchingUp = false;

  constructor(deps: RoomSyncDeps) {
    this.d = deps;
    this.roomId = deps.roomId;
  }

  private S() {
    return useTimelineStore.getState();
  }

  private T(): RoomTimeline {
    return this.S().timelines[this.roomId]!;
  }

  private phase(p: SyncPhase): void {
    this.S().patch(this.roomId, { phase: p });
  }

  // ---- lifecycle ----

  start(): void {
    this.S().ensure(this.roomId);
    window.addEventListener("offline", this.onOffline);
    window.addEventListener("online", this.onOnline);
    // Opening a room again starts from the cached rows; pending sends are retried.
    if (this.orderSeq === 0) this.orderSeq = this.T().pending.reduce((m, p) => Math.max(m, p.order), 0);
    if (navigator.onLine === false) {
      this.phase("offline");
      return;
    }
    if (this.T().seqs.length > 0) this.connect();
    else void this.loadLatest();
  }

  stop(): void {
    useStatusStore.getState().clearRoom(this.roomId);
    useDraftStore.getState().clearRoom(this.roomId);
    this.stopped = true;
    this.abort.abort();
    this.clearTimers();
    window.removeEventListener("offline", this.onOffline);
    window.removeEventListener("online", this.onOnline);
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
    const t = this.S().timelines[this.roomId];
    for (const p of t?.pending ?? []) {
      if (p.state === "sending") this.S().upsertPending(this.roomId, { ...p, state: "queued" });
    }
  }

  private clearTimers(): void {
    for (const id of [this.reconnectTimer, this.gapTimer, this.ackTimer]) if (id !== null) this.d.clearTimer(id);
    this.reconnectTimer = this.gapTimer = this.ackTimer = null;
  }

  private authLost(): void {
    this.phase("auth_lost");
    this.stop();
    this.d.onAuthLost();
  }

  // ---- loading ----

  private async loadLatest(): Promise<void> {
    this.phase("loading_latest");
    try {
      const page = await this.d.api.fetchLatest(this.roomId, this.abort.signal);
      if (this.stopped) return;
      this.S().mergeRows(this.roomId, page.messages);
      this.S().patch(this.roomId, {
        oldestLoaded: page.messages[0]?.seq ?? null,
        hasMoreOlder: page.has_more,
        contiguousHigh: this.T().maxSeq,
      });
      this.connect();
    } catch (e) {
      if (this.stopped) return;
      const s = status(e);
      if (s === 401) this.authLost();
      else if (s === 403 || s === 404) this.phase("not_found");
      else {
        this.phase("load_error");
        this.scheduleReconnect(() => void this.loadLatest());
      }
    }
  }

  loadOlder(): void {
    void this.loadOlderAsync();
  }

  private async loadOlderAsync(): Promise<void> {
    const t = this.T();
    if (t.loadingOlder || !t.hasMoreOlder || t.oldestLoaded === null) return;
    this.S().patch(this.roomId, { loadingOlder: true, olderFailed: false });
    try {
      const page = await this.d.api.fetchOlder(this.roomId, t.oldestLoaded, this.abort.signal);
      if (this.stopped) return;
      this.S().mergeRows(this.roomId, page.messages);
      this.S().patch(this.roomId, {
        oldestLoaded: page.messages[0]?.seq ?? this.T().oldestLoaded,
        hasMoreOlder: page.has_more,
        loadingOlder: false,
      });
    } catch (e) {
      if (this.stopped) return;
      if (status(e) === 401) this.authLost();
      else this.S().patch(this.roomId, { loadingOlder: false, olderFailed: true });
    }
  }

  // ---- connection ----

  private connect(): void {
    this.phase("connecting");
    this.wsOpened = false;
    const url =
      (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/rooms/" + encodeURIComponent(this.roomId) + "/ws";
    const ws = this.d.openSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.wsOpened = true;
      void this.catchUp();
    };
    ws.onmessage = (e: MessageEvent) => {
      if (this.ws !== ws) return;
      this.onMessage(e);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      void this.onClose();
    };
  }

  private scheduleReconnect(fn: () => void): void {
    const delay = backoffDelay(this.attempt, this.d.random);
    this.attempt++;
    if (this.reconnectTimer !== null) this.d.clearTimer(this.reconnectTimer);
    this.reconnectTimer = this.d.setTimer(() => {
      this.reconnectTimer = null;
      fn();
    }, delay);
  }

  private async onClose(): Promise<void> {
    useStatusStore.getState().clearRoom(this.roomId);
    useDraftStore.getState().clearRoom(this.roomId);
    this.ws = null;
    if (this.ackTimer !== null) {
      this.d.clearTimer(this.ackTimer);
      this.ackTimer = null;
    }
    if (this.stopped) return;
    if (this.inFlight !== null) {
      // The connection dropped mid-send: we can't know whether it was stored.
      this.setPendingState(this.inFlight, "unknown");
      this.inFlight = null;
    }
    if (navigator.onLine === false) {
      this.phase("offline");
      return;
    }
    if (!this.wsOpened) {
      try {
        await this.d.api.probeMe(this.abort.signal);
      } catch (e) {
        if (this.stopped) return;
        if (status(e) === 401) {
          this.authLost(); // FM-SYNC-09
          return;
        }
      }
      if (this.stopped) return;
    }
    this.phase("backoff");
    this.scheduleReconnect(() => this.connect());
  }

  private readonly onOffline = (): void => {
    useStatusStore.getState().clearRoom(this.roomId);
    useDraftStore.getState().clearRoom(this.roomId);
    this.phase("offline");
    if (this.reconnectTimer !== null) {
      this.d.clearTimer(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // setOffline does not close an existing socket; close it ourselves.
    this.ws?.close(4001);
  };

  private readonly onOnline = (): void => {
    if (this.T().phase !== "offline") return;
    this.attempt = 0;
    if (this.T().seqs.length === 0) void this.loadLatest();
    else this.connect();
  };

  // ---- catch-up and gaps ----

  /** Move contiguousHigh forward over rows we already have (W1 §5.3.5). */
  private advance(from: number): void {
    let high = from;
    const rows = this.T().rows;
    while (rows[high + 1] !== undefined) high++;
    this.S().patch(this.roomId, { contiguousHigh: high });
  }

  /** Apply a gap-fill / catch-up page to contiguousHigh (W1 §5.3.5). */
  private applyFill(rows: ServerMessage[], hasMore: boolean): void {
    const t = this.T();
    if (rows.length > 0) {
      this.advance(Math.max(t.contiguousHigh, rows[rows.length - 1]!.seq));
    } else if (!hasMore && t.maxSeq > t.contiguousHigh) {
      // Empty answer but rows above: the missing seqs are a confirmed hole (FM-SYNC-04).
      this.S().patch(this.roomId, { contiguousHigh: t.maxSeq });
    }
  }

  private async catchUp(): Promise<void> {
    this.catchingUp = true;
    let pages = 0;
    try {
      for (;;) {
        const page = await this.d.api.fetchAfter(this.roomId, this.T().contiguousHigh, this.abort.signal);
        if (this.stopped) return;
        this.S().mergeRows(this.roomId, page.messages);
        this.applyFill(page.messages, page.has_more);
        this.resolvePendingFrom(page.messages);
        pages++;
        if (!page.has_more) break;
        if (pages >= CATCHUP_MAX_PAGES) {
          await this.jumpToLatest();
          if (this.stopped) return;
          break;
        }
      }
      this.catchingUp = false;
      this.attempt = 0;
      this.phase("live");
      if (this.T().maxSeq > this.T().contiguousHigh) this.scheduleGap();
      this.flushSends();
    } catch (e) {
      this.catchingUp = false;
      if (this.stopped) return;
      if (status(e) === 401) this.authLost();
      else this.ws?.close(4000);
    }
  }

  private async jumpToLatest(): Promise<void> {
    this.S().clearRows(this.roomId);
    const page = await this.d.api.fetchLatest(this.roomId, this.abort.signal);
    if (this.stopped) return;
    this.S().mergeRows(this.roomId, page.messages);
    this.S().patch(this.roomId, {
      oldestLoaded: page.messages[0]?.seq ?? null,
      hasMoreOlder: page.has_more,
      contiguousHigh: this.T().maxSeq,
      jumped: true,
    });
    this.resolvePendingFrom(page.messages);
  }

  private onMessage(e: MessageEvent): void {
    let frame: unknown = null;
    if (typeof e.data === "string") {
      try {
        frame = JSON.parse(e.data) as unknown;
      } catch {
        frame = null;
      }
    }
    if (typeof frame !== "object" || frame === null || (frame as { v?: unknown }).v !== 1) {
      this.S().patch(this.roomId, { badFrames: this.T().badFrames + 1 }); // FM-SYNC-16
      return;
    }
    const f = frame as {
      type?: unknown;
      event?: ServerMessage;
      code?: unknown;
      member_id?: unknown;
      body?: unknown;
      error_class?: unknown;
      generation_id?: unknown;
      text?: unknown;
    };
    if (f.type === "event" && f.event) {
      const row = f.event;
      this.S().mergeRows(this.roomId, [row]);
      this.resolvePendingFrom([row]);
      const high = this.T().contiguousHigh;
      if (row.seq > high) {
        if (row.seq === high + 1) this.advance(row.seq);
        else if (!this.catchingUp) this.scheduleGap();
      }
      if (row.kind === "message") useStatusStore.getState().onMessage(this.roomId, row.sender_id);
      if (row.generation_id !== null) useDraftStore.getState().complete(this.roomId, row.generation_id);
    } else if (f.type === "error") {
      this.handleSendError(typeof f.code === "string" ? f.code : "unknown");
    } else if (f.type === "status" && typeof f.member_id === "string" && typeof f.body === "string") {
      useStatusStore.getState().apply(
        this.roomId,
        {
          member_id: f.member_id,
          body: f.body,
          error_class: typeof f.error_class === "string" ? f.error_class : undefined,
        },
        Date.now(),
      );
      if (f.body === "reply ended" || f.body === "reply failed") useDraftStore.getState().clearMember(this.roomId, f.member_id);
    } else if (
      f.type === "draft" &&
      typeof f.member_id === "string" &&
      typeof f.generation_id === "string" &&
      typeof f.text === "string"
    ) {
      useDraftStore.getState().apply(this.roomId, { member_id: f.member_id, generation_id: f.generation_id, text: f.text });
    }
  }

  private scheduleGap(): void {
    if (this.gapTimer !== null) return;
    this.gapTimer = this.d.setTimer(() => {
      this.gapTimer = null;
      void this.fillGap();
    }, GAP_GRACE_MS);
  }

  private async fillGap(): Promise<void> {
    if (this.T().maxSeq <= this.T().contiguousHigh) return; // healed by itself (FM-SYNC-02)
    if (this.gapRunning) {
      this.gapRerun = true;
      return;
    }
    this.gapRunning = true;
    try {
      const page = await this.d.api.fetchAfter(this.roomId, this.T().contiguousHigh, this.abort.signal);
      if (this.stopped) return;
      this.S().mergeRows(this.roomId, page.messages);
      this.resolvePendingFrom(page.messages);
      this.applyFill(page.messages, page.has_more);
      this.gapRunning = false;
      if (this.gapRerun || this.T().maxSeq > this.T().contiguousHigh) {
        this.gapRerun = false;
        void this.fillGap();
      }
    } catch (e) {
      this.gapRunning = false;
      if (this.stopped) return;
      if (status(e) === 401) this.authLost();
      else this.scheduleGap();
    }
  }

  // ---- sending ----

  sendTyping(): void {
    if (this.T().phase !== "live" || !this.ws) return;
    this.ws.send(JSON.stringify({ v: 1, type: "status", body: "typing" }));
  }

  send(body: string): void {
    const cmid = newClientMessageId(this.d.random);
    this.S().upsertPending(this.roomId, { clientMessageId: cmid, body, order: ++this.orderSeq, state: "queued", failCode: null });
    this.flushSends();
  }

  retry(clientMessageId: string): void {
    const p = this.pending(clientMessageId);
    if (!p) return;
    this.S().upsertPending(this.roomId, { ...p, state: "queued", failCode: null });
    this.flushSends();
  }

  discard(clientMessageId: string): void {
    if (clientMessageId === this.inFlight) return;
    this.S().removePending(this.roomId, clientMessageId);
  }

  private pending(clientMessageId: string): PendingSend | undefined {
    return this.S().timelines[this.roomId]?.pending.find((p) => p.clientMessageId === clientMessageId);
  }

  private setPendingState(clientMessageId: string, state: PendingSend["state"], failCode: string | null = null): void {
    const p = this.pending(clientMessageId);
    if (p) this.S().upsertPending(this.roomId, { ...p, state, failCode });
  }

  /**
   * One WS send in flight at a time: server `error` frames carry no client_message_id, so an error
   * always belongs to the in-flight send (W1 §4.2).
   */
  private flushSends(): void {
    if (this.stopped || this.inFlight !== null || this.T().phase !== "live" || this.ws === null) return;
    const next = this.T().pending.find((p) => p.state === "queued" || p.state === "unknown");
    if (!next) return;
    if (next.state === "unknown") {
      void this.sendViaRest(next.clientMessageId);
      return;
    }
    this.setPendingState(next.clientMessageId, "sending");
    this.inFlight = next.clientMessageId;
    this.ws.send(JSON.stringify({ v: 1, type: "send", client_message_id: next.clientMessageId, body: next.body }));
    this.ackTimer = this.d.setTimer(() => this.onAckTimeout(), SEND_ACK_TIMEOUT_MS);
  }

  private onAckTimeout(): void {
    this.ackTimer = null;
    const cmid = this.inFlight;
    if (cmid === null) return;
    this.setPendingState(cmid, "unknown");
    void this.sendViaRest(cmid);
  }

  /** Same client_message_id, so the server returns the stored row if the WS send landed (FM-SYNC-07). */
  private async sendViaRest(cmid: string): Promise<void> {
    const p = this.pending(cmid);
    if (!p) return;
    this.inFlight = cmid;
    try {
      const row = await this.d.api.postMessage(this.roomId, p.body, cmid, this.abort.signal);
      if (this.stopped) return;
      this.S().mergeRows(this.roomId, [row]);
      this.resolvePendingFrom([row]);
    } catch (e) {
      if (this.stopped) return;
      const s = status(e);
      if (s === 401) {
        this.authLost();
        return;
      }
      const code = e instanceof ApiError && [400, 403, 404, 409].includes(e.status) ? e.code : "network_error";
      this.setPendingState(cmid, "failed", code);
      if (this.inFlight === cmid) this.inFlight = null;
      this.flushSends();
    }
  }

  private handleSendError(code: string): void {
    const cmid = this.inFlight;
    if (cmid === null) return;
    if (this.ackTimer !== null) {
      this.d.clearTimer(this.ackTimer);
      this.ackTimer = null;
    }
    if (code === "not_ready") {
      this.setPendingState(cmid, "unknown");
      void this.sendViaRest(cmid);
    } else if (code === "unauthorized") {
      this.authLost();
    } else {
      // Rejected: show why and do not retry (FM-SYNC-08).
      this.setPendingState(cmid, "failed", code);
      this.inFlight = null;
      this.flushSends();
    }
  }

  private resolvePendingFrom(rows: ServerMessage[]): void {
    for (const row of rows) {
      if (row.sender_id !== this.d.meId) continue;
      if (!this.pending(row.client_message_id)) continue;
      this.S().removePending(this.roomId, row.client_message_id);
      if (row.client_message_id === this.inFlight) {
        if (this.ackTimer !== null) {
          this.d.clearTimer(this.ackTimer);
          this.ackTimer = null;
        }
        this.inFlight = null;
      }
    }
    this.flushSends();
  }
}
