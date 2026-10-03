import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  APIError,
  api,
  applyFilters,
  customUTC,
  errorText,
  eventsPath,
  filterKeys,
  initialParams,
  localInput,
  presetRange,
  readFilters,
  safeOriginURL,
  severities,
  sortedRelated,
  sourceLabel,
} from "./model";
import type { EventDetail, Filters, Page, Source, StoredEvent } from "./model";
import "./style.css";

type IconName =
  | "signal"
  | "timeline"
  | "sources"
  | "refresh"
  | "arrow"
  | "lock"
  | "search"
  | "close"
  | "external"
  | "warning";
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    signal: (
      <>
        <path d="M3 12h4l3-8 4 16 3-8h4" />
      </>
    ),
    timeline: (
      <>
        <path d="M8 4v16M12 6h8M12 12h6M12 18h8" />
        <circle cx="8" cy="6" r="2" />
        <circle cx="8" cy="12" r="2" />
        <circle cx="8" cy="18" r="2" />
      </>
    ),
    sources: (
      <>
        <rect x="4" y="3" width="16" height="7" rx="2" />
        <rect x="4" y="14" width="16" height="7" rx="2" />
        <path d="M8 6h.01M8 17h.01M12 6h5M12 17h5" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M6 6a8 8 0 0 1 13 3M18 18A8 8 0 0 1 5 15" />
      </>
    ),
    arrow: (
      <>
        <path d="M4 12h16M14 6l6 6-6 6" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    external: (
      <>
        <path d="M14 3h7v7M21 3l-10 10M10 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5" />
      </>
    ),
    warning: (
      <>
        <path d="m12 3 10 18H2L12 3Z" />
        <path d="M12 9v5M12 17h.01" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
function formatTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-TW", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        timeZone: "UTC",
      }).format(date) + " UTC";
}
function useURL() {
  const [params, setParams] = useState(() =>
    initialParams(window.location.search),
  );
  useEffect(() => {
    // Use the bounds computed on the first render. Computing "now" a second
    // time here would put different milliseconds into the URL and the query.
    window.history.replaceState(null, "", "/?" + params);
    const pop = () => {
      const next = initialParams(window.location.search);
      window.history.replaceState(null, "", "/?" + next);
      setParams(next);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const navigate = useCallback((next: URLSearchParams) => {
    window.history.pushState(null, "", "/?" + next);
    setParams(next);
  }, []);
  return [params, navigate] as const;
}
interface PageState<T> {
  items: T[];
  cursor: string | null;
  loading: boolean;
  more: boolean;
  error: unknown;
  at: string | null;
  path: string;
}
function usePage<T>(
  path: string,
  token: string,
  denied: (error: unknown) => void,
) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<PageState<T>>({
    items: [],
    cursor: null,
    loading: false,
    more: false,
    error: null,
    at: null,
    path,
  });
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const request = new AbortController();
    controller.current?.abort();
    controller.current = request;
    const current = ++generation.current;
    setState((previous) => ({
      items: [],
      cursor: null,
      loading: !!token,
      more: false,
      error: null,
      at: previous.path === path ? previous.at : null,
      path,
    }));
    if (token)
      api<Page<T>>(path, token, request.signal)
        .then((page) => {
          if (request.signal.aborted || current !== generation.current) return;
          setState({
            items: page.items,
            cursor: page.next_cursor,
            loading: false,
            more: false,
            error: null,
            at: new Date().toISOString(),
            path,
          });
        })
        .catch((error) => {
          if (request.signal.aborted || current !== generation.current) return;
          denied(error);
          setState((previous) => ({ ...previous, loading: false, error }));
        });
    return () => {
      request.abort();
      controller.current?.abort();
    };
  }, [path, token, revision, denied]);
  const loadMore = async () => {
    if (!state.cursor || state.loading || state.more || !token) return;
    const request = new AbortController();
    controller.current?.abort();
    controller.current = request;
    const current = generation.current;
    const query = new URL(path, window.location.origin);
    query.searchParams.set("cursor", state.cursor);
    setState((previous) => ({ ...previous, more: true, error: null }));
    try {
      const page = await api<Page<T>>(
        query.pathname + query.search,
        token,
        request.signal,
      );
      if (request.signal.aborted || current !== generation.current) return;
      setState((previous) => ({
        ...previous,
        items: [...previous.items, ...page.items],
        cursor: page.next_cursor,
        more: false,
        at: new Date().toISOString(),
      }));
    } catch (error) {
      if (request.signal.aborted || current !== generation.current) return;
      denied(error);
      setState((previous) => ({ ...previous, more: false, error }));
    }
  };
  // Do not expose the preceding filter's rows while the new effect is starting.
  const visible =
    state.path === path && token
      ? state
      : { ...state, items: [], cursor: null, loading: !!token, error: null };
  return {
    ...visible,
    loadMore,
    refresh: () => setRevision((value) => value + 1),
  };
}
function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="notice error" role="alert">
      <Icon name="warning" />
      <span>{errorText(error)}</span>
      {retry && <button onClick={retry}>重試</button>}
    </div>
  );
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name="signal" size={32} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      正在查詢資料…
    </div>
  );
}
function Severity({ value = "info" }: { value?: string }) {
  return (
    <span
      className={
        "severity severity-" +
        (severities.includes(value as (typeof severities)[number])
          ? value
          : "info")
      }
    >
      <span />
      {value}
    </span>
  );
}
function Login({
  onConnect,
  error,
}: {
  onConnect: (token: string) => void;
  error: unknown;
}) {
  const [entry, setEntry] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!entry || pending) return;
    const candidate = entry;
    setPending(true);
    setFailure(null);
    setEntry("");
    try {
      await api("/v1/events?limit=1", candidate);
      onConnect(candidate);
    } catch (problem) {
      setFailure(problem);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="connect-layout">
      <div className="connect-intro">
        <span className="eyebrow">SIGNAL HUB / OBSERVATION BOARD</span>
        <h1>
          把訊號串成
          <br />
          清楚的脈絡。
        </h1>
        <p>
          查閱跨來源事件、追溯關聯鏈，
          <br />
          確認每個來源的資料新鮮度。
        </p>
        <div className="connect-flow">
          <span>來源</span>
          <i />
          <Icon name="signal" size={34} />
          <i />
          <span>事件脈絡</span>
        </div>
        <span className="intro-note">事件時間線 · 原始事件 · 來源新鮮度</span>
      </div>
      <section className="connect-card">
        <span className="lock-mark">
          <Icon name="lock" size={26} />
        </span>
        <h2>連線至事件中樞</h2>
        <p>輸入 owner 或唯讀 token 以開始查詢。</p>
        <form onSubmit={submit}>
          <label htmlFor="access-token">存取 token</label>
          <input
            id="access-token"
            type="password"
            value={entry}
            onChange={(event) => setEntry(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="輸入 token"
            required
            disabled={pending}
          />
          <button
            className="primary connect-button"
            disabled={pending || !entry}
          >
            {pending ? "正在驗證…" : "驗證並連線"}
            <Icon name="arrow" size={18} />
          </button>
        </form>
        {!!(failure || error) && <ErrorNotice error={failure || error} />}
        <div className="token-note">
          <Icon name="lock" size={15} />
          <span>
            Token 僅保留在此分頁的記憶體中。
            <br />
            重新整理或關閉分頁後，需再次輸入。
          </span>
        </div>
      </section>
    </div>
  );
}
function FilterPanel({
  params,
  navigate,
}: {
  params: URLSearchParams;
  navigate: (next: URLSearchParams) => void;
}) {
  const [draft, setDraft] = useState(() => readFilters(params));
  const [fromLocal, setFromLocal] = useState(() =>
    localInput(params.get("from") ?? ""),
  );
  const [toLocal, setToLocal] = useState(() =>
    localInput(params.get("to") ?? ""),
  );
  const [validation, setValidation] = useState("");
  const [custom, setCustom] = useState(params.get("range") === "custom");
  const signature = filterKeys
    .map((key) => params.get(key) ?? "")
    .join("\u0000");
  useEffect(() => {
    const next = readFilters(params);
    setDraft(next);
    setFromLocal(localInput(next.from));
    setToLocal(localInput(next.to));
    setCustom(params.get("range") === "custom");
    setValidation("");
  }, [signature, params.get("range")]);
  const preset = (name: string, hours?: number) => {
    const filters = {
      ...readFilters(params),
      ...(hours ? presetRange(hours) : { from: "", to: "" }),
    };
    navigate(applyFilters(params, filters, name));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setValidation("");
    let filters: Filters;
    try {
      filters = custom
        ? {
            ...draft,
            from: customUTC(fromLocal, draft.from),
            to: customUTC(toLocal, draft.to),
          }
        : draft;
    } catch {
      setValidation("請輸入有效的自訂時間。");
      return;
    }
    if (
      filters.from &&
      filters.to &&
      Date.parse(filters.from) >= Date.parse(filters.to)
    ) {
      setValidation("開始時間必須早於結束時間；結束時間不包含在查詢範圍中。");
      return;
    }
    if (
      filters.type &&
      !/^[a-z0-9]+(?:\.[a-z0-9]+)*(?:\.\*|\*)?$/.test(filters.type)
    ) {
      setValidation(
        "類型需為小寫點分隔字串，僅允許結尾 *，例如 release.deploy.*。",
      );
      return;
    }
    navigate(
      applyFilters(
        params,
        filters,
        custom ? "custom" : (params.get("range") ?? "custom"),
      ),
    );
  };
  const field = (key: keyof Filters, label: string, placeholder: string) => (
    <label>
      {label}
      <input
        value={draft[key]}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
        placeholder={placeholder}
      />
    </label>
  );
  return (
    <section className="filters" aria-label="事件篩選">
      <div className="range-row">
        <span className="range-label">時間範圍</span>
        <div className="segmented">
          {[
            ["1h", 1],
            ["24h", 24],
            ["7d", 168],
            ["30d", 720],
          ].map(([name, hours]) => (
            <button
              key={name}
              type="button"
              className={
                params.get("range") === name && !custom ? "selected" : ""
              }
              onClick={() => preset(String(name), Number(hours))}
            >
              {name}
            </button>
          ))}
          <button
            className={
              params.get("range") === "all" && !custom ? "selected" : ""
            }
            onClick={() => preset("all")}
          >
            全部時間
          </button>
          <button
            className={custom ? "selected" : ""}
            onClick={() => setCustom(true)}
          >
            自訂
          </button>
        </div>
        <span className="range-caption">依事件發生時間 · [開始, 結束)</span>
      </div>
      <form onSubmit={submit}>
        {custom && (
          <div className="custom-range">
            <label>
              開始時間（本機時區）
              <input
                type="datetime-local"
                step="1"
                value={fromLocal}
                onChange={(event) => setFromLocal(event.target.value)}
              />
            </label>
            <label>
              結束時間（本機時區）
              <input
                type="datetime-local"
                step="1"
                value={toLocal}
                onChange={(event) => setToLocal(event.target.value)}
              />
            </label>
            <small>套用時轉換為 UTC；留空可開放單側時間界線。</small>
          </div>
        )}
        <div className="filter-grid">
          {field("source", "來源（精確比對）", "urn:signalhub:release")}
          {field("type", "事件類型", "release.deploy.*")}
          <label>
            最低嚴重度
            <select
              value={draft.severity_min}
              onChange={(event) =>
                setDraft({ ...draft, severity_min: event.target.value })
              }
            >
              <option value="">全部嚴重度</option>
              {severities.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          {field("subject_prefix", "對象前綴", "服務或主機名稱")}
          {field("correlationid", "關聯 ID", "correlationid")}
          <label className="search-field">
            關鍵字搜尋
            <div>
              <Icon name="search" size={17} />
              <input
                value={draft.q}
                onChange={(event) =>
                  setDraft({ ...draft, q: event.target.value })
                }
                placeholder="類型、對象、摘要"
              />
            </div>
          </label>
        </div>
        <div className="filter-footer">
          <span className="exact-range">
            {params.has("from") || params.has("to")
              ? `${params.get("from") || "不限開始"} → ${params.get("to") || "不限結束"}`
              : "全部保留中的事件；不限制時間"}
          </span>
          <div className="filter-actions">
            <button
              type="button"
              className="text-button"
              onClick={() =>
                navigate(
                  applyFilters(
                    params,
                    {
                      ...readFilters(params),
                      source: "",
                      type: "",
                      severity_min: "",
                      subject_prefix: "",
                      correlationid: "",
                      q: "",
                    },
                    params.get("range") ?? "custom",
                  ),
                )
              }
            >
              清除篩選
            </button>
            <button className="primary" type="submit">
              套用篩選
              <Icon name="arrow" size={15} />
            </button>
          </div>
        </div>
        {validation && (
          <p className="field-error" role="alert">
            {validation}
          </p>
        )}
      </form>
    </section>
  );
}
function EventRows({
  items,
  open,
}: {
  items: StoredEvent[];
  open: (seq: number) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="events-table">
        <thead>
          <tr>
            <th>事件時間 / UTC</th>
            <th>嚴重度</th>
            <th>事件 / 摘要</th>
            <th>來源 / 對象</th>
            <th>
              <span className="sr-only">查看詳情</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.seq}>
              <td className="time-cell">
                <span>{formatTime(item.event.time).replace(" UTC", "")}</span>
                <small>
                  #{item.seq}
                  {item.clock_skew && (
                    <span
                      className="skew-mini"
                      title="事件時間超過接收時間 5 分鐘"
                    >
                      {" "}
                      · 時鐘偏差
                    </span>
                  )}
                </small>
              </td>
              <td>
                <Severity value={item.event.severity} />
              </td>
              <td className="event-cell">
                <button className="event-link" onClick={() => open(item.seq)}>
                  {item.event.type}
                </button>
                <p>{item.event.summary || "未提供摘要"}</p>
              </td>
              <td className="source-cell">
                <span title={item.event.source}>{item.event.source}</span>
                <small>{item.event.subject || "未提供對象"}</small>
              </td>
              <td>
                <button
                  className="icon-button row-arrow"
                  onClick={() => open(item.seq)}
                  aria-label={"查看事件 #" + item.seq}
                >
                  <Icon name="arrow" size={18} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Sources({ page }: { page: ReturnType<typeof usePage<Source>> }) {
  const enabled = page.items.filter((item) => item.expected_interval !== null);
  return (
    <>
      <div className="source-explanation">
        <Icon name="sources" />
        <p>
          以最後接收時間判斷新鮮度。超過預期間隔為<span>延遲</span>，超過兩倍為
          <span>沉默</span>；沒有事件不能代表運作正常。
        </p>
      </div>
      {page.items.length > 0 && !page.error && (
        <div className="source-summary">
          已載入 {page.items.length} 個來源 ·{" "}
          {enabled.filter((item) => item.status === "silent").length} 個沉默 ·{" "}
          {enabled.filter((item) => item.status === "late").length} 個延遲 ·{" "}
          {page.items.filter((item) => item.status === "never").length}{" "}
          個尚未上報
        </div>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>來源新鮮度</h2>
          <span>狀態依接收時間計算</span>
        </div>
        {page.loading ? (
          <Loading />
        ) : (
          <>
            {page.error && (
              <ErrorNotice
                error={page.error}
                retry={page.items.length ? page.loadMore : page.refresh}
              />
            )}
            {page.items.length > 0 ? (
              <div className="source-grid">
                {page.items.map((item) => (
                  <article
                    className={
                      "source-card source-" +
                      (item.expected_interval === null &&
                      item.status !== "never"
                        ? "unchecked"
                        : item.status)
                    }
                    key={item.name}
                  >
                    <div className="source-card-top">
                      <span className="source-glyph">
                        <Icon name="sources" />
                      </span>
                      <span
                        className={
                          "source-status status-" +
                          (item.expected_interval === null &&
                          item.status !== "never"
                            ? "unchecked"
                            : item.status)
                        }
                      >
                        <i />
                        {sourceLabel(item)}
                      </span>
                    </div>
                    <h3>{item.name}</h3>
                    <p className="source-prefix">{item.source_prefix}</p>
                    <dl>
                      <div>
                        <dt>最後接收</dt>
                        <dd>{formatTime(item.last_received_at)}</dd>
                      </div>
                      <div>
                        <dt>最後事件</dt>
                        <dd>{formatTime(item.last_event_time)}</dd>
                      </div>
                      <div>
                        <dt>預期間隔</dt>
                        <dd>{item.expected_interval ?? "未啟用新鮮度檢查"}</dd>
                      </div>
                    </dl>
                    {item.status === "never" && (
                      <p className="source-note">
                        尚未收到事件，無法判定來源健康。
                      </p>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              !page.error && (
                <Empty title="尚無來源資料">
                  沒有已註冊的來源資料可供顯示；這不代表所有來源正常。
                </Empty>
              )
            )}
          </>
        )}
        {!page.loading && page.cursor && (
          <div className="pagination">
            <button onClick={page.loadMore} disabled={page.more}>
              {page.more ? "正在載入…" : "載入更多來源"}
              <Icon name="arrow" size={16} />
            </button>
          </div>
        )}
      </section>
    </>
  );
}
function Detail({
  seq,
  token,
  denied,
  close,
  open,
}: {
  seq: string;
  token: string;
  denied: (error: unknown) => void;
  close: () => void;
  open: (seq: number) => void;
}) {
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], [tabindex="0"]',
          ) ?? [],
        );
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.body.classList.add("detail-open");
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      document.body.classList.remove("detail-open");
      previous?.focus();
    };
  }, [close]);
  useEffect(() => {
    const request = new AbortController();
    setDetail(null);
    setError(null);
    if (!/^[1-9][0-9]*$/.test(seq)) {
      setError(new APIError(400));
      return;
    }
    api<EventDetail>("/v1/events/" + seq, token, request.signal)
      .then((value) => {
        if (!request.signal.aborted) setDetail(value);
      })
      .catch((problem) => {
        if (!request.signal.aborted) {
          denied(problem);
          setError(problem);
        }
      });
    return () => request.abort();
  }, [seq, token, revision, denied]);
  const origin = safeOriginURL(detail?.item.event.originurl);
  return (
    <div
      className="detail-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="detail-panel"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
      >
        <header className="detail-header">
          <div>
            <span className="eyebrow">EVENT DETAIL / #{seq}</span>
            <h2 id="detail-title">事件詳情</h2>
          </div>
          <button
            className="icon-button"
            onClick={close}
            ref={closeRef}
            aria-label="關閉事件詳情"
          >
            <Icon name="close" />
          </button>
        </header>
        {error ? (
          <ErrorNotice
            error={error}
            retry={() => setRevision((value) => value + 1)}
          />
        ) : !detail ? (
          <Loading />
        ) : (
          <div className="detail-content">
            <div className="detail-title-row">
              <Severity value={detail.item.event.severity} />
              <span className="read-only-label">原始事件 · 唯讀</span>
            </div>
            <h3 className="detail-type">{detail.item.event.type}</h3>
            <p className="detail-summary">
              {detail.item.event.summary || "未提供摘要"}
            </p>
            {detail.item.clock_skew && (
              <div className="notice warning">
                <Icon name="warning" />
                <span>
                  時鐘偏差：事件時間比接收時間晚超過 5
                  分鐘。以下保留原始時間，請確認來源時鐘。
                </span>
              </div>
            )}
            <dl className="detail-meta">
              {[
                ["事件時間", detail.item.event.time],
                ["接收時間", detail.item.received_at],
                ["來源", detail.item.event.source],
                ["對象", detail.item.event.subject || "—"],
                ["事件 ID", detail.item.event.id],
                ["關聯 ID", detail.item.event.correlationid || "—"],
                ["直接原因", detail.item.event.causationid || "—"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {detail.item.event.originurl && (
              <div className="origin-row">
                {origin ? (
                  <a href={origin} target="_blank" rel="noopener noreferrer">
                    開啟原系統
                    <Icon name="external" size={15} />
                  </a>
                ) : (
                  <span className="muted">
                    原系統連結已停用：僅支援無帳密的 HTTP(S) URL。
                  </span>
                )}
              </div>
            )}
            <section className="related-section">
              <div className="section-label">
                <h3>關聯鏈</h3>
                <span>依事件時間由早到晚</span>
              </div>
              {detail.related.length ? (
                <ol className="related-list">
                  {sortedRelated(detail.related).map((item) => (
                    <li key={item.seq}>
                      <span className="chain-dot" />
                      <div>
                        <small>
                          {item.event.time} · #{item.seq}
                        </small>
                        <button onClick={() => open(item.seq)}>
                          {item.event.type}
                          <Icon name="arrow" size={15} />
                        </button>
                        <p>
                          {item.event.summary ||
                            item.event.subject ||
                            "未提供摘要"}
                        </p>
                        <div className="relation-tags">
                          {detail.item.event.correlationid &&
                            item.event.correlationid ===
                              detail.item.event.correlationid && (
                              <span>同一關聯 ID</span>
                            )}
                          {detail.item.event.causationid ===
                            item.event.source + "#" + item.event.id && (
                            <span>直接原因</span>
                          )}
                          {item.event.causationid ===
                            detail.item.event.source +
                              "#" +
                              detail.item.event.id && <span>由此事件觸發</span>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="no-related">
                  沒有可查詢的關聯事件；原因事件可能未收到或已封存。
                </p>
              )}
            </section>
            <section>
              <div className="section-label">
                <h3>原始 CloudEvent</h3>
                <span>JSON</span>
              </div>
              <pre className="json-block" tabIndex={0}>
                {JSON.stringify(detail.item.event, null, 2)}
              </pre>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
function App() {
  const [params, navigate] = useURL();
  const [token, setToken] = useState("");
  const [authError, setAuthError] = useState<unknown>(null);
  const view = params.get("view") === "sources" ? "sources" : "timeline";
  const denied = useCallback((error: unknown) => {
    if (
      error instanceof APIError &&
      (error.status === 401 || error.status === 403)
    ) {
      setToken("");
      setAuthError(error);
    }
  }, []);
  const events = usePage<StoredEvent>(
    eventsPath(params),
    view === "timeline" ? token : "",
    denied,
  );
  const sources = usePage<Source>(
    "/v1/sources?limit=100",
    view === "sources" ? token : "",
    denied,
  );
  const page = view === "sources" ? sources : events;
  const setView = (name: string) => {
    const next = new URLSearchParams(params);
    if (name === "sources") next.set("view", name);
    else next.delete("view");
    next.delete("event");
    navigate(next);
  };
  const open = (seq: number) => {
    const next = new URLSearchParams(params);
    next.set("event", String(seq));
    navigate(next);
  };
  const close = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete("event");
    navigate(next);
  }, [params, navigate]);
  const title = view === "sources" ? "來源新鮮度" : "事件時間線";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="/?range=all"
          onClick={(event) => {
            event.preventDefault();
            setView("timeline");
          }}
        >
          <span className="brand-mark">
            <Icon name="signal" size={25} />
          </span>
          <div>
            Signal Hub<small>事件觀測中樞</small>
          </div>
        </a>
        <div className="workspace-label">OBSERVATION</div>
        <nav aria-label="主要導覽">
          <button
            className={view === "timeline" ? "active" : ""}
            onClick={() => setView("timeline")}
          >
            <Icon name="timeline" />
            事件時間線<span>01</span>
          </button>
          <button
            className={view === "sources" ? "active" : ""}
            onClick={() => setView("sources")}
          >
            <Icon name="sources" />
            來源新鮮度<span>02</span>
          </button>
        </nav>
        <div className="sidebar-foot">
          <span className="readonly-tag">
            <Icon name="lock" size={13} />
            唯讀看板
          </span>
          <p>觀察訊號，追溯脈絡。</p>
          <small>Signal Hub / M2</small>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            工作空間<span>/</span>
            <strong>{title}</strong>
          </div>
          <div className="connection">
            <span className={"connection-dot " + (token ? "verified" : "")} />
            {token ? "查詢權限已驗證" : "尚未驗證"}
            {token && (
              <button
                onClick={() => {
                  setToken("");
                  setAuthError(null);
                }}
              >
                清除 token
              </button>
            )}
          </div>
        </header>
        <main>
          {!token ? (
            <Login
              error={authError}
              onConnect={(value) => {
                setAuthError(null);
                setToken(value);
              }}
            />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    {view === "sources" ? "SOURCE FRESHNESS" : "EVENT TIMELINE"}
                  </span>
                  <h1>
                    {title}
                    <span className="heading-dot">.</span>
                  </h1>
                  <p>
                    {view === "sources"
                      ? "確認訊號是否持續抵達，辨別資料延遲與來源沉默。"
                      : "從每一筆事件，追溯跨來源的前因與後果。"}
                  </p>
                </div>
                <div className="refresh-area">
                  <button
                    className="outline-button"
                    onClick={page.refresh}
                    disabled={page.loading || page.more}
                  >
                    <Icon name="refresh" size={16} />
                    重新查詢
                  </button>
                  <small>
                    最後成功查詢：{page.at ? formatTime(page.at) : "尚無"}
                  </small>
                </div>
              </div>
              {view === "timeline" ? (
                <>
                  <FilterPanel params={params} navigate={navigate} />
                  <section className="panel timeline-panel">
                    <div className="panel-heading">
                      <div className="list-heading">
                        <h2>事件紀錄</h2>
                        <span className="count-label">
                          已載入 {events.items.length} 筆
                        </span>
                      </div>
                      <span>依事件時間由新到舊 · 每頁 100 筆</span>
                    </div>
                    {events.loading ? (
                      <Loading />
                    ) : (
                      <>
                        {events.error && (
                          <ErrorNotice
                            error={events.error}
                            retry={
                              events.items.length
                                ? events.loadMore
                                : events.refresh
                            }
                          />
                        )}
                        {events.items.length ? (
                          <EventRows items={events.items} open={open} />
                        ) : (
                          !events.error && (
                            <Empty title="此範圍沒有事件">
                              目前篩選條件下查無事件。請調整時間或篩選；沒有事件不代表一切正常。
                            </Empty>
                          )
                        )}
                      </>
                    )}
                    {!events.loading && events.items.length > 0 && (
                      <div className="pagination">
                        <span>
                          {events.cursor
                            ? "還有更多事件"
                            : "已顯示此查詢的全部事件"}
                        </span>
                        {events.cursor && (
                          <button
                            onClick={events.loadMore}
                            disabled={events.more}
                          >
                            {events.more ? "正在載入…" : "載入更多事件"}
                            <Icon name="arrow" size={16} />
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                  <p className="board-footnote">
                    搜尋比對事件類型、對象與摘要；所有篩選以 AND
                    組合。時間範圍與篩選已保存於網址。
                  </p>
                </>
              ) : (
                <Sources page={sources} />
              )}
            </>
          )}
          <footer className="main-footer">
            <span>Signal Hub</span>
            <span>事件 append-only · 看板唯讀</span>
          </footer>
        </main>
      </div>
      {token && params.get("event") && (
        <Detail
          seq={params.get("event")!}
          token={token}
          denied={denied}
          close={close}
          open={open}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
