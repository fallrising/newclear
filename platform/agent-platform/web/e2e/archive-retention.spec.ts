import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const python = process.env.PYTHON ?? '../.venv/bin/python';
test('expired archive keeps identity and result while stale download and export fail closed', async ({
  page,
}) => {
  const fixture = JSON.parse(readFileSync('../.artifacts/browser-fixture.json', 'utf8'));
  const saved = JSON.parse(
    execFileSync(python, ['../scripts/browser-fixture.py', 'archive'], { encoding: 'utf8' }),
  );
  await page.goto(`/#${saved.task_id}`);
  await page.getByLabel('帳號', { exact: true }).fill(fixture.username);
  await page.getByLabel('密碼', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登入工作台' }).click();
  const button = page.getByRole('button', { name: '下載封存結果', exact: true });
  await expect(button).toBeEnabled();
  const runId = saved.run.id;
  const before = await (await page.request.get(`/api/v1/runs/${runId}/artifacts`)).json();
  const archive = before.items[0];
  const path = `/api/v1/runs/${runId}/artifacts/${archive.id}`;
  expect((await page.request.get(path)).status()).toBe(200);
  const pruned = JSON.parse(
    execFileSync(python, ['../scripts/browser-fixture.py', 'archive-prune', runId], {
      encoding: 'utf8',
    }),
  );
  expect(pruned.receipt.count).toBe(1);
  expect(pruned.receipt.artifact_ids).toEqual([archive.id]);
  const downloads: string[] = [];
  page.on('download', (file) => downloads.push(file.suggestedFilename()));
  await button.click();
  await expect(page.getByText('此封存已依保留期限清理；摘要與原始 diff 仍保留。')).toBeVisible();
  await expect(button).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'GitHub 匯出' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '成果封存' })).toContainText(archive.sha256);
  expect(downloads).toEqual([]);
  const gone = await page.request.get(path);
  expect(gone.status()).toBe(410);
  expect(await gone.json()).toEqual({ error: 'artifact_expired' });
  const session = await (await page.request.get('/api/v1/session')).json();
  const exportResponse = await page.request.post(`/api/v1/runs/${runId}/exports/preview`, {
    headers: { Origin: 'http://127.0.0.1:18600', 'X-CSRF-Token': session.csrf_token },
    data: {
      artifact_id: archive.id,
      artifact_sha256: archive.sha256,
      target_repo: fixture.export_fixture.repo,
      base_branch: fixture.export_fixture.base_branch,
    },
  });
  expect(exportResponse.status()).toBe(410);
  const after = await (await page.request.get(`/api/v1/runs/${runId}`)).json();
  expect(after.result).toEqual(saved.run.result);
  expect(after.state).toBe('succeeded');
  expect(after.cleanup_state).toBe('confirmed');
  await page.reload();
  await expect(page.getByText('此封存已依保留期限清理；摘要與原始 diff 仍保留。')).toBeVisible();
  await expect(page.getByRole('region', { name: '成果封存' })).toContainText(
    `${archive.size} bytes`,
  );
  await expect(page.getByRole('button', { name: '下載 diff' })).toBeEnabled();
});
