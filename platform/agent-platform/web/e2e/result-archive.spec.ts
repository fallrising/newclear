import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const python = process.env.PYTHON ?? '../.venv/bin/python';
test('archive survives cleanup and edited retry; historical download preserves exact bytes', async ({
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
  await expect(
    page.getByRole('heading', { name: 'Immutable archive browser fixture' }),
  ).toBeVisible();
  const runId = saved.run.id;
  expect(saved.run.cleanup_state).toBe('confirmed');
  const listing = await page.request.get(`/api/v1/runs/${runId}/artifacts`);
  expect(listing.status()).toBe(200);
  const { items } = await listing.json();
  expect(items).toHaveLength(1);
  const path = `/api/v1/runs/${runId}/artifacts/${items[0].id}`;
  const response = await page.request.get(path);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-disposition']).toBe(
    `attachment; filename="run-${runId}-result.json"`,
  );
  expect(response.headers()['content-security-policy']).toBe("sandbox; default-src 'none'");
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['cache-control']).toBe('no-store');
  const original = await response.body();
  expect(original.length).toBe(items[0].size);
  expect(createHash('sha256').update(original).digest('hex')).toBe(items[0].sha256);
  const archive = JSON.parse(original.toString('utf8'));
  expect(archive.schema_version).toBe('result-archive-v1');
  expect(archive.run_id).toBe(runId);
  expect(archive.goal).toBe(saved.run.goal);
  expect(archive.base_sha).toBe(saved.run.base_sha);
  expect(archive.profile_revision).toBe(saved.run.profile_revision);
  expect(archive.result.execution_mode).toBe('local-mock');
  expect(archive.result.diff).toContain('+archive fixture');
  expect(archive.result.diff).toBe(saved.run.result.diff);
  expect(archive.result.verification.status).toBe('passed');
  const downloadBytes = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '下載封存結果', exact: true }).click();
    const file = await pending;
    expect(file.suggestedFilename()).toBe(`run-${runId}-result.json`);
    return readFileSync((await file.path())!);
  };
  expect((await downloadBytes()).equals(original)).toBeTruthy();
  await expect(page.locator('.archive script, .archive img, .diff script, .diff img')).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () => (window as Window & { __archiveExecuted?: number }).__archiveExecuted,
    ),
  ).toBeUndefined();
  await page.getByRole('button', { name: '調整目標後重新執行' }).click();
  await page.getByLabel('新的工作目標').fill('Second attempt keeps its own result');
  await page.getByRole('button', { name: '以新目標重新執行' }).click();
  await expect(page.getByLabel('執行紀錄').locator('option:checked')).toContainText('第 2 次');
  await expect(page.getByText('本次執行尚無封存結果。')).toBeVisible();
  await expect(page.getByRole('button', { name: '下載封存結果' })).toHaveCount(0);
  const detail = await (await page.request.get(`/api/v1/tasks/${saved.task_id}`)).json();
  expect(detail.runs).toHaveLength(2);
  expect(
    (await page.request.get(`/api/v1/runs/${detail.runs[0].id}/artifacts/${items[0].id}`)).status(),
  ).toBe(404);
  await page.getByLabel('執行紀錄').selectOption(runId);
  expect((await downloadBytes()).equals(original)).toBeTruthy();
  await page.reload();
  await page.getByLabel('執行紀錄').selectOption(runId);
  expect((await downloadBytes()).equals(original)).toBeTruthy();
  expect((await (await page.request.get(path)).body()).equals(original)).toBeTruthy();
});
