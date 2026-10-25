import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import type { Artifact, ExportOperation, ExportPreview, Run, Task } from './api';

vi.mock('./events', async (original) => ({
  ...(await original<typeof import('./events')>()),
  readEvents: vi.fn(
    (_id: string, _cursor: number, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      }),
  ),
}));

type Phase = 'preview' | 'approval' | 'reconcile';
type Handler = (runId: string) => Promise<Response>;
type Sent = { path: string; method: string; body: string; key: string };
const expiry = '此封存已依保留期限清理；摘要與原始 diff 仍保留。';
const clients: QueryClient[] = [];
const pending: Array<() => void> = [];
let sent: Sent[];
let handlers: Partial<Record<Phase, Handler>>;
let archiveHandler: (runId: string, count: number) => Promise<Response>;
let archiveReads: Record<string, number>;
let authenticated: boolean;
let uncertain: boolean;
let operations: ExportOperation[];

function artifact(runId: string): Artifact {
  return {
    id: `archive-${runId}`,
    run_id: runId,
    kind: 'result',
    sha256: (runId === 'run-a' ? 'a' : 'b').repeat(64),
    size: 321,
    mime: 'application/json',
    created_at: '2026-09-01T00:00:00Z',
    pruned_at: null,
  };
}
function run(runId: string, attempt: number): Run {
  return {
    id: runId,
    task_id: 'task-a',
    attempt_no: attempt,
    profile_revision: 'profile-a',
    state: 'failed',
    state_version: 7,
    base_sha: 'c'.repeat(40),
    goal: `Goal ${runId}`,
    cleanup_state: 'not_allocated',
    last_event_seq: 0,
    event_floor: 1,
    result: {
      summary: `Preserved result ${runId}`,
      diff: `+retained ${runId}`,
      diff_sha256: 'd'.repeat(64),
      diff_bytes: 15,
      base_sha: 'c'.repeat(40),
      verification: { status: 'unknown', reason: 'verification_not_configured' },
    },
  };
}
function preview(runId: string): ExportPreview {
  const item = artifact(runId);
  return {
    run_id: runId,
    artifact_id: item.id,
    artifact_sha256: item.sha256,
    target_repo: 'example/repo',
    base_branch: 'main',
    base_sha: 'c'.repeat(40),
    branch: `agent-platform/${runId}`,
    approval_digest: 'e'.repeat(64),
    verification_status: 'unknown',
    diff: `+retained ${runId}`,
    files: ['note.txt'],
  };
}
function operation(runId: string): ExportOperation {
  return {
    ...preview(runId),
    id: `export-${runId}`,
    state: uncertain ? 'uncertain' : 'queued',
    reason: null,
    pr_url: null,
    created_at: '2026-10-26T00:00:00Z',
  };
}
function available(runId: string) {
  return Response.json({ items: [artifact(runId)] });
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  pending.push(() => resolve(Response.json({ items: [] })));
  return { promise, resolve };
}
function error(status = 410, code = 'artifact_expired') {
  return Response.json({ error: code }, { status });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/#task-a');
  sent = [];
  handlers = {};
  archiveReads = {};
  archiveHandler = async (runId) => available(runId);
  authenticated = true;
  uncertain = false;
  operations = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, options: RequestInit = {}) => {
      const path = input.split('?')[0];
      const method = options.method ?? 'GET';
      sent.push({
        path,
        method,
        body: String(options.body ?? ''),
        key: new Headers(options.headers).get('Idempotency-Key') ?? '',
      });
      if (path === '/api/v1/session')
        return Response.json({
          authenticated,
          username: authenticated ? 'operator' : null,
          csrf_token: 'csrf-test',
        });
      if (path === '/api/v1/runtime')
        return Response.json({
          execution_mode: 'fake',
          slots: 4,
          occupied: 0,
          queued: 0,
          interrupted: 0,
        });
      if (path === '/api/v1/projects' || path === '/api/v1/agent-profiles')
        return Response.json({ items: [] });
      const task: Task = {
        id: 'task-a',
        title: 'Expiry workbench',
        project_name: 'Fixture',
        state: 'failed',
        run_id: 'run-a',
        created_at: '2026-10-26T00:00:00Z',
      };
      if (path === '/api/v1/tasks') return Response.json({ items: [task], next_cursor: null });
      if (path === '/api/v1/tasks/task-a')
        return Response.json({ task, runs: [run('run-a', 2), run('run-b', 1)] });
      if (path.endsWith('/usage')) return Response.json({ configured: false });
      if (path === '/api/v1/export-targets')
        return Response.json({ items: [{ repo: 'example/repo', base_branch: 'main' }] });
      const archive = path.match(/^\/api\/v1\/runs\/([^/]+)\/artifacts$/);
      if (archive) {
        const id = archive[1];
        archiveReads[id] = (archiveReads[id] ?? 0) + 1;
        return archiveHandler(id, archiveReads[id]);
      }
      const exporting = path.match(
        /^\/api\/v1\/runs\/([^/]+)\/exports(?:\/([^/]+)(?:\/reconcile)?)?$/,
      );
      if (exporting) {
        const id = exporting[1];
        if (method === 'GET')
          return Response.json({ items: uncertain ? [operation(id)] : operations });
        const phase: Phase =
          exporting[2] === 'preview'
            ? 'preview'
            : path.endsWith('/reconcile')
              ? 'reconcile'
              : 'approval';
        if (handlers[phase]) return handlers[phase]!(id);
        if (phase === 'preview') return Response.json(preview(id));
        operations = [operation(id)];
        return Response.json(operations[0], { status: 202 });
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  pending.splice(0).forEach((resolve) => resolve());
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});
async function mount() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  client.setQueryData(['artifacts', 'run-a', 1], { items: [artifact('run-a')] });
  client.setQueryData(['artifacts', 'run-b', 9], { items: [artifact('run-b')] });
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
  await screen.findByText('Preserved result run-a');
  await waitFor(() => expect(screen.getByRole('button', { name: '檢視匯出內容' })).toBeEnabled());
  return { client, user: userEvent.setup() };
}
async function perform(user: ReturnType<typeof userEvent.setup>, phase: Phase) {
  if (phase === 'reconcile') {
    await user.click(await screen.findByRole('button', { name: '重新查核 GitHub 結果' }));
    return;
  }
  await user.click(screen.getByRole('button', { name: '檢視匯出內容' }));
  if (phase === 'approval')
    await user.click(await screen.findByRole('button', { name: '授權建立分支與 Draft PR' }));
}
function preserved(runId = 'run-a') {
  const region = screen.getByRole('region', { name: '成果封存' });
  expect(region).toHaveTextContent(artifact(runId).sha256);
  expect(region).toHaveTextContent('321 bytes');
  expect(screen.getByText(`Preserved result ${runId}`)).toBeVisible();
  expect(screen.getByLabelText('檔案差異')).toHaveTextContent(`+retained ${runId}`);
  expect(screen.getByRole('button', { name: /^下載 diff$/ })).toBeEnabled();
}
function expired() {
  expect(screen.getByText(expiry)).toBeVisible();
  expect(screen.queryByRole('button', { name: '下載封存結果' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'GitHub 匯出' })).toBeNull();
  preserved();
}
function posts() {
  return sent.filter((request) => request.method === 'POST');
}

it.each(['preview', 'approval'] as const)(
  '%s exact410 immediately retires archive actions while refresh is pending',
  async (phase) => {
    const refresh = deferred();
    archiveHandler = async (id, count) => (count === 1 ? available(id) : refresh.promise);
    handlers[phase] = async () => error();
    const { client, user } = await mount();
    await perform(user, phase);
    await screen.findByText(expiry);
    expired();
    await waitFor(() => expect(archiveReads['run-a']).toBe(2));
    expect(client.getQueryState(['artifacts', 'run-a', 1])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['artifacts', 'run-b', 9])?.isInvalidated).toBe(false);
    expect(
      client.getQueryData<{ items: Artifact[] }>(['artifacts', 'run-a', 7])?.items[0].pruned_at,
    ).toBeNull();
    expect(posts()).toHaveLength(phase === 'preview' ? 1 : 2);
    expect(sent.some((request) => request.path.endsWith('/artifacts/archive-run-a'))).toBe(false);
  },
);

it('keeps known expiry and metadata through failed refresh, explicit retry and stale available response', async () => {
  archiveHandler = async (id, count) =>
    count === 2 ? error(503, 'database_unavailable') : available(id);
  handlers.approval = async () => error();
  const { client, user } = await mount();
  await perform(user, 'approval');
  await screen.findByText(expiry);
  await screen.findByText('無法載入封存結果。');
  expired();
  await user.click(screen.getByRole('button', { name: '重新載入封存' }));
  await waitFor(() => expect(archiveReads['run-a']).toBe(3));
  await waitFor(() => expect(screen.queryByText('無法載入封存結果。')).toBeNull());
  expired();
  expect(posts()).toHaveLength(2);
  expect(
    client.getQueryData<{ items: Artifact[] }>(['artifacts', 'run-a', 7])?.items[0].pruned_at,
  ).toBeNull();
  archiveHandler = async (id) =>
    id === 'run-a'
      ? Response.json({
          items: [
            {
              ...artifact(id),
              pruned_at: '2026-10-26T00:00:00Z',
            },
          ],
        })
      : available(id);
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['artifacts', 'run-a'] });
  });
  expect(archiveReads['run-a']).toBe(4);
  expired();
  await user.selectOptions(screen.getByLabelText('執行紀錄'), 'run-b');
  await screen.findByText('Preserved result run-b');
  await waitFor(() => expect(screen.getByRole('button', { name: '下載封存結果' })).toBeEnabled());
  expect(screen.queryByText(expiry)).toBeNull();
  preserved('run-b');
});

it.each(['preview', 'approval'] as const)(
  'a delayed run A %s expiry cannot retire selected run B or refresh its archives',
  async (phase) => {
    const response = deferred();
    handlers[phase] = async () => response.promise;
    const { client, user } = await mount();
    await perform(user, phase);
    await user.selectOptions(screen.getByLabelText('執行紀錄'), 'run-b');
    await screen.findByText('Preserved result run-b');
    await waitFor(() => expect(archiveReads['run-b']).toBe(1));
    await act(async () => {
      response.resolve(error());
    });
    await waitFor(() =>
      expect(client.getQueryState(['artifacts', 'run-a', 1])?.isInvalidated).toBe(true),
    );
    expect(client.getQueryState(['artifacts', 'run-b', 9])?.isInvalidated).toBe(false);
    expect(archiveReads['run-b']).toBe(1);
    expect(screen.queryByText(expiry)).toBeNull();
    expect(screen.getByRole('button', { name: '下載封存結果' })).toBeEnabled();
    preserved('run-b');
  },
);

it.each(['preview', 'approval', 'reconcile'] as const)(
  '%s401 refreshes the real App session without reclassifying archive availability',
  async (phase) => {
    uncertain = phase === 'reconcile';
    handlers[phase] = async () => {
      authenticated = false;
      return error(401, 'authentication_required');
    };
    const { client, user } = await mount();
    await perform(user, phase);
    expect(await screen.findByRole('heading', { name: 'Operator 登入' })).toBeVisible();
    expect(sent.filter((request) => request.path === '/api/v1/session')).toHaveLength(2);
    expect(archiveReads['run-a']).toBe(1);
    expect(
      client.getQueryData<{ items: Artifact[] }>(['artifacts', 'run-a', 7])?.items[0].pruned_at,
    ).toBeNull();
    expect(screen.queryByText(expiry)).toBeNull();
  },
);

const otherErrors = [
  { label: 'other410', status: 410, code: 'artifact_invalid' },
  { label: '409with-expiry-code', status: 409, code: 'artifact_expired' },
  { label: '503with-expiry-code', status: 503, code: 'artifact_expired' },
  { label: 'network-loss', status: 0, code: '' },
];
for (const phase of ['preview', 'approval'] as const) {
  it.each(otherErrors)(
    `${phase} $label leaves valid archive actions and data available`,
    async ({ status, code }) => {
      handlers[phase] = async () => {
        if (!status) throw new TypeError('lost response');
        return error(status, code);
      };
      const { user } = await mount();
      await perform(user, phase);
      await within(screen.getByRole('region', { name: 'GitHub 匯出' })).findByRole('alert');
      expect(screen.queryByText(expiry)).toBeNull();
      expect(screen.getByRole('button', { name: '下載封存結果' })).toBeEnabled();
      expect(archiveReads['run-a']).toBe(1);
      if (phase === 'approval')
        expect(screen.getByRole('button', { name: '授權建立分支與 Draft PR' })).toBeEnabled();
      preserved();
    },
  );
}

it('reconciliation exact410 remains an export error and never expires the archive', async () => {
  uncertain = true;
  handlers.reconcile = async () => error();
  const { user } = await mount();
  await perform(user, 'reconcile');
  await within(screen.getByRole('region', { name: 'GitHub 匯出' })).findByRole('alert');
  expect(screen.queryByText(expiry)).toBeNull();
  expect(screen.getByRole('button', { name: '下載封存結果' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '重新查核 GitHub 結果' })).toBeEnabled();
  expect(posts().map((request) => request.path)).toEqual([
    '/api/v1/runs/run-a/exports/export-run-a/reconcile',
  ]);
  expect(archiveReads['run-a']).toBe(1);
  preserved();
});

it('lost approval retains the rendered preview, same body/key and one durable intent on retry', async () => {
  const accepted = new Set<string>();
  handlers.approval = async (id) => {
    const request = posts().at(-1)!;
    accepted.add(request.key);
    if (posts().filter((entry) => entry.path.endsWith('/exports')).length === 1)
      throw new TypeError('accepted but response lost');
    operations = [operation(id)];
    return Response.json(operations[0], { status: 202 });
  };
  const { user } = await mount();
  await perform(user, 'approval');
  await within(screen.getByRole('region', { name: 'GitHub 匯出' })).findByRole('alert');
  expect(screen.getByText('驗證狀態：尚未確認')).toBeVisible();
  preserved();
  expect(screen.getByRole('button', { name: '下載封存結果' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: '授權建立分支與 Draft PR' }));
  expect(await screen.findByText('等待匯出')).toBeVisible();
  const approvals = posts().filter((entry) => entry.path.endsWith('/exports'));
  expect(approvals).toHaveLength(2);
  expect(approvals[0].key).not.toBe('');
  expect(approvals[0].key).toBe(approvals[1].key);
  expect(approvals[0].body).toBe(approvals[1].body);
  expect(accepted.size).toBe(1);
  expect(archiveReads['run-a']).toBe(1);
  expect(screen.queryByText(expiry)).toBeNull();
});
