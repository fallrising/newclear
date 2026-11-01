import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import type { Artifact, Run, Task } from './api';

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

const expiry = '此封存已依保留期限清理；摘要與原始 diff 仍保留。';
const failure = '封存下載失敗，請確認登入狀態後重試。';
const clients: QueryClient[] = [];
const pending: Array<() => void> = [];
let requests: Array<{ path: string; method: string; credentials: RequestCredentials | undefined }>;
let metadataReads: Record<string, number>;
let downloadReads: Record<string, number>;
let metadata: (id: string, count: number) => Promise<Response>;
let download: (id: string, count: number) => Promise<Response>;
let authenticated: boolean;
let create: ReturnType<typeof vi.fn<(blob: Blob) => string>>;
let revoke: ReturnType<typeof vi.fn<(url: string) => void>>;
let files: Array<{ href: string; name: string }>;

function artifact(id: string): Artifact {
  return {
    id: `archive-${id}`,
    run_id: id,
    kind: 'result',
    sha256: (id === 'run-a' ? 'a' : 'b').repeat(64),
    size: 321,
    mime: 'application/json',
    created_at: '2026-09-01T00:00:00Z',
    pruned_at: null,
  };
}
function run(id: string, attempt: number): Run {
  return {
    id,
    task_id: 'task-a',
    attempt_no: attempt,
    profile_revision: 'profile-a',
    state: 'failed',
    state_version: 7,
    base_sha: 'c'.repeat(40),
    goal: `Goal ${id}`,
    cleanup_state: 'not_allocated',
    last_event_seq: 0,
    event_floor: 1,
    result: {
      summary: `Preserved result ${id}`,
      diff: `+retained ${id}`,
      diff_sha256: 'd'.repeat(64),
      diff_bytes: 15,
      base_sha: 'c'.repeat(40),
      verification: { status: 'unknown', reason: 'verification_not_configured' },
    },
  };
}
function available(id: string) {
  return Response.json({ items: [artifact(id)] });
}
function error(status = 410, code = 'artifact_expired') {
  return Response.json({ error: code }, { status });
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  pending.push(() => resolve(Response.json({ items: [] })));
  return { promise, resolve };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/#task-a');
  requests = [];
  metadataReads = {};
  downloadReads = {};
  metadata = async (id) => available(id);
  download = async () => error();
  authenticated = true;
  files = [];
  create = vi.fn<(blob: Blob) => string>(() => 'blob:archive-test');
  revoke = vi.fn<(url: string) => void>();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    files.push({ href: this.href, name: this.download });
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, options: RequestInit = {}) => {
      const path = input.split('?')[0];
      const method = options.method ?? 'GET';
      requests.push({ path, method, credentials: options.credentials });
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
        title: 'Download expiry workbench',
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
      if (path.endsWith('/exports') && method === 'GET') return Response.json({ items: [] });
      const archives = path.match(/^\/api\/v1\/runs\/([^/]+)\/artifacts(?:\/([^/]+))?$/);
      if (archives) {
        const id = archives[1];
        if (archives[2]) {
          expect(archives[2]).toBe(`archive-${id}`);
          downloadReads[id] = (downloadReads[id] ?? 0) + 1;
          return download(id, downloadReads[id]);
        }
        metadataReads[id] = (metadataReads[id] ?? 0) + 1;
        return metadata(id, metadataReads[id]);
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  pending.splice(0).forEach((resolve) => resolve());
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
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
function preserved(id = 'run-a') {
  expect(screen.getByRole('region', { name: '成果封存' })).toHaveTextContent(artifact(id).sha256);
  expect(screen.getByRole('region', { name: '成果封存' })).toHaveTextContent('321 bytes');
  expect(screen.getByText(`Preserved result ${id}`)).toBeVisible();
  expect(screen.getByLabelText('檔案差異')).toHaveTextContent(`+retained ${id}`);
  expect(screen.getByRole('button', { name: /^下載 diff$/ })).toBeEnabled();
}
function expired() {
  expect(screen.getByText(expiry)).toBeVisible();
  expect(screen.queryByRole('button', { name: '下載封存結果' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'GitHub 匯出' })).toBeNull();
  preserved();
}
function noFileOrPost() {
  expect(create).not.toHaveBeenCalled();
  expect(revoke).not.toHaveBeenCalled();
  expect(files).toEqual([]);
  expect(requests.filter((entry) => entry.method !== 'GET')).toEqual([]);
}
async function clickDownload(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '下載封存結果' }));
}

it('download exact410 retires actions immediately while source metadata remains pending', async () => {
  const refresh = deferred();
  metadata = async (id, count) => (count === 1 ? available(id) : refresh.promise);
  const { client, user } = await mount();
  await clickDownload(user);
  await screen.findByText(expiry);
  expired();
  await waitFor(() => expect(metadataReads['run-a']).toBe(2));
  expect(client.getQueryState(['artifacts', 'run-a', 1])?.isInvalidated).toBe(true);
  expect(client.getQueryState(['artifacts', 'run-b', 9])?.isInvalidated).toBe(false);
  expect(
    client.getQueryData<{ items: Artifact[] }>(['artifacts', 'run-a', 7])?.items[0].pruned_at,
  ).toBeNull();
  expect(downloadReads).toEqual({ 'run-a': 1 });
  noFileOrPost();
});

it('download expiry retains metadata through failed refresh, explicit retry and stale available data', async () => {
  metadata = async (id, count) =>
    id === 'run-a' && count === 2 ? error(503, 'database_unavailable') : available(id);
  const { client, user } = await mount();
  await clickDownload(user);
  await screen.findByText(expiry);
  await screen.findByText('無法載入封存結果。');
  expired();
  await user.click(screen.getByRole('button', { name: '重新載入封存' }));
  await waitFor(() => expect(metadataReads['run-a']).toBe(3));
  await waitFor(() => expect(screen.queryByText('無法載入封存結果。')).toBeNull());
  expired();
  expect(
    client.getQueryData<{ items: Artifact[] }>(['artifacts', 'run-a', 7])?.items[0].pruned_at,
  ).toBeNull();
  metadata = async (id) =>
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
  expect(metadataReads['run-a']).toBe(4);
  expired();
  await user.selectOptions(screen.getByLabelText('執行紀錄'), 'run-b');
  await screen.findByText('Preserved result run-b');
  await waitFor(() => expect(screen.getByRole('button', { name: '下載封存結果' })).toBeEnabled());
  expect(screen.queryByText(expiry)).toBeNull();
  preserved('run-b');
  expect(downloadReads).toEqual({ 'run-a': 1 });
  noFileOrPost();
});

it('a stale available refresh cannot resurrect a definitively expired download', async () => {
  const refresh = deferred();
  metadata = async (id, count) => (count === 1 ? available(id) : refresh.promise);
  const { client, user } = await mount();
  await clickDownload(user);
  await screen.findByText(expiry);
  expired();
  await act(async () => {
    refresh.resolve(available('run-a'));
  });
  await waitFor(() =>
    expect(client.getQueryState(['artifacts', 'run-a', 7])?.fetchStatus).toBe('idle'),
  );
  expired();
  noFileOrPost();
});

it('late run A download410 refreshes only A and leaves selected B available', async () => {
  const response = deferred();
  download = async () => response.promise;
  const { client, user } = await mount();
  await clickDownload(user);
  await user.selectOptions(screen.getByLabelText('執行紀錄'), 'run-b');
  await screen.findByText('Preserved result run-b');
  await waitFor(() => expect(metadataReads['run-b']).toBe(1));
  await act(async () => {
    response.resolve(error());
  });
  await waitFor(() =>
    expect(client.getQueryState(['artifacts', 'run-a', 1])?.isInvalidated).toBe(true),
  );
  expect(client.getQueryState(['artifacts', 'run-b', 9])?.isInvalidated).toBe(false);
  expect(metadataReads['run-b']).toBe(1);
  expect(screen.queryByText(expiry)).toBeNull();
  expect(screen.getByRole('button', { name: '下載封存結果' })).toBeEnabled();
  preserved('run-b');
  expect(
    requests.filter((entry) => /\/artifacts\//.test(entry.path)).map((entry) => entry.path),
  ).toEqual(['/api/v1/runs/run-a/artifacts/archive-run-a']);
  noFileOrPost();
});

it('download401 refreshes the App session without marking archive expiry or creating a file', async () => {
  download = async () => {
    authenticated = false;
    return error(401, 'authentication_required');
  };
  const { client, user } = await mount();
  await clickDownload(user);
  expect(await screen.findByRole('heading', { name: 'Operator 登入' })).toBeVisible();
  expect(requests.filter((entry) => entry.path === '/api/v1/session')).toHaveLength(2);
  expect(metadataReads['run-a']).toBe(1);
  expect(
    client.getQueryData<{ items: Artifact[] }>(['artifacts', 'run-a', 7])?.items[0].pruned_at,
  ).toBeNull();
  expect(screen.queryByText(expiry)).toBeNull();
  noFileOrPost();
});

const otherFailures = [
  { name: 'wrong-code410', response: () => error(410, 'artifact_invalid') },
  { name: 'malformed410', response: () => new Response('{broken', { status: 410 }) },
  { name: 'null410', response: () => Response.json(null, { status: 410 }) },
  {
    name: 'array410',
    response: () => Response.json([{ error: 'artifact_expired' }], { status: 410 }),
  },
  { name: 'string410', response: () => Response.json('artifact_expired', { status: 410 }) },
  { name: '409-expiry-code', response: () => error(409) },
  { name: '503-expiry-code', response: () => error(503) },
  {
    name: 'network-error',
    response: () => {
      throw new TypeError('artifact_expired');
    },
  },
];
it.each(otherFailures)(
  '$name keeps archive actions usable and never auto-retries or infers expiry',
  async ({ response }) => {
    download = async () => response();
    const { user } = await mount();
    await clickDownload(user);
    expect(await screen.findByText(failure)).toBeVisible();
    expect(screen.queryByText(expiry)).toBeNull();
    expect(screen.queryByText('封存已到期，已更新可用狀態。')).toBeNull();
    expect(screen.getByRole('button', { name: '下載封存結果' })).toBeEnabled();
    expect(screen.getByRole('region', { name: 'GitHub 匯出' })).toBeVisible();
    expect(metadataReads['run-a']).toBe(1);
    expect(downloadReads['run-a']).toBe(1);
    preserved();
    noFileOrPost();
  },
);

it('successful selected B download preserves exact bytes, filename, source path and URL cleanup', async () => {
  const bytes = new Uint8Array([0, 10, 127, 195, 169, 255]);
  download = async () => new Response(bytes, { headers: { 'Content-Type': 'application/json' } });
  const { user } = await mount();
  await user.selectOptions(screen.getByLabelText('執行紀錄'), 'run-b');
  await screen.findByText('Preserved result run-b');
  await waitFor(() => expect(screen.getByRole('button', { name: '下載封存結果' })).toBeEnabled());
  await clickDownload(user);
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(new Uint8Array(await create.mock.calls[0][0].arrayBuffer())).toEqual(bytes);
  expect(files).toEqual([{ href: 'blob:archive-test', name: 'run-run-b-result.json' }]);
  await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:archive-test'), { timeout: 2000 });
  expect(revoke).toHaveBeenCalledOnce();
  expect(requests.filter((entry) => /\/artifacts\//.test(entry.path))).toEqual([
    {
      path: '/api/v1/runs/run-b/artifacts/archive-run-b',
      method: 'GET',
      credentials: 'same-origin',
    },
  ]);
  expect(downloadReads).toEqual({ 'run-b': 1 });
  expect(requests.filter((entry) => entry.method !== 'GET')).toEqual([]);
  expect(screen.queryByText(expiry)).toBeNull();
  preserved('run-b');
});

it('transient download failure permits one explicit successful retry without extra requests', async () => {
  download = async (_id, count) =>
    count === 1 ? error(409, 'artifact_invalid') : new Response('retry bytes');
  const { user } = await mount();
  await clickDownload(user);
  await screen.findByText(failure);
  expect(downloadReads['run-a']).toBe(1);
  noFileOrPost();
  await clickDownload(user);
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(await create.mock.calls[0][0].text()).toBe('retry bytes');
  expect(files).toEqual([{ href: 'blob:archive-test', name: 'run-run-a-result.json' }]);
  await waitFor(() => expect(revoke).toHaveBeenCalledOnce(), { timeout: 2000 });
  expect(downloadReads['run-a']).toBe(2);
  expect(metadataReads['run-a']).toBe(1);
  expect(requests.filter((entry) => entry.method !== 'GET')).toEqual([]);
  expect(screen.queryByText(expiry)).toBeNull();
});
