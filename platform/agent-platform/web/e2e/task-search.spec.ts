import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const python = process.env.PYTHON ?? '../.venv/bin/python';
test('search combines latest state and project across pages without rerunning tasks', async ({
  page,
}) => {
  const fixture = JSON.parse(readFileSync('../.artifacts/browser-fixture.json', 'utf8'));
  const seed = JSON.parse(
    execFileSync(python, ['../scripts/browser-fixture.py', 'search'], { encoding: 'utf8' }),
  );
  const counts = () =>
    JSON.parse(
      execFileSync(python, ['../scripts/browser-fixture.py', 'counts'], { encoding: 'utf8' }),
    );
  const before = counts();
  await page.goto('/');
  await page.getByLabel('帳號', { exact: true }).fill(fixture.username);
  await page.getByLabel('密碼', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登入工作台' }).click();
  await page.getByRole('searchbox', { name: '搜尋任務' }).fill('History Needle');
  await page.getByRole('button', { name: '搜尋', exact: true }).click();
  await page.getByLabel('篩選專案').selectOption(seed.project_id);
  await page.getByLabel('篩選狀態').selectOption('failed');
  const rows = page.locator('.task-list .task-row');
  await expect(rows).toHaveCount(30);
  await expect(rows.first()).toContainText('History Needle');
  await expect(rows.first()).toContainText('失敗');
  const first = await rows.locator('.task-title').allTextContents();
  await page.getByRole('button', { name: '較早的任務 →' }).click();
  await expect(rows).toHaveCount(2);
  const second = await rows.locator('.task-title').allTextContents();
  expect(new Set([...first, ...second]).size).toBe(32);
  expect([...first, ...second].sort()).toEqual(
    Array.from({ length: 32 }, (_, i) => `History Needle ${String(i).padStart(2, '0')}`),
  );
  await page.getByLabel('篩選狀態').selectOption('queued');
  await expect(page.getByText('沒有符合篩選條件的任務。')).toBeVisible();
  await expect(page.getByText(/第 2 頁/)).toHaveCount(0);
  await page.getByRole('button', { name: '清除篩選' }).click();
  await expect(rows.first()).toContainText('Different project');
  await page.getByRole('searchbox', { name: '搜尋任務' }).fill('你好 %_');
  await page.getByRole('button', { name: '搜尋', exact: true }).click();
  await page.getByLabel('篩選專案').selectOption(seed.other_project_id);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Different project');
  await page.reload();
  await expect(page.getByRole('searchbox', { name: '搜尋任務' })).toHaveValue('你好 %_');
  await expect(page.getByLabel('篩選專案')).toHaveValue(seed.other_project_id);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Different project');
  expect(counts()).toEqual(before);
});
