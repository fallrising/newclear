import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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
let usageConfigured: boolean;
const clients: QueryClient[] = [];
beforeEach(() => {
  window.location.hash = '';
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
  usageConfigured = false;
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
              id: 'project-1',
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
      if (path === '/api/v1/tasks') return Response.json({ items: tasks, next_cursor: null });
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
        return Response.json({ id: 'run-2' }, { status: 202 });
      }
      if (path === '/api/v1/runs/run-1/usage')
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
        const runs = retryPayload
          ? [{ ...run, id: 'run-2', attempt_no: 2, state: 'queued', result: null }, run]
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
  expect(screen.queryByText('已取消')).not.toBeInTheDocument();
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
  expect(screen.queryByRole('button', { name: '重新執行' })).toBeNull();
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
