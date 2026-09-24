import type { ServerMessage } from "../api/types";

export const PAGE_SIZE = 50;
/** Catch-up pages before giving up and jumping to the latest page (FM-SYNC-13). */
export const CATCHUP_MAX_PAGES = 20;
/** How long a detected gap may heal by itself before we fetch (reordering, FM-SYNC-02). */
export const GAP_GRACE_MS = 500;
/** A WS send without an event this long is resent over REST (FM-SYNC-07). */
export const SEND_ACK_TIMEOUT_MS = 10_000;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;
/** Timelines kept in the store (LRU). */
export const ROOM_CACHE_LIMIT = 5;

export type SyncPhase =
  | "loading_latest"
  | "connecting"
  | "live"
  | "backoff"
  | "offline"
  | "auth_lost"
  | "not_found"
  | "load_error";

export type PendingState = "queued" | "sending" | "unknown" | "failed";

export type PendingSend = {
  clientMessageId: string;
  body: string;
  /** Creation order; pending rows sort by this, never by the client clock (FM-SYNC-18). */
  order: number;
  state: PendingState;
  /** Error code when failed. */
  failCode: string | null;
};

export type RoomTimeline = {
  roomId: string;
  /** key = seq */
  rows: Record<number, ServerMessage>;
  /** keys of rows, ascending */
  seqs: number[];
  /** ascending by order */
  pending: PendingSend[];
  /** -1 when empty */
  maxSeq: number;
  /** Highest seq with no unknown gap below it (W1 §5.3.5). */
  contiguousHigh: number;
  oldestLoaded: number | null;
  hasMoreOlder: boolean;
  loadingOlder: boolean;
  olderFailed: boolean;
  phase: SyncPhase;
  /** Show the "jumped to latest" notice. */
  jumped: boolean;
  /** Frames that could not be parsed (FM-SYNC-16). */
  badFrames: number;
  /** LRU counter */
  lastOpenedAt: number;
};
