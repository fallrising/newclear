import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { FormEvent } from "react";
import { APIError, errorText } from "./model";
import {
  DeliveryPager,
  deliveryPath,
  deliveryStates,
  replayDelivery,
  replayErrorText,
  stateLabels,
} from "./deliveries";
import type {
  Delivery,
  DeliveryPageState,
  DeliveryState,
  SubscriptionStatus,
} from "./deliveries";

function useDeliveryPage<T>(
  path: string,
  token: string,
  revision: number,
  denied: (error: unknown) => void,
) {
  const pager = useMemo(
    () => new DeliveryPager<T>(path, token, denied),
    [path, token, revision, denied],
  );
  const state = useSyncExternalStore(
    pager.subscribe,
    pager.getSnapshot,
    pager.getSnapshot,
  );
  useEffect(() => {
    void pager.load();
    return pager.dispose;
  }, [pager]);
  return { ...state, load: pager.load };
}
function time(value: string | null) {
  return value ? value.replace("T", " ").replace("Z", " UTC") : "—";
}
function LoadState<T>({
  page,
  empty,
}: {
  page: DeliveryPageState<T> & { load: () => Promise<void> };
  empty: string;
}) {
  if (page.loading)
    return (
      <div className="loading" role="status">
        <span className="spinner" />
        正在查詢資料…
      </div>
    );
  if (page.error)
    return (
      <div className="notice error" role="alert">
        <span>{errorText(page.error)}</span>
        <button onClick={page.load}>重試</button>
      </div>
    );
  if (!page.items.length)
    return (
      <div className="empty">
        <h3>{empty}</h3>
        <p>請確認設定與篩選條件；沒有投遞不代表已成功送達。</p>
      </div>
    );
  return null;
}
function More<T>({
  page,
  label,
}: {
  page: DeliveryPageState<T> & { load: () => Promise<void> };
  label: string;
}) {
  return !page.loading && page.items.length > 0 ? (
    <div className="pagination">
      <span>
        已載入 {page.items.length} 筆{page.cursor ? "" : " · 已顯示全部"}
      </span>
      {page.cursor && (
        <button onClick={page.load} disabled={page.more}>
          {page.more ? "正在載入…" : `載入更多${label}`}
        </button>
      )}
    </div>
  ) : null;
}
export function SubscriptionCounts({ items }: { items: SubscriptionStatus[] }) {
  return (
    <div className="delivery-subscriptions">
      {items.map((item) => (
        <article className="source-card" key={item.id}>
          <h3>{item.id}</h3>
          <p className="metric-note">
            {item.channel_kind} ·{" "}
            {item.mode === "digest" ? "每日摘要" : "即時投遞"}
          </p>
          <dl>
            {deliveryStates.map((state) => (
              <div key={state}>
                <dt>{stateLabels[state]}</dt>
                <dd>{item.counts[state]}</dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </div>
  );
}
export function LastAttempt({ delivery }: { delivery: Delivery }) {
  const attempt = delivery.last_attempt;
  return (
    <>
      <p>累計嘗試：{delivery.attempt_count}</p>
      {attempt ? (
        <>
          <p>
            <time dateTime={attempt.at}>{time(attempt.at)}</time>
          </p>
          <p>
            {attempt.http_status === null
              ? "未收到 HTTP 回應"
              : `HTTP ${attempt.http_status}`}{" "}
            · {attempt.duration_ms} ms
          </p>
          {attempt.error && <p className="delivery-error">{attempt.error}</p>}
        </>
      ) : (
        <p className="muted">尚無嘗試紀錄</p>
      )}
      {delivery.next_attempt_at && (
        <p>
          下次嘗試：
          <time dateTime={delivery.next_attempt_at}>
            {time(delivery.next_attempt_at)}
          </time>
        </p>
      )}
    </>
  );
}
function Replay({
  delivery,
  token,
  denied,
  accepted,
}: {
  delivery: Delivery;
  token: string;
  denied: (error: unknown) => void;
  accepted: (id: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!reason.trim() || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      await replayDelivery(
        delivery.delivery_id,
        reason,
        token,
        controller.signal,
      );
      if (!controller.signal.aborted) accepted(delivery.delivery_id);
    } catch (problem) {
      if (controller.signal.aborted) return;
      // A readonly token remains valid for queries after a rejected replay.
      if (problem instanceof APIError && problem.status === 401)
        denied(problem);
      setError(problem);
    } finally {
      if (!controller.signal.aborted) {
        setPending(false);
        request.current = null;
      }
    }
  };
  return (
    <form className="delivery-replay" onSubmit={submit}>
      <label>
        重放理由
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          disabled={pending}
          autoComplete="off"
          placeholder="說明已修正的問題"
        />
      </label>
      <button className="outline-button" disabled={pending || !reason.trim()}>
        {pending ? "正在重放…" : "重放（owner）"}
      </button>
      {!!error && (
        <p className="notice error" role="alert">
          {replayErrorText(error)}
        </p>
      )}
    </form>
  );
}
export function Deliveries({
  token,
  denied,
  open,
}: {
  token: string;
  denied: (error: unknown) => void;
  open: (seq: number) => void;
}) {
  const [subscription, setSubscription] = useState("");
  const [state, setState] = useState<DeliveryState | "">("");
  const [revision, setRevision] = useState(0);
  const [accepted, setAccepted] = useState("");
  const subscriptions = useDeliveryPage<SubscriptionStatus>(
    "/v1/subscriptions?limit=100",
    token,
    revision,
    denied,
  );
  const deliveries = useDeliveryPage<Delivery>(
    deliveryPath(subscription, state),
    token,
    revision,
    denied,
  );
  const refresh = () => setRevision((value) => value + 1);
  return (
    <div className="delivery-board">
      <div className="metrics-heading">
        <span>設定由版本控制管理 · 重放限 owner 並記錄理由</span>
        <button className="outline-button" onClick={refresh}>
          重新查詢投遞
        </button>
      </div>
      {accepted && (
        <div className="notice" role="status">
          已排入重放：{accepted}；沿用原投遞 ID，請重新查詢後續結果。
        </div>
      )}
      <section className="panel" aria-label="訂閱投遞統計">
        <div className="panel-heading">
          <h2>訂閱投遞統計</h2>
          <span>目前生效訂閱 · 包含全部狀態</span>
        </div>
        <LoadState page={subscriptions} empty="尚無生效訂閱" />
        {!subscriptions.loading && (
          <SubscriptionCounts items={subscriptions.items} />
        )}
        <More page={subscriptions} label="訂閱" />
      </section>
      <section className="filters" aria-label="投遞篩選">
        <div className="delivery-filters">
          <label>
            訂閱 ID
            <input
              value={subscription}
              onChange={(event) => setSubscription(event.target.value)}
              placeholder="全部訂閱（精確比對）"
            />
          </label>
          <label>
            投遞狀態
            <select
              value={state}
              onChange={(event) =>
                setState(event.target.value as DeliveryState | "")
              }
            >
              <option value="">全部狀態</option>
              {deliveryStates.map((value) => (
                <option value={value} key={value}>
                  {stateLabels[value]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      <section className="panel" aria-label="投遞紀錄">
        <div className="panel-heading">
          <h2>投遞紀錄</h2>
          <span>包含停用訂閱的歷史 · 每頁 100 筆</span>
        </div>
        <LoadState page={deliveries} empty="此條件沒有投遞" />
        {!deliveries.loading && (
          <div className="delivery-list">
            {deliveries.items.map((delivery) => (
              <article className="delivery-card" key={delivery.delivery_id}>
                <div className="delivery-card-heading">
                  <h3>{delivery.delivery_id}</h3>
                  <span className={`delivery-state delivery-${delivery.state}`}>
                    {stateLabels[delivery.state]}
                  </span>
                </div>
                <p>訂閱：{delivery.subscription_id}</p>
                {delivery.event_seq !== null ? (
                  <button
                    className="delivery-event"
                    onClick={() => open(delivery.event_seq!)}
                  >
                    查看事件 #{delivery.event_seq}
                  </button>
                ) : (
                  <p>摘要視窗開始：{time(delivery.window_start)}</p>
                )}
                <LastAttempt delivery={delivery} />
                {delivery.state === "dlq" && (
                  <Replay
                    delivery={delivery}
                    token={token}
                    denied={denied}
                    accepted={(id) => {
                      setAccepted(id);
                      refresh();
                    }}
                  />
                )}
              </article>
            ))}
          </div>
        )}
        <More page={deliveries} label="投遞" />
      </section>
      <p className="board-footnote">
        投遞可能重複；重試與重放沿用同一
        ID，接收端需去重。等待狀態包含首次投遞與重試。
      </p>
    </div>
  );
}
