import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const python = process.env.PYTHON ?? '../.venv/bin/python';
test('edited retry creates one new attempt and preserves the original goal and result', async ({
  page,
}) => {
  const fixture = JSON.parse(readFileSync('../.artifacts/browser-fixture.json', 'utf8'));
  const saved = JSON.parse(
    execFileSync(python, ['../scripts/browser-fixture.py', 'retry'], { encoding: 'utf8' }),
  );
  const counts = () =>
    JSON.parse(
      execFileSync(python, ['../scripts/browser-fixture.py', 'counts'], { encoding: 'utf8' }),
    );
  const before = counts();
  await page.goto(`/#${saved.task_id}`);
  await page.getByLabel('帳號', { exact: true }).fill(fixture.username);
  await page.getByLabel('密碼', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登入工作台' }).click();
  await expect(page.getByRole('heading', { name: 'Editable retry browser fixture' })).toBeVisible();
  const original = await (await page.request.get(`/api/v1/runs/${saved.run_id}`)).json();
  const goal = page.getByRole('region', { name: '本次工作目標' });
  await expect(goal).toContainText(saved.goal);
  await expect(goal.locator('img, script')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as Window & { __goalExecuted?: number }).__goalExecuted),
  ).toBeUndefined();

  const submissions: { body: Record<string, unknown>; key: string | undefined }[] = [];
  let release!: () => void;
  let submitted!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const accepted = new Promise<void>((resolve) => {
    submitted = resolve;
  });
  await page.route(`**/api/v1/tasks/${saved.task_id}/runs`, async (route) => {
    const request = route.request();
    submissions.push({ body: request.postDataJSON(), key: request.headers()['idempotency-key'] });
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    submitted();
    await pending;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: '調整目標後重新執行' }).click();
    const editor = page.getByLabel('新的工作目標');
    await expect(editor).toHaveValue(saved.goal);
    await editor.fill('   ');
    await page.getByRole('button', { name: '以新目標重新執行' }).click();
    expect(submissions).toHaveLength(0);
    await editor.fill('Discard this draft');
    await page.getByRole('button', { name: '取消修改' }).click();
    await expect(editor).toHaveCount(0);
    expect(submissions).toHaveLength(0);

    await page.getByRole('button', { name: '調整目標後重新執行' }).click();
    await expect(editor).toHaveValue(saved.goal);
    const updatedGoal =
      '  Revised goal 你好🐈\nKeep internal  spaces.\n<script>literal text</script>  ';
    await editor.fill(updatedGoal);
    await page.getByRole('button', { name: '以新目標重新執行' }).click();
    await accepted;
    await expect(editor).toBeDisabled();
    await expect(page.getByRole('button', { name: '取消修改' })).toBeDisabled();
    expect(submissions).toHaveLength(1);
    expect(submissions[0].key).toBeTruthy();
    expect(submissions[0].body).toEqual({
      goal: updatedGoal,
      base_sha: original.base_sha,
      profile_revision: original.profile_revision,
      expected_state_version: original.state_version,
    });
    release();
    await expect(page.getByLabel('執行紀錄').locator('option:checked')).toContainText('第 2 次');
    await expect(goal).toContainText(updatedGoal.trim());
    await expect(goal.locator('script')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '調整目標後重新執行' })).toHaveCount(0);
    const detail = await (await page.request.get(`/api/v1/tasks/${saved.task_id}`)).json();
    expect(detail.runs).toHaveLength(2);
    expect(detail.runs[0].goal).toBe(updatedGoal.trim());
    expect(detail.runs[0].base_sha).toBe(original.base_sha);
    expect(detail.runs[0].profile_revision).toBe(original.profile_revision);
    expect(detail.runs[0].state).toBe('queued');
    expect(await (await page.request.get(`/api/v1/runs/${saved.run_id}`)).json()).toEqual(original);

    await page.getByLabel('執行紀錄').selectOption(saved.run_id);
    await expect(goal).toContainText(saved.goal);
    await expect(page.locator('.result')).toContainText(
      'Original attempt result remains available',
    );
    await page.reload();
    await expect(goal).toContainText(updatedGoal.trim());
    expect(submissions).toHaveLength(1);
    expect(counts()).toEqual(before);
  } finally {
    release();
  }
});
