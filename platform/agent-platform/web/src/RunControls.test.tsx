import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RunControls } from './RunControls';
import type { Run } from './api';

const run: Run = {
  attempt_no: 1,
  base_sha: 'a'.repeat(40),
  goal: 'test',
  cleanup_state: 'pending',
  last_event_seq: 1,
  event_floor: 1,
  result: null,
  id: 'run-1',
  task_id: 'task-1',
  state: 'running',
  state_version: 4,
  backend_cursor: 'event-1',
  capabilities: { pause: true, resume: true, cancel: true, approval: true },
};
const clients: QueryClient[] = [];
afterEach(() => {
  clients.forEach((c) => c.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
});
function setup(value = run) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  clients.push(client);
  const content = (next: Run) => (
    <QueryClientProvider client={client}>
      <RunControls run={next} />
    </QueryClientProvider>
  );
  const view = render(content(value));
  return (next: Run) => view.rerender(content(next));
}

it('waits for observed pause, retains cancellation, then permits resume', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ status: 'pending' }, { status: 202 }));
  vi.stubGlobal('fetch', fetch);
  const rerender = setup();
  expect(screen.getByRole('button', { name: '繼續' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '暫停' }));
  await screen.findByText('暫停請求已送出，正在更新狀態…');
  expect(screen.getByRole('button', { name: '繼續' })).toBeDisabled();
  rerender({ ...run, state: 'pausing', state_version: 5 });
  expect(screen.getByRole('button', { name: '暫停' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '取消' })).toBeEnabled();
  rerender({ ...run, state: 'paused', state_version: 6 });
  expect(screen.getByRole('button', { name: '繼續' })).toBeEnabled();
  expect(screen.getByText(/環境與容量仍保留/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '繼續' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
    action: 'resume',
    expected_state_version: 6,
  });
});

it('retries an ambiguous pause with its original key and version after state refresh', async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('response lost'))
    .mockResolvedValue(Response.json({ status: 'pending' }, { status: 202 }));
  vi.stubGlobal('fetch', fetch);
  const rerender = setup();
  fireEvent.click(screen.getByRole('button', { name: '暫停' }));
  await screen.findByRole('alert');
  rerender({ ...run, state: 'paused', state_version: 6 });
  expect(screen.getByRole('button', { name: '繼續' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '暫停' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(fetch.mock.calls[0][1].headers['Idempotency-Key']).toEqual(
    fetch.mock.calls[1][1].headers['Idempotency-Key'],
  );
  expect(fetch.mock.calls[0][1].body).toEqual(fetch.mock.calls[1][1].body);
});

it('resuming does not offer a second resume and keeps original approval policy visible', () => {
  vi.stubGlobal('fetch', vi.fn());
  setup({ ...run, state: 'resuming', require_approval: true });
  expect(screen.getByRole('button', { name: '繼續' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '取消' })).toBeEnabled();
  expect(screen.getByText(/繼續後仍遵守原本的審批設定/)).toBeInTheDocument();
});

it('does not enable pause before the initial prompt has been observed', () => {
  vi.stubGlobal('fetch', vi.fn());
  setup({ ...run, backend_cursor: null });
  expect(screen.getByRole('button', { name: '暫停' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '取消' })).toBeEnabled();
});
