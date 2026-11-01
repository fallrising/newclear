import { test, expect, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const python = process.env.PYTHON ?? '../.venv/bin/python';
test('expired archive keeps identity and result while stale download and export fail closed', async ({
  page,
}) => {
  const fixture = JSON.parse(readFileSync('../.artifacts/browser-fixture.json', 'utf8'));
  const saved = JSON.parse(
    execFileSync(python, ['../scripts/browser-fixture.py', 'download-retention-seed'], {
      encoding: 'utf8',
      timeout: 20000,
      maxBuffer: 131072,
    }),
  );
  // Imported old rows are synthetic, never an observed worker lifecycle.
  await page.goto(`/#${saved.b.task_id}`);
  await page.getByLabel('帳號', { exact: true }).fill(fixture.username);
  await page.getByLabel('密碼', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登入工作台' }).click();
  const button = page.getByRole('button', { name: '下載封存結果', exact: true });
  await expect(button).toBeEnabled();
  const runId = saved.b.run_id;
  const before = await (await page.request.get(`/api/v1/runs/${runId}/artifacts`)).json();
  const archive = before.items[0];
  expect(archive.id).toBe(saved.b.artifact_id);
  expect(archive.sha256).toBe(saved.b.sha256);
  expect(archive.size).toBe(saved.b.size);
  const path = `/api/v1/runs/${runId}/artifacts/${archive.id}`;
  expect((await page.request.get(path)).status()).toBe(200);
  const pruned = JSON.parse(
    execFileSync(python, ['../scripts/browser-fixture.py', 'download-retention-prune'], {
      encoding: 'utf8',
      timeout: 20000,
      maxBuffer: 131072,
    }),
  );
  expect(pruned.owned).toBe(true);
  expect(pruned.authority_unchanged).toBe(true);
  expect(pruned.receipt.count).toBe(2);
  expect(pruned.receipt.artifact_ids.sort()).toEqual(
    [saved.a.artifact_id, saved.b.artifact_id].sort(),
  );
  // Explicit browser-only metadata network fault after real SQL GC. Download410
  // and its JSON still come from the actual authenticated API.
  const metadataPath = `**/api/v1/runs/${runId}/artifacts`;
  let injectedFailures = 0;
  const metadataFault = async (route: Route) => {
    injectedFailures += 1;
    await route.abort('failed');
  };
  await page.route(metadataPath, metadataFault);
  const downloads: string[] = [];
  page.on('download', (file) => downloads.push(file.suggestedFilename()));
  try {
    const expiredResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/artifacts/${archive.id}`) && response.status() === 410,
    );
    await button.click();
    expect((await expiredResponse).status()).toBe(410);
    await expect(page.getByText('此封存已依保留期限清理；摘要與原始 diff 仍保留。')).toBeVisible();
    await expect(button).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'GitHub 匯出' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: '成果封存' })).toContainText(archive.sha256);
    await expect(page.getByRole('region', { name: '成果封存' })).toContainText(
      `${archive.size} bytes`,
    );
    await expect(page.getByText('無法載入封存結果。')).toBeVisible();
    await expect(page.getByRole('button', { name: '重新載入封存' })).toBeEnabled();
    expect(injectedFailures).toBeGreaterThan(0);
    expect(downloads).toEqual([]);
  } finally {
    await page.unroute(metadataPath, metadataFault);
  }
  const refreshed = page.waitForResponse(
    (response) => response.url().endsWith(`/runs/${runId}/artifacts`) && response.status() === 200,
  );
  await page.getByRole('button', { name: '重新載入封存' }).click();
  expect((await refreshed).status()).toBe(200);
  await expect(page.getByText('無法載入封存結果。')).toHaveCount(0);
  await expect(page.getByText('此封存已依保留期限清理；摘要與原始 diff 仍保留。')).toBeVisible();
  await expect(button).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'GitHub 匯出' })).toHaveCount(0);
  expect(downloads).toEqual([]);
  const tombstone = await (await page.request.get(`/api/v1/runs/${runId}/artifacts`)).json();
  expect(tombstone.items).toHaveLength(1);
  expect(tombstone.items[0].id).toBe(archive.id);
  expect(tombstone.items[0].sha256).toBe(archive.sha256);
  expect(tombstone.items[0].pruned_at).not.toBeNull();
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
  expect(after.result).toEqual(saved.b.result);
  expect(after.state).toBe('failed');
  expect(after.cleanup_state).toBe('not_allocated');
  await page.reload();
  await expect(page.getByText('此封存已依保留期限清理；摘要與原始 diff 仍保留。')).toBeVisible();
  await expect(page.getByRole('region', { name: '成果封存' })).toContainText(
    `${archive.size} bytes`,
  );
  await expect(page.getByRole('button', { name: '下載 diff' })).toBeEnabled();
});
