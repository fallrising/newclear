import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const python = process.env.PYTHON ?? '../.venv/bin/python';
test('real event GC reconnects an expired cursor and preserves result and suffix', async ({
  page,
}) => {
  const credentials = JSON.parse(readFileSync('../.artifacts/browser-fixture.json', 'utf8'));
  const saved = JSON.parse(
    execFileSync(python, ['../scripts/browser-fixture.py', 'event-history'], { encoding: 'utf8' }),
  );
  let release!: () => void;
  let observed!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    observed = resolve;
  });
  let first = true;
  await page.route(`**/runs/${saved.run_id}/events?**`, async (route) => {
    if (first) {
      first = false;
      observed();
      await gate;
    }
    await route.continue();
  });
  await page.goto(`/#${saved.task_id}`);
  await page.getByLabel('帳號', { exact: true }).fill(credentials.username);
  await page.getByLabel('密碼', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: '登入工作台' }).click();
  await requested;
  const pruned = JSON.parse(
    execFileSync(python, ['../scripts/browser-fixture.py', 'event-prune', saved.run_id], {
      encoding: 'utf8',
    }),
  );
  expect(pruned.receipt.total_count).toBe(2);
  expect(pruned.receipt.ranges[0].new_floor).toBe(3);
  release();
  await expect(page.getByText('活動保留範圍已更新，已重新載入目前狀態。')).toBeVisible();
  await expect(page.getByText('Retained activity suffix')).toBeVisible();
  await expect(page.getByText('Expired activity prefix')).toHaveCount(0);
  await expect(page.getByText('Preserved event retention result')).toBeVisible();
  const stale = await page.request.get(`/api/v1/runs/${saved.run_id}/events?follow=false`);
  expect(stale.status()).toBe(410);
  expect(await stale.json()).toEqual({ error: 'events_archived' });
  const current = await (await page.request.get(`/api/v1/runs/${saved.run_id}`)).json();
  expect(current.result).toEqual(saved.result);
  expect(current.event_floor).toBe(3);
  expect(current.last_event_seq).toBe(3);
  expect(current.cleanup_state).toBe('not_allocated');
});
