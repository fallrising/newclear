import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExportPanel } from './ExportPanel';
import { setCsrf, type Artifact, type ExportOperation, type ExportPreview } from './api';

const artifact: Artifact = {
  id: 'archive-1',
  run_id: 'old-run',
  kind: 'result',
  sha256: 'a'.repeat(64),
  size: 300,
  mime: 'application/json',
  created_at: '2026-10-04T00:00:00Z',
};
const preview: ExportPreview = {
  run_id: artifact.run_id,
  artifact_id: artifact.id,
  artifact_sha256: artifact.sha256,
  target_repo: 'example/repo',
  base_branch: 'main',
  base_sha: 'b'.repeat(40),
  branch: 'agent-platform/export-fixed',
  approval_digest: 'c'.repeat(64),
  verification_status: 'unknown',
  diff: '+<img src=x onerror=alert(1)>你好',
  files: ['note.txt'],
};
let targets: Array<{ repo: string; base_branch: string }>;
let operations: ExportOperation[];
let lost: boolean;
let previewError: boolean;
let sent: Array<{ path: string; body: Record<string, unknown>; key: string }>;
const clients: QueryClient[] = [];
function operation(changes: Partial<ExportOperation> = {}): ExportOperation {
  return {
    ...preview,
    id: 'export-1',
    state: 'queued',
    reason: null,
    pr_url: null,
    created_at: artifact.created_at,
    ...changes,
  };
}
beforeEach(() => {
  targets = [{ repo: 'example/repo', base_branch: 'main' }];
  operations = [];
  lost = false;
  previewError = false;
  sent = [];
  setCsrf('test-csrf');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options: RequestInit = {}) => {
      if (path === '/api/v1/export-targets') return Response.json({ items: targets });
      if ((options.method ?? 'GET') === 'GET') return Response.json({ items: operations });
      const body = JSON.parse(String(options.body));
      const key = new Headers(options.headers).get('Idempotency-Key') ?? '';
      sent.push({ path, body, key });
      expect(new Headers(options.headers).get('X-CSRF-Token')).toBe('test-csrf');
      if (path.endsWith('/preview')) {
        return previewError
          ? Response.json({ error: 'artifact_invalid' }, { status: 409 })
          : Response.json(preview);
      }
      if (lost && sent.filter((s) => !s.path.endsWith('/preview')).length === 1)
        throw new TypeError('lost');
      operations = [operation()];
      return Response.json(operations[0], { status: 202 });
    }),
  );
});
afterEach(() => {
  cleanup();
  clients.forEach((c) => c.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
});
function show(value = artifact) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <ExportPanel key={value.run_id} artifact={value} />
    </QueryClientProvider>,
  );
}

it('requires reviewing the selected historical artifact before one exact explicit approval', async () => {
  const user = userEvent.setup();
  show();
  await screen.findByRole('button', { name: '檢視匯出內容' });
  expect(sent).toHaveLength(0);
  expect(screen.queryByRole('button', { name: '授權建立分支與 Draft PR' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '檢視匯出內容' }));
  await screen.findByText('驗證狀態：尚未確認');
  expect(screen.getByText(preview.base_sha)).toBeInTheDocument();
  expect(screen.getByText(preview.diff)).toBeInTheDocument();
  expect(document.querySelector('.export-preview img')).toBeNull();
  expect(screen.getByText(preview.branch)).toBeInTheDocument();
  expect(sent).toHaveLength(1);
  expect(sent[0].body).toEqual({
    artifact_id: artifact.id,
    artifact_sha256: artifact.sha256,
    target_repo: 'example/repo',
    base_branch: 'main',
  });
  await user.click(screen.getByRole('button', { name: '授權建立分支與 Draft PR' }));
  await screen.findByText('等待匯出');
  expect(sent[1].path).toBe('/api/v1/runs/old-run/exports');
  expect(sent[1].body).toEqual({
    artifact_id: artifact.id,
    artifact_sha256: artifact.sha256,
    target_repo: 'example/repo',
    base_branch: 'main',
    base_sha: preview.base_sha,
    branch: preview.branch,
    approval_digest: preview.approval_digest,
    approved: true,
  });
  expect(sent[1].key).not.toBe('');
});

it('keeps the command key after a lost approval response', async () => {
  lost = true;
  const user = userEvent.setup();
  show();
  await user.click(await screen.findByRole('button', { name: '檢視匯出內容' }));
  await user.click(await screen.findByRole('button', { name: '授權建立分支與 Draft PR' }));
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: '授權建立分支與 Draft PR' }));
  await screen.findByText('等待匯出');
  const approvals = sent.filter((s) => !s.path.endsWith('/preview'));
  expect(approvals).toHaveLength(2);
  expect(approvals[0].key).toBe(approvals[1].key);
});

it('shows disabled configuration without offering a remote write', async () => {
  targets = [];
  show();
  await screen.findByText('GitHub 匯出尚未設定目的地。');
  expect(screen.queryByRole('button', { name: '檢視匯出內容' })).not.toBeInTheDocument();
  expect(sent).toHaveLength(0);
});

it('does not offer approval when archive validation fails', async () => {
  previewError = true;
  const user = userEvent.setup();
  show();
  await user.click(await screen.findByRole('button', { name: '檢視匯出內容' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: '授權建立分支與 Draft PR' })).not.toBeInTheDocument();
  expect(sent).toHaveLength(1);
});

it('uncertain operations offer only read-only reconciliation and never imply success', async () => {
  operations = [operation({ state: 'uncertain', reason: 'remote_outcome_unknown' })];
  const user = userEvent.setup();
  show();
  await screen.findByText('遠端結果尚待確認');
  await user.click(screen.getByRole('button', { name: '重新查核 GitHub 結果' }));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0].path).toBe('/api/v1/runs/old-run/exports/export-1/reconcile');
  expect(sent[0].body).toEqual({});
  expect(screen.queryByRole('link', { name: '開啟 Draft PR' })).not.toBeInTheDocument();
});

it('renders only a matching HTTPS GitHub PR link; untrusted output stays text', async () => {
  operations = [operation({ state: 'succeeded', pr_url: 'javascript:alert(1)' })];
  const view = show();
  await screen.findByText('已建立 Draft PR');
  expect(screen.queryByRole('link', { name: '開啟 Draft PR' })).not.toBeInTheDocument();
  view.unmount();
  operations = [
    operation({ state: 'succeeded', pr_url: 'https://github.com/example/repo/pull/17' }),
  ];
  show();
  expect(await screen.findByRole('link', { name: '開啟 Draft PR' })).toHaveAttribute(
    'href',
    'https://github.com/example/repo/pull/17',
  );
});

it('changing the destination discards an earlier approval preview', async () => {
  targets.push({ repo: 'example/other', base_branch: 'main' });
  const user = userEvent.setup();
  show();
  await user.click(await screen.findByRole('button', { name: '檢視匯出內容' }));
  await screen.findByRole('button', { name: '授權建立分支與 Draft PR' });
  await user.selectOptions(screen.getByLabelText('GitHub 匯出目的地'), 'example/other@main');
  expect(screen.queryByRole('button', { name: '授權建立分支與 Draft PR' })).not.toBeInTheDocument();
  expect(sent).toHaveLength(1);
});
