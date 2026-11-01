import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const python = process.env.PYTHON ?? '../.venv/bin/python';
function fixture(action: string) {
  return JSON.parse(
    execFileSync(python, ['../scripts/browser-fixture.py', action], { encoding: 'utf8' }),
  );
}
async function open(page: Page) {
  const credentials = JSON.parse(readFileSync('../.artifacts/browser-fixture.json', 'utf8'));
  const saved = fixture('export');
  await page.goto(`/#${saved.task_id}`);
  await page.getByLabel('帳號', { exact: true }).fill(credentials.username);
  await page.getByLabel('密碼', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: '登入工作台' }).click();
  await expect(
    page.getByRole('heading', { name: 'Explicit export browser fixture' }),
  ).toBeVisible();
  return saved;
}

test('historical archive export requires exact approval and creates one branch/PR across replay', async ({
  page,
}) => {
  const saved = await open(page);
  const previous = fixture('export-observe');
  await expect(page.getByRole('button', { name: '檢視匯出內容' })).toBeVisible();
  expect(fixture('export-observe').operations).toHaveLength(previous.operations.length);
  // Start a new attempt, then deliberately export the previous immutable archive.
  await page.getByRole('button', { name: '調整目標後重新執行' }).click();
  await page.getByLabel('新的工作目標').fill('A new attempt must not replace the old export');
  await page.getByRole('button', { name: '以新目標重新執行' }).click();
  await expect(page.getByLabel('執行紀錄').locator('option:checked')).toContainText('第 2 次');
  await expect(page.getByRole('button', { name: '檢視匯出內容' })).toHaveCount(0);
  await page.getByLabel('執行紀錄').selectOption(saved.run.id);
  await page.getByRole('button', { name: '檢視匯出內容' }).click();
  const region = page.getByRole('region', { name: 'GitHub 匯出', exact: true });
  await expect(region.getByText(saved.base_sha)).toBeVisible();
  await region.getByText('檢視封存的 diff', { exact: true }).click();
  await expect(region.locator('pre')).toContainText('+approved export');
  expect(fixture('export-observe').operations).toHaveLength(previous.operations.length);
  expect(fixture('export-observe').pulls).toHaveLength(previous.pulls.length);
  expect(fixture('export-observe').mutations).toEqual(previous.mutations);
  const approvalRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && request.url().endsWith(`/runs/${saved.run.id}/exports`),
  );
  await region.getByRole('button', { name: '授權建立分支與 Draft PR' }).click();
  const approved = await approvalRequest;
  await expect(region.getByText('等待匯出')).toBeVisible();
  const body = approved.postDataJSON();
  expect(body.approved).toBe(true);
  const session = await (await page.request.get('/api/v1/session')).json();
  for (const key of [approved.headers()['idempotency-key'], 'browser-new-key-same-export']) {
    const duplicate = await page.request.post(`/api/v1/runs/${saved.run.id}/exports`, {
      data: body,
      headers: {
        Origin: 'http://127.0.0.1:18600',
        'X-CSRF-Token': session.csrf_token,
        'Idempotency-Key': key,
      },
    });
    expect(duplicate.status()).toBe(202);
  }
  expect(fixture('export-dispatch').processed).toBe(true);
  await expect(region.getByText('已建立 Draft PR')).toBeVisible();
  const observed = fixture('export-observe');
  expect(observed.operations).toHaveLength(previous.operations.length + 1);
  expect(observed.pulls).toHaveLength(previous.pulls.length + 1);
  const pull = observed.pulls.at(-1);
  expect(pull.draft).toBe(true);
  expect(pull.head.ref).toBe(body.branch);
  expect(pull.base.sha).toBe(saved.base_sha);
  expect(pull.body).toContain(body.approval_digest);
  await expect(region.getByRole('link', { name: '開啟 Draft PR' })).toHaveAttribute(
    'href',
    `https://github.com/${saved.repo}/pull/${pull.number}`,
  );
  expect(fixture('export-dispatch').processed).toBe(false);
  expect(fixture('export-observe').pulls).toHaveLength(observed.pulls.length);
  expect(fixture('export-observe').mutations).toEqual(observed.mutations);
  expect(Object.keys(observed.branches)).toHaveLength(Object.keys(previous.branches).length + 1);
  await page.reload();
  await page.getByLabel('執行紀錄').selectOption(saved.run.id);
  await expect(region.getByText('已建立 Draft PR')).toBeVisible();
  await expect(region.locator('img,script')).toHaveCount(0);
});

test('a lost PR creation response remains uncertain until read-only reconciliation finds that same PR', async ({
  page,
}) => {
  const saved = await open(page);
  const previous = fixture('export-observe');
  const region = page.getByRole('region', { name: 'GitHub 匯出', exact: true });
  await region.getByRole('button', { name: '檢視匯出內容' }).click();
  await region.getByRole('button', { name: '授權建立分支與 Draft PR' }).click();
  await expect(region.getByText('等待匯出')).toBeVisible();
  expect(fixture('export-dispatch-lost-pr').processed).toBe(true);
  await expect(region.getByText('遠端結果尚待確認')).toBeVisible();
  await expect(region.getByRole('link', { name: '開啟 Draft PR' })).toHaveCount(0);
  const uncertain = fixture('export-observe');
  expect(uncertain.pulls).toHaveLength(previous.pulls.length + 1);
  const reconcileResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/reconcile'),
  );
  await region.getByRole('button', { name: '重新查核 GitHub 結果' }).click();
  expect((await reconcileResponse).status()).toBe(202);
  // Reconciliation is a separately requested worker pass; no new approval occurs.
  fixture('export-dispatch');
  await expect(region.getByText('已建立 Draft PR')).toBeVisible();
  const reconciled = fixture('export-observe');
  expect(reconciled.pulls).toEqual(uncertain.pulls);
  expect(reconciled.mutations).toEqual(uncertain.mutations);
  expect(
    reconciled.operations.find((item: { run_id: string }) => item.run_id === saved.run.id).state,
  ).toBe('succeeded');
});
