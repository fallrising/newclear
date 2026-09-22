import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';

const python = process.env.PYTHON ?? '../.venv/bin/python';
test('AT-03 100 durable events survive a real browser network disconnect; AT-10 controls', async ({
  page,
  context,
}) => {
  const fixture = JSON.parse(readFileSync('../.artifacts/browser-fixture.json', 'utf8'));
  await page.goto('/');
  await page.getByLabel('帳號', { exact: true }).fill(fixture.username);
  await page.getByLabel('密碼', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登入工作台' }).click();
  await page.getByRole('button', { name: /100 durable events/ }).click();
  const cursors: number[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/events')) cursors.push(Number(url.searchParams.get('after_seq')));
  });
  const producer = spawn(python, ['../scripts/browser-fixture.py', 'produce'], { stdio: 'pipe' });
  const finished = new Promise<void>((resolve, reject) => {
    producer.on('error', reject);
    producer.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`producer exit ${code}`)),
    );
  });
  try {
    await expect(page.getByText('AT03 event 20', { exact: true })).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText('連線中斷，正在重新連線…')).toBeVisible();
    await finished;
    await context.setOffline(false);
    await expect(page.getByText('AT03 event 100', { exact: true })).toBeVisible();
    await expect(page.locator('.timeline li').filter({ hasText: 'AT03 event ' })).toHaveCount(100);
    const sequences = await page
      .locator('[data-event-seq]')
      .evaluateAll((nodes) => nodes.map((n) => Number(n.getAttribute('data-event-seq'))));
    expect(sequences).toEqual(Array.from({ length: sequences.length }, (_, i) => i + 1));
    expect(cursors.some((cursor) => cursor > 0 && cursor < 103)).toBeTruthy();
    for (const name of ['暫停', '繼續', '取消', '審批'])
      await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
    const before = JSON.parse(
      execFileSync(python, ['../scripts/browser-fixture.py', 'counts'], { encoding: 'utf8' }),
    );
    expect(before).toEqual({ prompts: 1, allocations: 1, events: 100 });
    await page.reload();
    await expect(page.getByText('AT03 event 100', { exact: true })).toBeVisible();
    await expect(page.locator('.timeline li').filter({ hasText: 'AT03 event ' })).toHaveCount(100);
    expect(
      JSON.parse(
        execFileSync(python, ['../scripts/browser-fixture.py', 'counts'], { encoding: 'utf8' }),
      ),
    ).toEqual(before);
  } finally {
    await context.setOffline(false);
    if (producer.exitCode === null) producer.kill('SIGTERM');
    await finished.catch(() => {});
  }
});
