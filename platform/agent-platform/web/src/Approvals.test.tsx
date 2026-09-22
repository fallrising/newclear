import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Approvals } from './Approvals';
import type { Run } from './api';

let status: string;
let lost: boolean;
let calls: { key: string; payload: unknown }[];
let client: QueryClient;
const run = { id: 'run', task_id: 'task', state: 'awaiting_approval', state_version: 7 } as Run;

beforeEach(() => {
  status = 'pending';
  lost = false;
  calls = [];
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options: RequestInit = {}) => {
      if (options.method === 'POST') {
        calls.push({
          key: (options.headers as Record<string, string>)['Idempotency-Key'],
          payload: JSON.parse(String(options.body)),
        });
        if (lost && calls.length === 1) throw new TypeError('lost reply');
        status =
          (calls[0].payload as { decision: string }).decision === 'deny' ? 'denied' : 'approved';
        return Response.json({ status: 'pending' }, { status: 202 });
      }
      return Response.json({
        items: [
          {
            id: 'approval',
            generation: 2,
            action_digest: 'a'.repeat(64),
            status,
            expires_at: '2099-01-01T00:00:00Z',
            normalized_action: {
              actions: [
                {
                  id: 'tool',
                  tool_name: 'terminal',
                  action: { command: 'echo <script>literal</script>' },
                },
              ],
            },
          },
        ],
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});
function mount() {
  render(
    <QueryClientProvider client={client}>
      <Approvals run={run} />
    </QueryClientProvider>,
  );
}

it('shows exact tool parameters and binds the decision to digest, generation and version', async () => {
  mount();
  const user = userEvent.setup();
  expect(await screen.findByText(/echo <script>literal/)).toBeVisible();
  expect(document.querySelector('script')).toBeNull();
  await user.click(screen.getByRole('button', { name: '核准這批操作' }));
  expect(await screen.findByText('已核准，等待執行')).toBeVisible();
  expect(calls[0].payload).toEqual({
    decision: 'approve',
    action_digest: 'a'.repeat(64),
    generation: 2,
    expected_state_version: 7,
  });
  expect(screen.getByRole('button', { name: '核准這批操作' })).toBeDisabled();
});

it('retries an uncertain decision with the original key and prevents switching it', async () => {
  lost = true;
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '核准這批操作' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: '拒絕並取消' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: '重試原決定' }));
  await screen.findByText('已核准，等待執行');
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
});

it('denies a pending batch through the cancellation decision', async () => {
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '拒絕並取消' }));
  expect(await screen.findByText('已拒絕，正在停止環境')).toBeVisible();
  expect(calls[0].payload).toMatchObject({ decision: 'deny' });
});
