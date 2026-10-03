import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import type { Run, RunEvent, Task } from './api';

vi.mock('./events', async (original) => ({
  ...(await original<typeof import('./events')>()),
  readEvents: vi.fn((_id, _cursor, signal: AbortSignal, callback: (event: RunEvent) => void) => {
    callback({
      event_id: 'one-event',
      run_id: 'run-1',
      seq: 1,
      type: 'message.created',
      created_at: '2026-09-21T00:00:00Z',
      payload: { role: 'assistant', content: '<img src=x onerror=alert(1)> is plain text' },
    });
    return new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true }),
    );
  }),
}));

let authenticated: boolean;
let tasks: Task[];
let lastPayload: Record<string, string>;
let lostResponse: boolean;
let keys: string[];
let result: Run['result'];
let cancelEnabled: boolean;
let runState: string;
let cancelKeys: string[];
let cancelLostResponse: boolean;
let retryPayload: Record<string, unknown> | null;
let retryKeys: string[];
let retryAccepted: boolean;
let retryLostResponse: boolean;
let retryStatus: number;
let retryWait: Promise<void> | undefined;
let externalRun: Partial<Run> | null;
let usageConfigured: boolean;
let downloadStatus: number;
let taskQueries: URLSearchParams[];
let paginateTasks: boolean;
const clients: QueryClient[] = [];
beforeEach(() => {
  window.history.replaceState(null, '', '/');
  authenticated = false;
  tasks = [];
  lastPayload = {};
  lostResponse = false;
  keys = [];
  result = null;
  cancelEnabled = false;
  runState = 'queued';
  cancelKeys = [];
  cancelLostResponse = false;
  retryPayload = null;
  retryKeys = [];
  retryAccepted = false;
  retryLostResponse = false;
  retryStatus = 202;
  retryWait = undefined;
  externalRun = null;
  usageConfigured = false;
  downloadStatus = 200;
  taskQueries = [];
  paginateTasks = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, options: RequestInit = {}) => {
      const path = input.split('?')[0];
      const method = options.method ?? 'GET';
      if (path === '/api/v1/session') {
        if (method === 'POST') authenticated = true;
        if (method === 'DELETE') {
          authenticated = false;
          return new Response(null, { status: 204 });
        }
        return Response.json({
          authenticated,
          username: authenticated ? 'operator' : null,
          csrf_token: 'csrf-from-server',
        });
      }
      if (path === '/api/v1/projects')
        return Response.json({
          items: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              name: 'Newclear',
              canonical_repo: 'https://github.com/fallrising/newclear',
            },
          ],
        });
      if (path === '/api/v1/agent-profiles')
        return Response.json({
          items: [
            {
              id: 'profile-1',
              profile_id: 'profile-root',
              name: 'M1 fixture',
              revision: 1,
              backend: 'fake',
            },
          ],
        });
      if (path === '/api/v1/runtime')
        return Response.json({
          execution_mode: 'fake',
          slots: 4,
          occupied: 0,
          queued: tasks.length,
          interrupted: 0,
        });
      if (path === '/api/v1/tasks' && method === 'POST') {
        keys.push((options.headers as Record<string, string>)['Idempotency-Key']);
        lastPayload = JSON.parse(String(options.body));
        tasks = [
          {
            id: 'task-1',
            title: lastPayload.title,
            project_name: 'Newclear',
            state: 'queued',
            run_id: 'run-1',
            created_at: '2026-09-21T00:00:00Z',
          },
        ];
        if (lostResponse && keys.length === 1) throw new TypeError('lost response');
        return Response.json({ task: tasks[0] }, { status: 202 });
      }
      if (path === '/api/v1/tasks') {
        const query = new URL(input, 'http://localhost').searchParams;
        taskQueries.push(query);
        const items = query.get('q') === 'no matches' ? [] : tasks;
        return Response.json({
          items,
          next_cursor: paginateTasks && !query.has('cursor') ? 'page-two' : null,
        });
      }
      if (path === '/api/v1/runs/run-1/actions' && method === 'POST') {
        cancelKeys.push((options.headers as Record<string, string>)['Idempotency-Key']);
        expect(JSON.parse(String(options.body))).toEqual({
          action: 'cancel',
          expected_state_version: 1,
        });
        if (cancelLostResponse && cancelKeys.length === 1)
          throw new TypeError('lost cancel response');
        runState = 'cancelling';
        return Response.json({ command_id: 'cancel-command', status: 'pending' }, { status: 202 });
      }
      if (path === '/api/v1/tasks/missing')
        return Response.json({ error: 'not_found' }, { status: 404 });
      if (path === '/api/v1/tasks/task-1/runs' && method === 'POST') {
        retryPayload = JSON.parse(String(options.body));
        retryKeys.push((options.headers as Record<string, string>)['Idempotency-Key']);
        if (retryWait) await retryWait;
        if (retryLostResponse && retryKeys.length === 1) throw new TypeError('lost retry response');
        if (retryStatus !== 202)
          return Response.json({ error: 'state_conflict' }, { status: retryStatus });
        retryAccepted = true;
        return Response.json({ id: 'run-2' }, { status: 202 });
      }
      if (/^\/api\/v1\/runs\/[^/]+\/usage$/.test(path))
        return Response.json(
          usageConfigured
            ? {
                configured: true,
                guest_connected: true,
                request_limit: 10,
                request_slots_consumed: 2,
                uncertain_requests: 0,
                cost_status: 'unknown',
                amount_decimal: null,
                hard_money_limit_supported: false,
                published_price_preview: false,
                quote_committed_usd: null,
                quote_uncertain: null,
                fixture_credit_limit_supported: false,
                fixture_credits_committed_microcredits: null,
                fixture_credits_uncertain: null,
              }
            : {
                configured: false,
                guest_connected: false,
                request_limit: null,
                request_slots_consumed: 0,
                uncertain_requests: 0,
                cost_status: 'unknown',
                amount_decimal: null,
                hard_money_limit_supported: false,
                published_price_preview: false,
                quote_committed_usd: null,
                quote_uncertain: null,
                fixture_credit_limit_supported: false,
                fixture_credits_committed_microcredits: null,
                fixture_credits_uncertain: null,
              },
        );
      if (path === '/api/v1/runs/run-1/result.diff') {
        expect(options.credentials).toBe('same-origin');
        return downloadStatus === 200
          ? new Response(result?.diff ?? '', { headers: { 'Content-Type': 'text/plain' } })
          : Response.json({ error: 'result_diff_invalid' }, { status: downloadStatus });
      }
      if (path === '/api/v1/tasks/task-1') {
        const run: Run = {
          id: 'run-1',
          task_id: 'task-1',
          attempt_no: 1,
          profile_revision: 'profile-1',
          state: runState,
          capabilities: { cancel: cancelEnabled },
          state_version: 1,
          base_sha: lastPayload.base_sha,
          goal: lastPayload.goal,
          cleanup_state: 'not_allocated',
          last_event_seq: 1,
          event_floor: 1,
          result,
        };
        const runs = externalRun
          ? [{ ...run, ...externalRun }, run]
          : retryAccepted
            ? [
                {
                  ...run,
                  id: 'run-2',
                  attempt_no: 2,
                  state: 'queued',
                  result: null,
                  goal: retryPayload!.goal,
                },
                run,
              ]
            : [run];
        return Response.json({ task: tasks[0], runs });
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    }),
  );
});
afterEach(() => {
  clients.forEach((c) => c.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
});
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}
async function login(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: 'Operator 登入' });
  await user.type(screen.getByLabelText('帳號'), 'operator');
  await user.type(screen.getByLabelText('密碼'), 'a-private-password');
  await user.click(screen.getByRole('button', { name: '登入工作台' }));
  await screen.findByRole('heading', { name: '任務與進度' });
}
async function fillTask(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '＋ 建立任務' }));
  await user.type(await screen.findByLabelText('任務名稱'), 'Verify login');
  await user.type(screen.getByLabelText('工作目標'), 'Add a regression check');
  await user.type(
    screen.getByLabelText('Base commit SHA'),
    '7bb80d00d03d93a2d392185adba65588c5fe2462',
  );
  await user.click(screen.getByRole('button', { name: '加入執行佇列' }));
}
it('logs in, creates a task, renders untrusted events as text, then clears the workspace on logout', async () => {
  const user = userEvent.setup();
  mount();
  await login(user);
  await fillTask(user);
  await screen.findByRole('heading', { name: 'Verify login' });
  expect(lastPayload.goal).toBe('Add a regression check');
  expect(await screen.findByText('<img src=x onerror=alert(1)> is plain text')).toBeVisible();
  expect(document.querySelector('img')).toBeNull();
  await user.click(screen.getByRole('button', { name: '登出' }));
  await screen.findByRole('heading', { name: 'Operator 登入' });
  expect(screen.queryByText('Verify login')).toBeNull();
});
it('keeps form data and the idempotency key when retrying an ambiguous create', async () => {
  lostResponse = true;
  const user = userEvent.setup();
  mount();
  await login(user);
  await fillTask(user);
  await screen.findByRole('alert');
  expect(screen.getByLabelText('工作目標')).toHaveValue('Add a regression check');
  await user.click(screen.getByRole('button', { name: '重試建立任務' }));
  await screen.findByRole('heading', { name: 'Verify login' });
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});
it('shows a recoverable service state when the session endpoint is unavailable', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ error: 'database_unavailable' }, { status: 503 })),
  );
  mount();
  await screen.findByRole('heading', { name: '暫時無法開啟工作台' });
  await waitFor(() => expect(screen.getByRole('button', { name: '重新連線' })).toBeEnabled());
});

it('renders a saved real VM diff as text and keeps unsupported controls disabled', async () => {
  result = {
    summary: 'Fixed VM fixture completed',
    verification: { status: 'passed', reason: 'fixture only' },
    diff: '+<img src=x onerror=alert(1)>',
    diff_sha256: 'a'.repeat(64),
  };
  const user = userEvent.setup();
  mount();
  await login(user);
  await fillTask(user);
  expect(await screen.findByLabelText('檔案差異')).toHaveTextContent(
    '+<img src=x onerror=alert(1)>',
  );
  expect(document.querySelector('img')).toBeNull();
  for (const name of ['暫停', '繼續', '取消', '審批'])
    expect(screen.getByRole('button', { name })).toBeDisabled();
  expect(screen.getByText(/Profile 設定的驗證通過/)).toBeVisible();
});

it('labels a saved local-mock card and shows its diff', async () => {
  result = {
    execution_mode: 'local-mock',
    summary: '本機 mock 已寫入工作檔與驗收檔。沒有付費 API，也沒有虛擬機。',
    diff: 'diff --git a/note.txt b/note.txt\n+hello\n',
    diff_sha256: 'abc123',
    verification: {
      status: 'passed',
      name: 'm2_fixture_workspace_assertion',
      reason: 'Local mock rehearsal',
    },
  };
  runState = 'succeeded';
  const user = userEvent.setup();
  mount();
  await login(user);
  await fillTask(user);
  expect(await screen.findByText('本機 mock · 未開虛擬機 · 不需要 API key')).toBeInTheDocument();
  expect(screen.getByLabelText('檔案差異')).toHaveTextContent('+hello');
  expect(screen.getByText('SHA-256: abc123')).toBeInTheDocument();
  expect(screen.getByText(/固定檔案修改驗收通過/)).toBeInTheDocument();
});

it('shows model usage without presenting an unknown amount as a bill', async () => {
  usageConfigured = true;
  const user = userEvent.setup();
  mount();
  await login(user);
  await fillTask(user);
  const usage = await screen.findByRole('region', { name: '模型用量' });
  expect(usage).toHaveTextContent('2 / 10');
  expect(usage).toHaveTextContent('未知，不是帳單');
  expect(usage).not.toHaveTextContent('$');
});

it('submits cancellation and keeps pending stop distinct from cancelled', async () => {
  cancelEnabled = true;
  const user = userEvent.setup();
  mount();
  await login(user);
  await fillTask(user);
  await user.click(await screen.findByRole('button', { name: '取消' }));
  expect(await screen.findByText(/正在確認執行環境已停止/)).toBeVisible();
  expect(
    within(screen.getByRole('region', { name: '任務工作台' })).queryByText('已取消'),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  expect(cancelKeys).toHaveLength(1);
});

it('retries a lost cancel response with the same command key', async () => {
  cancelEnabled = true;
  cancelLostResponse = true;
  const user = userEvent.setup();
  mount();
  await login(user);
  await fillTask(user);
  await user.click(await screen.findByRole('button', { name: '取消' }));
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: '取消' }));
  expect(await screen.findByText(/正在確認執行環境已停止/)).toBeVisible();
  expect(cancelKeys).toHaveLength(2);
  expect(cancelKeys[0]).toBe(cancelKeys[1]);
});

it('re-runs a finished task with the latest attempt inputs', async () => {
  runState = 'failed';
  const user = userEvent.setup();
  mount();
  await login(user);
  await fillTask(user);
  await user.click(await screen.findByRole('button', { name: '重新執行' }));
  await waitFor(() =>
    expect(retryPayload).toEqual({
      goal: 'Add a regression check',
      base_sha: '7bb80d00d03d93a2d392185adba65588c5fe2462',
      profile_revision: 'profile-1',
      expected_state_version: 1,
    }),
  );
  expect(await screen.findByRole('option', { name: /第 2 次/, selected: true })).toBeVisible();
  await waitFor(() => expect(screen.queryByRole('button', { name: '重新執行' })).toBeNull());
});

async function openRetryEditor(user: ReturnType<typeof userEvent.setup>) {
  runState = 'failed';
  mount();
  await login(user);
  await fillTask(user);
  await user.click(await screen.findByRole('button', { name: '調整目標後重新執行' }));
  return screen.getByRole('textbox', { name: '新的工作目標' });
}
async function refreshTask() {
  await act(async () => {
    await clients[0].refetchQueries({ queryKey: ['task', 'task-1'] });
  });
}

it('prefills the retry editor and cancelling never submits a command', async () => {
  const user = userEvent.setup();
  const editor = await openRetryEditor(user);
  expect(editor).toHaveValue('Add a regression check');
  await user.clear(editor);
  await user.type(editor, 'Discard this draft');
  await user.click(screen.getByRole('button', { name: '取消修改' }));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '新的工作目標' })).toBeNull());
  expect(retryKeys).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: '調整目標後重新執行' }));
  expect(screen.getByRole('textbox', { name: '新的工作目標' })).toHaveValue(
    'Add a regression check',
  );
});

it.each(['', ' \n\t ', '😀'.repeat(20001)])(
  'rejects an invalid retry goal before sending a request (%#)',
  async (goal) => {
    const user = userEvent.setup();
    const editor = await openRetryEditor(user);
    fireEvent.change(editor, { target: { value: goal } });
    await user.click(screen.getByRole('button', { name: '以新目標重新執行' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/工作目標|20000/);
    expect(editor).toHaveValue(goal);
    expect(retryKeys).toHaveLength(0);
  },
);

it('preserves raw Unicode and multiline retry input and shows immutable historical goals as text', async () => {
  result = downloadableResult('+original diff');
  const user = userEvent.setup();
  const editor = await openRetryEditor(user);
  const goal = '  新的目標 😀\n<img src=x onerror=alert(1)>\n保留空白  ';
  fireEvent.change(editor, { target: { value: goal } });
  await user.click(screen.getByRole('button', { name: '以新目標重新執行' }));
  await waitFor(() =>
    expect(retryPayload).toEqual({
      goal,
      base_sha: '7bb80d00d03d93a2d392185adba65588c5fe2462',
      profile_revision: 'profile-1',
      expected_state_version: 1,
    }),
  );
  expect(await screen.findByRole('option', { name: /第 2 次/, selected: true })).toBeVisible();
  expect(screen.getByRole('region', { name: '本次工作目標' }).textContent).toContain(goal);
  expect(document.querySelector('img')).toBeNull();
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '新的工作目標' })).toBeNull());
  await user.selectOptions(screen.getByLabelText('執行紀錄'), 'run-1');
  expect(screen.getByRole('region', { name: '本次工作目標' })).toHaveTextContent(
    'Add a regression check',
  );
  expect(screen.getByRole('region', { name: '本次工作目標' })).not.toHaveTextContent('新的目標');
  expect(screen.getByLabelText('檔案差異')).toHaveTextContent('+original diff');
  expect(lastPayload.goal).toBe('Add a regression check');
});

it('accepts 20000 Unicode code points even when they occupy 40000 UTF-16 code units', async () => {
  const user = userEvent.setup();
  const editor = await openRetryEditor(user);
  const goal = '😀'.repeat(20000);
  fireEvent.change(editor, { target: { value: goal } });
  await user.click(screen.getByRole('button', { name: '以新目標重新執行' }));
  await waitFor(() => expect(retryPayload?.goal).toBe(goal));
  expect(await screen.findByRole('option', { name: /第 2 次/, selected: true })).toBeVisible();
});

it('disables editing, cancel, and competing retries while a goal retry is pending', async () => {
  let complete!: () => void;
  retryWait = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const user = userEvent.setup();
  const editor = await openRetryEditor(user);
  const submit = screen.getByRole('button', { name: '以新目標重新執行' });
  const unchanged = screen.getByRole('button', { name: '重新執行' });
  await user.click(submit);
  expect(editor).toBeDisabled();
  expect(submit).toBeDisabled();
  expect(unchanged).toBeDisabled();
  expect(screen.getByRole('button', { name: '取消修改' })).toBeDisabled();
  await user.click(unchanged);
  expect(retryKeys).toHaveLength(1);
  await act(async () => complete());
  expect(await screen.findByRole('option', { name: /第 2 次/, selected: true })).toBeVisible();
});

it('disables the editor opener while an unchanged retry is pending', async () => {
  let complete!: () => void;
  retryWait = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const user = userEvent.setup();
  await openRetryEditor(user);
  await user.click(screen.getByRole('button', { name: '取消修改' }));
  await user.click(screen.getByRole('button', { name: '重新執行' }));
  expect(screen.getByRole('button', { name: '調整目標後重新執行' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '重新執行' })).toBeDisabled();
  await act(async () => complete());
  expect(await screen.findByRole('option', { name: /第 2 次/, selected: true })).toBeVisible();
});

it('retains a retry draft after a lost response and reuses its command key for identical content', async () => {
  retryLostResponse = true;
  const user = userEvent.setup();
  const editor = await openRetryEditor(user);
  fireEvent.change(editor, { target: { value: 'Recover this goal' } });
  await user.click(screen.getByRole('button', { name: '以新目標重新執行' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('重新送出相同內容可安全重試');
  expect(editor).toHaveValue('Recover this goal');
  await refreshTask();
  expect(editor).toHaveValue('Recover this goal');
  await user.click(screen.getByRole('button', { name: '以新目標重新執行' }));
  expect(await screen.findByRole('option', { name: /第 2 次/, selected: true })).toBeVisible();
  expect(retryKeys).toHaveLength(2);
  expect(retryKeys[0]).toBe(retryKeys[1]);
});

it('uses a new command key when the operator changes a rejected retry draft', async () => {
  retryStatus = 409;
  const user = userEvent.setup();
  const editor = await openRetryEditor(user);
  fireEvent.change(editor, { target: { value: 'First goal' } });
  await user.click(screen.getByRole('button', { name: '以新目標重新執行' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('執行狀態已改變');
  expect(editor).toHaveValue('First goal');
  fireEvent.change(editor, { target: { value: 'Revised goal' } });
  retryStatus = 202;
  await user.click(screen.getByRole('button', { name: '以新目標重新執行' }));
  expect(await screen.findByRole('option', { name: /第 2 次/, selected: true })).toBeVisible();
  expect(retryKeys).toHaveLength(2);
  expect(retryKeys[0]).not.toBe(retryKeys[1]);
});

it('keeps draft during same-attempt refresh, starts from latest while viewing history, and resets on a newer attempt', async () => {
  externalRun = {
    id: 'run-2',
    attempt_no: 2,
    goal: 'Latest terminal goal',
    state: 'failed',
    state_version: 7,
  };
  const user = userEvent.setup();
  const editor = await openRetryEditor(user);
  expect(editor).toHaveValue('Latest terminal goal');
  await user.selectOptions(screen.getByLabelText('執行紀錄'), 'run-1');
  expect(screen.getByRole('region', { name: '本次工作目標' })).toHaveTextContent(
    'Add a regression check',
  );
  expect(editor).toHaveValue('Latest terminal goal');
  fireEvent.change(editor, { target: { value: 'In-progress draft' } });
  externalRun = { ...externalRun, state_version: 8, cleanup_state: 'confirmed' };
  await refreshTask();
  expect(editor).toHaveValue('In-progress draft');
  externalRun = {
    id: 'run-3',
    attempt_no: 3,
    goal: 'New latest goal',
    state: 'failed',
    state_version: 9,
    profile_revision: 'profile-3',
    base_sha: 'a'.repeat(40),
  };
  await refreshTask();
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '新的工作目標' })).toBeNull());
  await user.click(screen.getByRole('button', { name: '調整目標後重新執行' }));
  expect(screen.getByRole('textbox', { name: '新的工作目標' })).toHaveValue('New latest goal');
  retryStatus = 409;
  await user.click(screen.getByRole('button', { name: '以新目標重新執行' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('執行狀態已改變');
  expect(retryPayload).toEqual({
    goal: 'New latest goal',
    base_sha: 'a'.repeat(40),
    profile_revision: 'profile-3',
    expected_state_version: 9,
  });
  externalRun = { ...externalRun, id: 'run-4', attempt_no: 4, state: 'queued' };
  await refreshTask();
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '新的工作目標' })).toBeNull());
  await waitFor(() => expect(screen.queryByRole('button', { name: '重新執行' })).toBeNull());
});

it('explains a missing task link and returns to the list', async () => {
  window.location.hash = 'missing';
  const user = userEvent.setup();
  mount();
  await login(user);
  expect(await screen.findByText(/找不到這個任務/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: '返回任務列表' }));
  expect(await screen.findByRole('heading', { name: '選擇一個任務' })).toBeVisible();
  expect(window.location.hash).toBe('');
});

it('switches back to the task view when a task link is opened elsewhere', async () => {
  const user = userEvent.setup();
  mount();
  await login(user);
  await user.click(screen.getByRole('button', { name: '專案' }));
  await screen.findByRole('heading', { name: '專案', level: 1 });
  window.location.hash = 'missing';
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  expect(await screen.findByRole('heading', { name: '任務與進度' })).toBeVisible();
});

it('offers tool approval only for a backend that supports it', async () => {
  const user = userEvent.setup();
  mount();
  await login(user);
  await user.click(screen.getByRole('button', { name: 'Agent 設定' }));
  expect(await screen.findByLabelText(/工具審批/)).toBeDisabled();
  expect(screen.getByText('模擬環境不支援工具審批。')).toBeVisible();
});

function downloadableResult(diff = '') {
  return {
    summary: 'Saved diff',
    verification: { status: 'unknown', reason: 'inspectable' },
    base_sha: '7bb80d00d03d93a2d392185adba65588c5fe2462',
    diff,
    diff_bytes: new TextEncoder().encode(diff).length,
    diff_sha256: 'a'.repeat(64),
  };
}
it('downloads an empty saved diff and releases its object URL', async () => {
  result = downloadableResult();
  const create = vi.fn(() => 'blob:fixture');
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const user = userEvent.setup();
  mount();
  await login(user);
  await fillTask(user);
  await user.click(await screen.findByRole('button', { name: '下載 diff' }));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(click).toHaveBeenCalledOnce();
  await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:fixture'), { timeout: 2000 });
  click.mockRestore();
});
it('shows rejected downloads without creating a file', async () => {
  result = downloadableResult('+你好');
  downloadStatus = 409;
  const create = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
    },
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const user = userEvent.setup();
  mount();
  await login(user);
  await fillTask(user);
  await user.click(await screen.findByRole('button', { name: '下載 diff' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('下載失敗');
  expect(create).not.toHaveBeenCalled();
  expect(click).not.toHaveBeenCalled();
  click.mockRestore();
});
it.each([
  { diff_bytes: -1 },
  { diff_bytes: true },
  { diff_bytes: 262145 },
  { diff_bytes: 1 },
  { diff_sha256: 'invalid' },
  { base_sha: 'b'.repeat(40) },
])('hides download for invalid metadata %j', async (invalid) => {
  result = { ...downloadableResult(), ...invalid } as Run['result'];
  const user = userEvent.setup();
  mount();
  await login(user);
  await fillTask(user);
  await screen.findByRole('heading', { name: '執行結果' });
  expect(screen.queryByRole('button', { name: '下載 diff' })).toBeNull();
});

it('submits a literal search, combines project/state filters, and clears them', async () => {
  const user = userEvent.setup();
  mount();
  await login(user);
  const search = await screen.findByRole('searchbox', { name: '搜尋任務' });
  const count = taskQueries.length;
  await user.type(search, '  你好 %_\\  ');
  expect(taskQueries).toHaveLength(count);
  await user.click(screen.getByRole('button', { name: '搜尋' }));
  await waitFor(() => expect(taskQueries.at(-1)?.get('q')).toBe('你好 %_\\'));
  await user.selectOptions(
    screen.getByLabelText('篩選專案'),
    '11111111-1111-4111-8111-111111111111',
  );
  await user.selectOptions(screen.getByLabelText('篩選狀態'), 'failed');
  await waitFor(() => {
    expect(taskQueries.at(-1)?.get('project_id')).toBe('11111111-1111-4111-8111-111111111111');
    expect(taskQueries.at(-1)?.get('state')).toBe('failed');
    expect(taskQueries.at(-1)?.get('q')).toBe('你好 %_\\');
  });
  await user.click(screen.getByRole('button', { name: '清除篩選' }));
  await waitFor(() => expect([...taskQueries.at(-1)!.keys()]).toEqual([]));
  expect(search).toHaveValue('');
  expect(screen.getByLabelText('篩選專案')).toHaveValue('');
  expect(screen.getByLabelText('篩選狀態')).toHaveValue('');
});
it('keeps filters while paging and resets the cursor when filters change', async () => {
  paginateTasks = true;
  const user = userEvent.setup();
  mount();
  await login(user);
  await user.type(await screen.findByRole('searchbox', { name: '搜尋任務' }), 'history');
  await user.click(screen.getByRole('button', { name: '搜尋' }));
  await waitFor(() => expect(taskQueries.at(-1)?.get('q')).toBe('history'));
  await user.click(screen.getByRole('button', { name: '較早的任務 →' }));
  await waitFor(() => {
    expect(taskQueries.at(-1)?.get('cursor')).toBe('page-two');
    expect(taskQueries.at(-1)?.get('q')).toBe('history');
  });
  await user.selectOptions(screen.getByLabelText('篩選狀態'), 'awaiting_approval');
  await waitFor(() => {
    expect(taskQueries.at(-1)?.get('state')).toBe('awaiting_approval');
    expect(taskQueries.at(-1)?.has('cursor')).toBe(false);
  });
  expect(screen.queryByText(/第 2 頁/)).toBeNull();
});
it('explains empty filtered results and provides a clear action', async () => {
  const user = userEvent.setup();
  mount();
  await login(user);
  await user.type(await screen.findByRole('searchbox', { name: '搜尋任務' }), 'no matches');
  await user.click(screen.getByRole('button', { name: '搜尋' }));
  expect(await screen.findByText('沒有符合篩選條件的任務。')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '清除篩選' }));
  expect(await screen.findByText(/還沒有任務/)).toBeVisible();
});

it('restores valid filter links after login without rewriting the URL', async () => {
  const query = new URLSearchParams({
    q: '  你好 %_\\ 😀  ',
    project_id: 'ABCDEFAB-1234-4234-8234-ABCDEFABCDEF',
    state: 'failed',
    view: 'keep',
  });
  window.history.replaceState(null, '', `/?${query}#missing`);
  const original = window.location.href;
  const user = userEvent.setup();
  mount();
  await login(user);
  await waitFor(() => expect(taskQueries.at(-1)?.get('q')).toBe('你好 %_\\ 😀'));
  expect(taskQueries.at(-1)?.get('project_id')).toBe('abcdefab-1234-4234-8234-abcdefabcdef');
  expect(taskQueries.at(-1)?.get('state')).toBe('failed');
  expect(screen.getByRole('searchbox', { name: '搜尋任務' })).toHaveValue('你好 %_\\ 😀');
  expect(screen.getByLabelText('篩選專案')).toHaveValue('abcdefab-1234-4234-8234-abcdefabcdef');
  expect(screen.getByRole('option', { selected: true, name: /專案名稱無法取得/ })).toBeVisible();
  expect(window.location.href).toBe(original);
  await user.click(screen.getByRole('button', { name: '專案' }));
  await user.click(screen.getByRole('button', { name: '任務' }));
  expect(await screen.findByRole('searchbox', { name: '搜尋任務' })).toHaveValue('你好 %_\\ 😀');
  expect(window.location.hash).toBe('#missing');
});

it('keeps hash and unrelated parameters while pushing only changed normalized filters', async () => {
  window.history.replaceState(null, '', '/?view=keep&view=second#missing');
  const push = vi.spyOn(window.history, 'pushState');
  const user = userEvent.setup();
  mount();
  await login(user);
  const input = screen.getByRole('searchbox', { name: '搜尋任務' });
  await user.type(input, '  history  ');
  expect(push).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '搜尋' }));
  expect(push).toHaveBeenCalledTimes(1);
  expect(new URLSearchParams(window.location.search).get('q')).toBe('history');
  expect(window.location.hash).toBe('#missing');
  await user.click(screen.getByRole('button', { name: '搜尋' }));
  expect(push).toHaveBeenCalledTimes(1);
  await user.selectOptions(screen.getByLabelText('篩選狀態'), 'failed');
  expect(push).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole('button', { name: '清除篩選' }));
  expect(push).toHaveBeenCalledTimes(3);
  expect([...new URLSearchParams(window.location.search)]).toEqual([
    ['view', 'keep'],
    ['view', 'second'],
  ]);
  expect(window.location.hash).toBe('#missing');
  push.mockRestore();
});

it('restores filters and resets pagination on back or forward navigation', async () => {
  window.history.replaceState(null, '', '/?q=first&state=running&cursor=untrusted');
  paginateTasks = true;
  const user = userEvent.setup();
  mount();
  await login(user);
  await user.click(screen.getByRole('button', { name: '較早的任務 →' }));
  await waitFor(() => expect(taskQueries.at(-1)?.get('cursor')).toBe('page-two'));
  await user.type(screen.getByRole('searchbox', { name: '搜尋任務' }), 'draft');
  for (const state of ['failed', 'running']) {
    act(() => {
      window.history.replaceState(null, '', `/?q=restored&state=${state}&cursor=untrusted`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => {
      expect(screen.getByRole('searchbox', { name: '搜尋任務' })).toHaveValue('restored');
      expect(screen.getByLabelText('篩選狀態')).toHaveValue(state);
      expect(taskQueries.at(-1)?.get('state')).toBe(state);
      expect(taskQueries.at(-1)?.has('cursor')).toBe(false);
    });
    expect(screen.queryByText(/第 2 頁/)).toBeNull();
  }
});

it('rejects an invalid link before API calls and clears only its owned filters', async () => {
  window.history.replaceState(null, '', '/?q=one&q=two&state=failed&view=keep#missing');
  const user = userEvent.setup();
  mount();
  await login(user);
  expect(
    await within(screen.getByRole('complementary', { name: '任務列表' })).findByRole('alert'),
  ).toHaveTextContent('連結中的篩選條件無效');
  expect(taskQueries.length).toBeGreaterThan(0);
  expect(taskQueries.every((query) => query.size === 0)).toBe(true);
  expect(screen.getByRole('searchbox', { name: '搜尋任務' })).toHaveValue('');
  await user.click(screen.getByRole('button', { name: '清除篩選' }));
  expect(
    within(screen.getByRole('complementary', { name: '任務列表' })).queryByRole('alert'),
  ).toBeNull();
  expect(window.location.search).toBe('?view=keep');
  expect(window.location.hash).toBe('#missing');
});
