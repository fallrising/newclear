import { APIError, api, errorText } from "./model";
import type { Page } from "./model";

export const deliveryStates = [
  "pending",
  "inflight",
  "succeeded",
  "dlq",
] as const;
export type DeliveryState = (typeof deliveryStates)[number];
export const stateLabels: Record<DeliveryState, string> = {
  pending: "等待／重試中",
  inflight: "投遞中",
  succeeded: "成功",
  dlq: "DLQ",
};
export interface SubscriptionStatus {
  id: string;
  mode: "immediate" | "digest";
  channel_kind: "webhook" | "ntfy";
  counts: Record<DeliveryState, number>;
}
export interface Delivery {
  delivery_id: string;
  subscription_id: string;
  state: DeliveryState;
  event_seq: number | null;
  window_start: string | null;
  attempt_count: number;
  last_attempt: {
    at: string;
    http_status: number | null;
    duration_ms: number;
    error: string | null;
  } | null;
  next_attempt_at: string | null;
}
export function deliveryPath(
  subscription: string,
  state: string,
  cursor = "",
): string {
  const query = new URLSearchParams({ limit: "100" });
  if (subscription) query.set("subscription", subscription);
  if (state) query.set("state", state);
  if (cursor) query.set("cursor", cursor);
  return "/v1/deliveries?" + query;
}
export function replayErrorText(error: unknown): string {
  if (error instanceof APIError) {
    if (error.status === 403)
      return "重放需要 owner token（403）；唯讀 token 可以繼續查詢。請清除 token 後以 owner token 重新連線。";
    if (error.status === 409)
      return "這筆投遞已不在 DLQ（409）；請重新查詢最新狀態。";
    if (error.status === 400)
      return "重放被拒絕（400）；請填寫非空白理由後再試。";
  }
  return errorText(error);
}
export async function replayDelivery(
  id: string,
  reason: string,
  token: string,
  signal: AbortSignal,
): Promise<{ delivery_id: string; state: "pending" }> {
  if (!reason.trim()) throw new Error("A nonblank replay reason is required");
  signal.throwIfAborted();
  const response = await fetch(
    `/v1/deliveries/${encodeURIComponent(id)}:replay`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "omit",
      cache: "no-store",
      signal,
      body: JSON.stringify({ reason: reason.trim() }),
    },
  );
  signal.throwIfAborted();
  if (!response.ok) throw new APIError(response.status);
  const accepted = (await response.json()) as {
    delivery_id: string;
    state: "pending";
  };
  signal.throwIfAborted();
  return accepted;
}
export interface DeliveryPageState<T> {
  items: T[];
  cursor: string | null;
  loading: boolean;
  more: boolean;
  error: unknown;
}
// Each query/session owns one pager. Disposing it clears data and fences late
// responses even when a transport ignores cancellation. Failed later pages
// preserve the prior rows and cursor so Retry never skips a page.
export class DeliveryPager<T> {
  private state: DeliveryPageState<T> = {
    items: [],
    cursor: null,
    loading: true,
    more: false,
    error: null,
  };
  private listeners = new Set<() => void>();
  private request: AbortController | null = null;
  private disposed = false;
  private started = false;
  private cursors = new Set<string>();
  constructor(
    private path: string,
    private token: string,
    private denied: (error: unknown) => void,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: DeliveryPageState<T>) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  load = async () => {
    if (
      this.disposed ||
      this.request ||
      !this.token ||
      (this.started && !this.state.cursor && !this.state.error)
    )
      return;
    const cursor = this.state.cursor;
    const request = new AbortController();
    this.request = request;
    this.publish({
      ...this.state,
      loading: !cursor,
      more: !!cursor,
      error: null,
    });
    const url = new URL(this.path, "http://localhost");
    if (cursor) url.searchParams.set("cursor", cursor);
    try {
      const page = await api<Page<T>>(
        url.pathname + url.search,
        this.token,
        request.signal,
      );
      if (request.signal.aborted || this.disposed) return;
      if (page.next_cursor && this.cursors.has(page.next_cursor))
        throw new Error("Repeated pagination cursor");
      if (page.next_cursor) this.cursors.add(page.next_cursor);
      this.started = true;
      this.publish({
        items: cursor ? [...this.state.items, ...page.items] : page.items,
        cursor: page.next_cursor,
        loading: false,
        more: false,
        error: null,
      });
    } catch (error) {
      if (request.signal.aborted || this.disposed) return;
      this.denied(error);
      this.publish({ ...this.state, loading: false, more: false, error });
    } finally {
      if (this.request === request) this.request = null;
    }
  };
  dispose = () => {
    this.disposed = true;
    this.request?.abort();
    this.token = "";
    this.state = {
      items: [],
      cursor: null,
      loading: false,
      more: false,
      error: null,
    };
  };
}
