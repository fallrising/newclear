import { RunControls } from './RunControls';
import { Approvals } from './Approvals';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  PendingCommand,
  errorText,
  request,
  session,
  setCsrf,
  type Profile,
  type Project,
  type Run,
  type RunEvent,
  type Runtime,
  type Session,
  type Task,
  type TaskDetail,
} from './api';
import { mergeEvents, readEvents } from './events';

const stateNames: Record<string, string> = {
  queued: '排隊中',
  provisioning: '準備環境',
  running: '執行中',
  finalizing: '保存結果',
  succeeded: '已完成',
  failed: '失敗',
  interrupted: '需要處理',
  paused: '已暫停',
  resuming: '正在恢復',
  cancelled: '已取消',
  cancelling: '正在取消',
  awaiting_approval: '等待審批',
};
function State({ state }: { state: string }) {
  return <span className={`state state-${state}`}>{stateNames[state] ?? state}</span>;
}
function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <p className="error" role="alert">
      {errorText(error)}
    </p>
  ) : null;
}
function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
function timestamp(value: string) {
  return new Date(value).toLocaleString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function App() {
  const cache = useQueryClient();
  const current = useQuery({ queryKey: ['session'], queryFn: session, refetchInterval: 60_000 });
  if (current.isPending)
    return (
      <main className="startup" role="status">
        正在開啟工作台…
      </main>
    );
  if (current.isError)
    return (
      <main className="startup">
        <h1>暫時無法開啟工作台</h1>
        <ErrorNotice error={current.error} />
        <button onClick={() => void current.refetch()}>重新連線</button>
      </main>
    );
  return current.data.authenticated ? (
    <Workspace
      username={current.data.username!}
      onLogout={async () => {
        await cache.cancelQueries({ queryKey: ['session'] });
        cache.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
        cache.setQueryData(['session'], { authenticated: false, username: null, csrf_token: '' });
        void cache.invalidateQueries({ queryKey: ['session'] });
      }}
    />
  ) : (
    <Login />
  );
}
function Login() {
  const cache = useQueryClient();
  const login = useMutation({
    mutationFn: (data: { username: string; password: string }) =>
      request<Session>('/session', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: async (value) => {
      await cache.cancelQueries({ queryKey: ['session'] });
      setCsrf(value.csrf_token);
      cache.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      cache.setQueryData(['session'], value);
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    login.mutate({
      username: String(data.get('username')),
      password: String(data.get('password')),
    });
  }
  return (
    <main className="login-shell">
      <div className="login-brand">
        <span className="wordmark">Agent Platform</span>
        <h1>你的任務工作台</h1>
        <p>登入以建立任務、追蹤執行進度與查看活動紀錄。</p>
      </div>
      <section className="login-card">
        <h2>Operator 登入</h2>
        <form onSubmit={submit}>
          <label>
            帳號
            <input name="username" required autoComplete="username" maxLength={120} />
          </label>
          <label>
            密碼
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              maxLength={1024}
            />
          </label>
          <ErrorNotice error={login.error} />
          <button type="submit" disabled={login.isPending}>
            {login.isPending ? '登入中…' : '登入工作台'}
          </button>
        </form>
        <p className="muted">使用管理員建立的帳號登入。</p>
      </section>
    </main>
  );
}
function Workspace({ username, onLogout }: { username: string; onLogout: () => void }) {
  const cache = useQueryClient();
  const [view, setView] = useState<'tasks' | 'projects' | 'profiles'>('tasks');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(() => window.location.hash.slice(1));
  const runtime = useQuery({
    queryKey: ['runtime'],
    queryFn: () => request<Runtime>('/runtime'),
    refetchInterval: 5000,
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => request<{ items: Project[] }>('/projects'),
  });
  const profiles = useQuery({
    queryKey: ['profiles'],
    queryFn: () => request<{ items: Profile[] }>('/agent-profiles'),
  });
  const logout = useMutation({
    mutationFn: () => request('/session', { method: 'DELETE' }),
    onSuccess: onLogout,
  });
  useEffect(() => {
    const update = () => setSelected(window.location.hash.slice(1));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    if (
      [runtime.error, projects.error, profiles.error].some(
        (error) => error instanceof ApiError && error.status === 401,
      )
    )
      void cache.invalidateQueries({ queryKey: ['session'] });
  }, [runtime.error, projects.error, profiles.error, cache]);
  function choose(id: string) {
    window.location.hash = id;
    setSelected(id);
    setCreating(false);
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          href="#"
          className="wordmark"
          onClick={() => {
            setView('tasks');
            setSelected('');
          }}
        >
          Agent Platform
        </a>
        <nav aria-label="主要導覽">
          {(
            [
              ['tasks', '任務'],
              ['projects', '專案'],
              ['profiles', 'Agent 設定'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={view === id ? 'nav active' : 'nav'}
              aria-current={view === id ? 'page' : undefined}
              onClick={() => {
                setView(id);
                setCreating(false);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="account">
          <span>{username}</span>
          <button className="quiet" onClick={() => logout.mutate()} disabled={logout.isPending}>
            登出
          </button>
        </div>
      </header>
      <main className="workspace">
        <div className="page-title">
          <div>
            <p className="eyebrow">工作台</p>
            <h1>{view === 'tasks' ? '任務與進度' : view === 'projects' ? '專案' : 'Agent 設定'}</h1>
          </div>
          <div className="runtime">
            <span className="fixture">
              {runtime.data?.execution_mode === 'mixed' ? '真實 VM · 模擬模型' : '模擬執行環境'}
            </span>
            <span>
              {runtime.data
                ? `${runtime.data.occupied} / ${runtime.data.slots} 執行中 · ${runtime.data.queued} 排隊`
                : '容量暫時無法讀取'}
            </span>
          </div>
        </div>
        <ErrorNotice error={logout.error || projects.error || profiles.error || runtime.error} />
        {runtime.data?.interrupted ? (
          <p className="notice" role="status">
            有 {runtime.data.interrupted} 個執行需要處理，已保留其環境容量。
          </p>
        ) : null}
        {view === 'tasks' ? (
          <>
            <div className="section-bar">
              <p className="muted">建立任務後，即使關閉分頁也會保留進度。</p>
              <button onClick={() => setCreating(!creating)} aria-expanded={creating}>
                {creating ? '關閉表單' : '＋ 建立任務'}
              </button>
            </div>
            {creating && (
              <TaskForm
                projects={projects.data?.items ?? []}
                profiles={profiles.data?.items ?? []}
                onCreated={choose}
              />
            )}
            <div className="workbench">
              <TaskList selected={selected} onSelect={choose} />
              <section className="detail" aria-label="任務工作台">
                {selected ? (
                  <TaskWorkspace key={selected} taskId={selected} />
                ) : (
                  <Empty>
                    <h2>選擇一個任務</h2>
                    <p>活動、執行狀態與結果會顯示在這裡。</p>
                  </Empty>
                )}
              </section>
            </div>
          </>
        ) : view === 'projects' ? (
          <Catalog key="projects" kind="projects" items={projects.data?.items ?? []} />
        ) : (
          <Catalog
            key="profiles"
            kind="profiles"
            items={profiles.data?.items ?? []}
            backends={runtime.data?.available_backends ?? ['fake']}
          />
        )}
      </main>
    </div>
  );
}
function TaskForm({
  projects,
  profiles,
  onCreated,
}: {
  projects: Project[];
  profiles: Profile[];
  onCreated: (id: string) => void;
}) {
  const cache = useQueryClient();
  const command = useRef(new PendingCommand());
  const create = useMutation({
    mutationFn: (data: unknown) => command.current.send<{ task: Task }>('/tasks', data),
    onSuccess: (result) => {
      void cache.invalidateQueries({ queryKey: ['tasks'] });
      void cache.invalidateQueries({ queryKey: ['runtime'] });
      onCreated(result.task.id);
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    create.mutate(data);
  }
  if (!projects.length || !profiles.length)
    return (
      <div className="form-panel notice">
        請先在「專案」與「Agent 設定」各新增一筆資料，再建立任務。
      </div>
    );
  return (
    <section className="form-panel">
      <h2>建立任務</h2>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            專案
            <select name="project_id" required>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Agent
            <select name="profile_revision" required>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · v{p.revision} · {p.backend === 'openhands' ? '真實 VM' : '模擬環境'}
                  {p.tool_policy?.require_approval ? ' · 工具需審批' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          任務名稱
          <input name="title" required maxLength={200} placeholder="例如：為登入流程補上測試" />
        </label>
        <label>
          工作目標
          <textarea
            name="goal"
            required
            maxLength={20000}
            rows={3}
            placeholder="描述要完成的工作與驗收條件"
          />
        </label>
        <label>
          Base commit SHA
          <input
            name="base_sha"
            required
            pattern="([0-9a-f]{40}|[0-9a-f]{64})"
            className="mono"
            placeholder="貼上固定的完整 commit SHA"
          />
        </label>
        <p className="muted">
          真實 VM 設定使用固定模擬模型，執行檔案修改驗收；任務目標會保存，但不會由真實模型推理。
        </p>
        <ErrorNotice error={create.error} />
        <div className="form-actions">
          <button type="submit" disabled={create.isPending}>
            {create.isPending ? '送出中…' : create.isError ? '重試建立任務' : '加入執行佇列'}
          </button>
        </div>
      </form>
    </section>
  );
}
function TaskList({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const tasks = useQuery({
    queryKey: ['tasks', cursor],
    queryFn: () =>
      request<{ items: Task[]; next_cursor: string | null }>(
        '/tasks' + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''),
      ),
    refetchInterval: 5000,
  });
  return (
    <aside className="task-list" aria-label="任務列表">
      <div className="list-heading">
        <h2>最近任務</h2>
        {cursor && (
          <button className="quiet" onClick={() => setCursor(null)}>
            回到最新
          </button>
        )}
      </div>
      {tasks.isPending ? (
        <Empty>正在載入任務…</Empty>
      ) : tasks.isError ? (
        <>
          <ErrorNotice error={tasks.error} />
          <button className="quiet" onClick={() => void tasks.refetch()}>
            重新載入
          </button>
        </>
      ) : tasks.data.items.length === 0 ? (
        <Empty>
          還沒有任務。
          <br />
          從「建立任務」開始。
        </Empty>
      ) : (
        <ul>
          {tasks.data.items.map((task) => (
            <li key={task.id}>
              <button
                className={`task-row ${selected === task.id ? 'selected' : ''}`}
                onClick={() => onSelect(task.id)}
                aria-pressed={selected === task.id}
              >
                <span className="task-title">{task.title}</span>
                <span className="task-project">{task.project_name}</span>
                <span className="task-meta">
                  <State state={task.state} />
                  <time dateTime={task.created_at}>{timestamp(task.created_at)}</time>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {tasks.data?.next_cursor && (
        <button className="quiet load-more" onClick={() => setCursor(tasks.data.next_cursor)}>
          較早的任務 →
        </button>
      )}
    </aside>
  );
}
function TaskWorkspace({ taskId }: { taskId: string }) {
  const task = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => request<TaskDetail>(`/tasks/${encodeURIComponent(taskId)}`),
    refetchInterval: 5000,
  });
  const [runId, setRunId] = useState('');
  if (task.isPending) return <Empty>正在載入執行紀錄…</Empty>;
  if (task.isError)
    return (
      <div className="detail-body">
        <ErrorNotice error={task.error} />
        <button onClick={() => void task.refetch()}>重新載入</button>
      </div>
    );
  const run = task.data.runs.find((r) => r.id === runId) ?? task.data.runs[0];
  return (
    <>
      <div className="detail-heading">
        <div>
          <span className="muted">{task.data.task.project_name}</span>
          <h2>{task.data.task.title}</h2>
        </div>
        <label className="attempt-label">
          執行紀錄
          <select value={run.id} onChange={(e) => setRunId(e.target.value)}>
            {task.data.runs.map((r) => (
              <option key={r.id} value={r.id}>
                第 {r.attempt_no} 次 · {stateNames[r.state] ?? r.state}
              </option>
            ))}
          </select>
        </label>
      </div>
      <RunActivity key={run.id} run={run} />
    </>
  );
}
function RunActivity({ run }: { run: Run }) {
  const cache = useQueryClient();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [connection, setConnection] = useState('正在連線…');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function connect() {
      try {
        await readEvents(run.id, cursor, controller.signal, (event) => {
          if (controller.signal.aborted) return;
          cursor = Math.max(cursor, event.seq);
          setEvents((old) => mergeEvents(old, event));
          setConnection('紀錄已同步');
          if (event.type.startsWith('run.') || event.type.startsWith('runtime.')) {
            void cache.invalidateQueries({ queryKey: ['task', run.task_id] });
            void cache.invalidateQueries({ queryKey: ['tasks'] });
            void cache.invalidateQueries({ queryKey: ['runtime'] });
          }
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          setConnection('登入已過期');
          void cache.invalidateQueries({ queryKey: ['session'] });
          return;
        }
        if (error instanceof ApiError && [410, 422].includes(error.status)) {
          try {
            const snapshot = await request<Run>(`/runs/${run.id}`);
            if (controller.signal.aborted) return;
            cursor = snapshot.event_floor - 1;
            setEvents([]);
            setNotice('活動保留範圍已更新，已重新載入目前狀態。');
          } catch {
            setConnection('無法重新載入狀態，正在重試…');
          }
        } else if (error instanceof ApiError && error.status === 404) {
          setConnection('找不到執行紀錄');
          return;
        } else setConnection('連線中斷，正在重新連線…');
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void connect(), 1000);
    }
    void connect();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [run.id, run.task_id, cache]);
  return (
    <div className="detail-body">
      <div className="run-summary">
        <State state={run.state} />
        <span className="muted" role="status">
          {connection}
        </span>
      </div>
      <dl className="run-facts">
        <div>
          <dt>Base commit</dt>
          <dd className="mono" title={run.base_sha}>
            {run.base_sha.slice(0, 12)}
          </dd>
        </div>
        <div>
          <dt>環境回收</dt>
          <dd>
            {
              (
                {
                  confirmed: '已確認回收',
                  pending: '等待回收',
                  unknown: '尚待確認',
                  not_allocated: '尚未建立',
                } as Record<string, string>
              )[run.cleanup_state]
            }
          </dd>
        </div>
      </dl>
      <p className="muted">
        {run.execution_mode === 'cocoon-fixture'
          ? 'OpenHands · 獨立 VM · 固定模擬模型'
          : '模擬環境 · 排程驗證'}
      </p>
      <RunControls run={run} />
      {run.require_approval && <Approvals run={run} />}
      {notice && <p className="notice">{notice}</p>}
      <h3>活動紀錄</h3>
      <ol className="timeline">
        {events.map((event) => (
          <li
            key={event.event_id}
            data-event-seq={event.seq}
            className={event.type === 'message.created' ? 'message' : 'activity'}
          >
            <div className="event-meta">
              <strong>
                {event.type === 'message.created'
                  ? event.payload.role === 'user'
                    ? '你'
                    : 'Agent（模擬模型）'
                  : '系統'}
              </strong>
              <time dateTime={event.created_at}>{timestamp(event.created_at)}</time>
            </div>
            <p>
              {event.type === 'message.created'
                ? String(event.payload.content)
                : event.type === 'run.queued'
                  ? '任務已加入佇列。'
                  : event.type === 'run.state_changed'
                    ? `狀態更新：${stateNames[String(event.payload.state)] ?? event.payload.state}`
                    : event.type === 'runtime.cleaned'
                      ? '執行環境已確認回收。'
                      : event.type === 'runtime.cleanup_pending'
                        ? '環境狀態尚待確認，容量已保留。'
                        : event.type === 'run.result_saved'
                          ? '結果已保存。'
                          : event.type === 'run.cancel_requested'
                            ? '已收到取消請求。'
                            : event.type === 'run.cancel_completed'
                              ? '執行環境已停止，取消完成。'
                              : String(event.payload.content ?? event.type)}
            </p>
          </li>
        ))}
      </ol>
      {events.length === 0 && <p className="muted">正在讀取已保存的活動…</p>}
      {run.result && (
        <section className="result">
          <h3>執行結果</h3>
          <p>{run.result.summary}</p>
          <p className="muted">
            驗證：
            {run.result.verification.status === 'passed'
              ? '固定檔案修改驗收通過'
              : run.result.verification.status === 'failed'
                ? '固定檔案修改驗收失敗'
                : '未執行'}
            。專案測試：未設定。
          </p>
          {run.result.diff !== undefined && (
            <>
              <h3>檔案變更</h3>
              <pre className="diff" aria-label="檔案差異">
                {run.result.diff || '沒有檔案變更。'}
              </pre>
              <p className="muted mono">SHA-256: {run.result.diff_sha256}</p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
function Catalog({
  kind,
  items,
  backends = ['fake'],
}: {
  kind: 'projects' | 'profiles';
  items: (Project | Profile)[];
  backends?: string[];
}) {
  const cache = useQueryClient();
  const command = useRef(new PendingCommand());
  const form = useRef<HTMLFormElement>(null);
  const create = useMutation({
    mutationFn: (data: unknown) =>
      command.current.send(kind === 'projects' ? '/projects' : '/agent-profiles', data),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: [kind] });
      form.current?.reset();
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    create.mutate(
      kind === 'profiles' ? { ...data, require_approval: data.require_approval === 'true' } : data,
    );
  }
  return (
    <div className="catalog">
      <section className="catalog-list">
        <h2>{kind === 'projects' ? 'Repository 專案' : 'Agent profiles'}</h2>
        {items.length ? (
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <h3>{item.name}</h3>
                <p className="muted">
                  {'canonical_repo' in item
                    ? item.canonical_repo
                    : `${item.backend === 'openhands' ? 'OpenHands · 真實 VM · 模擬模型' : '模擬 Agent'} · v${item.revision}`}
                  {'tool_policy' in item && item.tool_policy?.require_approval
                    ? ' · 工具需審批'
                    : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>尚未設定。新增後即可用於任務。</Empty>
        )}
      </section>
      <section className="form-panel">
        <h2>{kind === 'projects' ? '新增專案' : '新增 Agent 設定'}</h2>
        <form ref={form} onSubmit={submit}>
          <label>
            名稱
            <input name="name" required maxLength={120} />
          </label>
          {kind === 'projects' ? (
            <label>
              Repository URL
              <input
                name="canonical_repo"
                type="url"
                required
                maxLength={500}
                placeholder="https://github.com/owner/repository"
              />
            </label>
          ) : (
            <>
              <label>
                執行方式
                <select name="backend">
                  {backends.map((backend) => (
                    <option key={backend} value={backend}>
                      {backend === 'openhands'
                        ? 'OpenHands · 真實 VM · 固定模擬模型'
                        : '模擬環境 · 排程驗證'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                工具審批
                <select name="require_approval" defaultValue="false">
                  <option value="false">固定驗收操作自動執行</option>
                  <option value="true">每批工具操作都需核准（OpenHands）</option>
                </select>
              </label>
              <p className="notice">
                真實 VM 只接受管理員已登錄的 repository 與
                commit。固定模型會修改驗收檔案，不會呼叫付費模型。
              </p>
            </>
          )}
          <ErrorNotice error={create.error} />
          <button type="submit" disabled={create.isPending}>
            {create.isPending ? '保存中…' : '保存'}
          </button>
        </form>
      </section>
    </div>
  );
}
