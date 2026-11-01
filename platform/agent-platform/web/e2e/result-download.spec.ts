import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const python = process.env.PYTHON ?? '../.venv/bin/python';
test('saved HTML stays inert in result, diff and events; download preserves exact bytes', async ({
  page,
}) => {
  const fixture = JSON.parse(readFileSync('../.artifacts/browser-fixture.json', 'utf8'));
  const saved = JSON.parse(
    execFileSync(python, ['../scripts/browser-fixture.py', 'security'], { encoding: 'utf8' }),
  );
  const dialogs: string[] = [];
  const payloadRequests: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/x') payloadRequests.push(request.url());
  });
  await page.goto('/');
  await page.getByLabel('帳號', { exact: true }).fill(fixture.username);
  await page.getByLabel('密碼', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登入工作台' }).click();
  await page.getByRole('button', { name: /Safe diff browser fixture/ }).click();
  await expect(page.locator('.result > p').first()).toHaveText(saved.payload);
  await expect(page.getByLabel('檔案差異')).toHaveText(saved.diff);
  await expect(page.locator('.timeline').getByText(saved.payload, { exact: true })).toBeVisible();
  await expect(
    page.locator('.result script, .result img, .timeline script, .timeline img'),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as Window & { __diffExecuted?: number }).__diffExecuted),
  ).toBeUndefined();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '下載 diff', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(`run-${saved.run_id}.diff`);
  const bytes = readFileSync((await download.path())!);
  expect(bytes.equals(Buffer.from(saved.diff, 'utf8'))).toBeTruthy();
  const response = await page.request.get(`/api/v1/runs/${saved.run_id}/result.diff`);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('text/plain; charset=utf-8');
  expect(response.headers()['content-security-policy']).toBe("sandbox; default-src 'none'");
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['cache-control']).toBe('no-store');
  const run = await (await page.request.get(`/api/v1/runs/${saved.run_id}`)).json();
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(run.result.diff_sha256);
  expect(dialogs).toEqual([]);
  expect(payloadRequests).toEqual([]);
  expect(
    await page.evaluate(() => (window as Window & { __diffExecuted?: number }).__diffExecuted),
  ).toBeUndefined();
});
