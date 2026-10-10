import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const python = process.env.PYTHON ?? '../.venv/bin/python';
const fixture = () => JSON.parse(readFileSync('../.artifacts/browser-fixture.json', 'utf8'));
const counts = () =>
  JSON.parse(
    execFileSync(python, ['../scripts/browser-fixture.py', 'counts'], { encoding: 'utf8' }),
  );
async function login(page: Page, url = '/') {
  const saved = fixture();
  await page.goto(url);
  await page.getByLabel('帳號', { exact: true }).fill(saved.username);
  await page.getByLabel('密碼', { exact: true }).fill(saved.password);
  await page.getByRole('button', { name: '登入工作台' }).click();
  await expect(page.getByRole('searchbox', { name: '搜尋任務' })).toBeVisible();
}

test('filter links survive reload, new tab and browser history with the selected task', async ({
  page,
  context,
}) => {
  const before = counts();
  await login(page, '/?view=keep');
  const projects = await (await page.request.get('/api/v1/projects')).json();
  const project = projects.items.find((item: { name: string }) => item.name === 'Browser fixture');
  const run = await (await page.request.get(`/api/v1/runs/${fixture().run_id}`)).json();
  const initialUrl = page.url();
  await page.getByRole('searchbox', { name: '搜尋任務' }).fill('100 durable');
  expect(page.url()).toBe(initialUrl);
  await page.getByRole('button', { name: '搜尋', exact: true }).click();
  await page.getByLabel('篩選專案').selectOption(project.id);
  await page.getByLabel('篩選狀態').selectOption(run.state);
  const rows = page.locator('.task-list .task-row');
  await expect(rows).toHaveCount(1);
  await rows.first().click();
  await expect(
    page.getByRole('heading', { name: '100 durable events', exact: true }),
  ).toBeVisible();
  const shareUrl = page.url();
  const saved = new URL(shareUrl);
  expect(saved.searchParams.get('q')).toBe('100 durable');
  expect(saved.searchParams.get('project_id')).toBe(project.id);
  expect(saved.searchParams.get('state')).toBe(run.state);
  expect(saved.searchParams.get('view')).toBe('keep');
  expect(saved.hash).toBe(`#${fixture().task_id}`);
  await page.reload();
  await expect(page.getByRole('searchbox', { name: '搜尋任務' })).toHaveValue('100 durable');
  await expect(page.getByLabel('篩選專案')).toHaveValue(project.id);
  await expect(page.getByLabel('篩選狀態')).toHaveValue(run.state);
  await expect(rows).toHaveCount(1);
  await expect(
    page.getByRole('heading', { name: '100 durable events', exact: true }),
  ).toBeVisible();

  const linked = await context.newPage();
  try {
    await linked.goto(shareUrl);
    await expect(linked.getByRole('searchbox', { name: '搜尋任務' })).toHaveValue('100 durable');
    await expect(linked.getByLabel('篩選專案')).toHaveValue(project.id);
    await expect(linked.getByLabel('篩選狀態')).toHaveValue(run.state);
    await expect(linked.locator('.task-list .task-row')).toHaveCount(1);
    await expect(
      linked.getByRole('heading', { name: '100 durable events', exact: true }),
    ).toBeVisible();
  } finally {
    await linked.close();
  }
  await page.getByRole('button', { name: '清除篩選' }).click();
  await expect(page.getByRole('searchbox', { name: '搜尋任務' })).toHaveValue('');
  const clearedUrl = page.url();
  expect(new URL(clearedUrl).search).toBe('?view=keep');
  expect(new URL(clearedUrl).hash).toBe(saved.hash);
  await page.goBack();
  await expect(page).toHaveURL(shareUrl);
  await expect(page.getByRole('searchbox', { name: '搜尋任務' })).toHaveValue('100 durable');
  await expect(page.getByLabel('篩選專案')).toHaveValue(project.id);
  await expect(page.getByLabel('篩選狀態')).toHaveValue(run.state);
  await expect(rows).toHaveCount(1);
  await page.goForward();
  await expect(page).toHaveURL(clearedUrl);
  await expect(page.getByRole('searchbox', { name: '搜尋任務' })).toHaveValue('');
  await expect(page.getByLabel('篩選專案')).toHaveValue('');
  await expect(page.getByLabel('篩選狀態')).toHaveValue('');
  await expect(
    page.getByRole('heading', { name: '100 durable events', exact: true }),
  ).toBeVisible();
  expect(counts()).toEqual(before);
});

test('malformed filter link falls back safely and clear preserves unrelated query and task', async ({
  page,
}) => {
  const before = counts();
  const listRequests: URL[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/tasks') listRequests.push(url);
  });
  await login(page, `/?q=one&q=two&state=failed&view=keep#${fixture().task_id}`);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('searchbox', { name: '搜尋任務' })).toHaveValue('');
  await expect(page.getByLabel('篩選專案')).toHaveValue('');
  await expect(page.getByLabel('篩選狀態')).toHaveValue('');
  await expect(
    page.getByRole('heading', { name: '100 durable events', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '清除篩選' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(new URL(page.url()).search).toBe('?view=keep');
  expect(new URL(page.url()).hash).toBe(`#${fixture().task_id}`);
  expect(listRequests.length).toBeGreaterThan(0);
  for (const url of listRequests) {
    for (const key of ['q', 'project_id', 'state']) expect(url.searchParams.has(key)).toBe(false);
  }
  expect(counts()).toEqual(before);
});

test('valid unavailable project remains selected until explicitly cleared', async ({ page }) => {
  const missing = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  await login(page, `/?project_id=${missing}`);
  await expect(page.getByLabel('篩選專案')).toHaveValue(missing);
  await expect(page.getByLabel('篩選專案').locator('option:checked')).not.toHaveText('所有專案');
  await expect(page.getByText('沒有符合篩選條件的任務。')).toBeVisible();
  await page.getByRole('button', { name: '清除篩選' }).click();
  await expect(page.getByLabel('篩選專案')).toHaveValue('');
  expect(new URL(page.url()).searchParams.has('project_id')).toBe(false);
  await expect(page.locator('.task-list .task-row').first()).toBeVisible();
});
