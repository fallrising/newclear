import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Run } from '../src/api';

type Case = {
  task_id: string;
  run_id: string;
  title: string;
  run: Run & { reason: string | null };
  archive?: { id: string; sha256: string; size: number };
};
type Observation = {
  owned: boolean;
  unchanged: boolean;
  occupied: number;
  exports: number;
  effects: Record<string, number>;
  runtime_calls: number;
};
type Ready = {
  ready: boolean;
  cases: Record<'failed' | 'unknown' | 'fault', Case>;
  observation: Observation;
};

function bounded<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} exceeded ${milliseconds}ms`)),
      milliseconds,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function holdFixture() {
  const child = spawn(
    process.env.PYTHON ?? '../.venv/bin/python',
    ['../scripts/browser-fixture.py', 'result-truth-hold'],
    { stdio: 'pipe' },
  );
  const lines = createInterface({ input: child.stdout });
  const queue: string[] = [];
  let stderr = '';
  let receiver: { resolve: (line: string) => void; reject: (error: Error) => void } | undefined;
  child.stderr.on('data', (data: Buffer) => {
    stderr = (stderr + data.toString()).slice(-16384);
  });
  lines.on('line', (line) => {
    if (line.length > 262144) {
      receiver?.reject(new Error('result truth response exceeded bound'));
      return;
    }
    if (receiver) {
      const current = receiver;
      receiver = undefined;
      current.resolve(line);
    } else queue.push(line);
  });
  let exited = false;
  const exit = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      exited = true;
      receiver?.reject(new Error(`result truth helper exited ${code}/${signal}: ${stderr}`));
      receiver = undefined;
      if (code === 0) resolve();
      else reject(new Error(`result truth helper exited ${code}/${signal}: ${stderr}`));
    });
  });
  // Install a rejection handler immediately; readiness failures still surface below.
  void exit.catch(() => {});
  async function next<T>(timeout = 20000): Promise<T> {
    const line =
      queue.shift() ??
      (await bounded(
        new Promise<string>((resolve, reject) => {
          if (exited) {
            reject(new Error(`result truth helper is closed: ${stderr}`));
            return;
          }
          if (receiver) {
            reject(new Error('concurrent result truth commands forbidden'));
            return;
          }
          receiver = { resolve, reject };
        }),
        timeout,
        'result truth response',
      ));
    return JSON.parse(line) as T;
  }
  return {
    ready: next<Ready>(),
    async observe() {
      child.stdin.write(JSON.stringify({ action: 'observe' }) + '\n');
      return next<Observation>();
    },
    async close() {
      try {
        if (!exited) {
          child.stdin.write(JSON.stringify({ action: 'close' }) + '\n');
          expect(await next<{ closed: boolean }>(5000)).toEqual({ closed: true });
          child.stdin.end();
        }
        await bounded(exit, 5000, 'owned helper close');
      } finally {
        try {
          if (!exited) {
            child.kill('SIGTERM');
            try {
              await bounded(exit, 5000, 'owned helper terminate');
            } finally {
              if (!exited) {
                child.kill('SIGKILL');
                await bounded(exit, 5000, 'owned helper kill exit');
              }
            }
          }
        } finally {
          lines.close();
        }
      }
    },
  };
}

test('actual Worker failed, unknown and archive-fault outcomes remain truthful in browser', async ({
  page,
}) => {
  const credentials = JSON.parse(readFileSync('../.artifacts/browser-fixture.json', 'utf8'));
  const fixture = holdFixture();
  const unexpectedWrites: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && !request.url().endsWith('/api/v1/session'))
      unexpectedWrites.push(`${request.method()} ${request.url()}`);
  });
  let primaryError: unknown;
  try {
    const saved = await fixture.ready;
    expect(saved.ready).toBe(true);
    expect(saved.observation).toMatchObject({
      owned: true,
      unchanged: true,
      occupied: 1,
      exports: 0,
      effects: { allocate: 3, prepare: 3, prompt: 3, result: 3, release: 2, cancel: 0 },
    });
    expect(await fixture.observe()).toEqual(saved.observation);
    expect(unexpectedWrites).toEqual([]);
    await page.goto(`/#${saved.cases.failed.task_id}`);
    await page.getByLabel('帳號', { exact: true }).fill(credentials.username);
    await page.getByLabel('密碼', { exact: true }).fill(credentials.password);
    await page.getByRole('button', { name: '登入工作台' }).click();
    for (const kind of ['failed', 'unknown', 'fault'] as const) {
      await test.step(`Worker ${kind} API, archive and UI truth`, async () => {
        const item = saved.cases[kind];
        await page.goto(`/#${item.task_id}`);
        await expect(page.getByRole('heading', { name: item.title, exact: true })).toBeVisible();
        const inspected = await (await page.request.get(`/api/v1/runs/${item.run_id}`)).json();
        expect(inspected).toEqual(item.run);
        const detail = await (await page.request.get(`/api/v1/tasks/${item.task_id}`)).json();
        expect(detail.runs).toHaveLength(1);
        expect(detail.runs[0].id).toBe(item.run_id);
        await expect(page.getByLabel('執行紀錄')).toHaveValue(item.run_id);
        const listing = await (
          await page.request.get(`/api/v1/runs/${item.run_id}/artifacts`)
        ).json();
        if (kind === 'fault') {
          expect(inspected).toMatchObject({
            state: 'interrupted',
            reason: 'artifact_persist_failed',
            result: null,
            cleanup_state: 'unknown',
          });
          expect(listing.items).toEqual([]);
          await expect(page.locator('.detail .state-interrupted')).toBeVisible();
          await expect(page.locator('.detail .run-facts')).toContainText('尚待確認');
          await expect(page.getByText('本次執行尚無封存結果。')).toBeVisible();
          await expect(page.getByRole('heading', { name: '執行結果', exact: true })).toHaveCount(0);
          await expect(page.getByRole('button', { name: '下載封存結果', exact: true })).toHaveCount(
            0,
          );
          await expect(page.getByRole('button', { name: '下載 diff', exact: true })).toHaveCount(0);
          await expect(page.getByRole('region', { name: 'GitHub 匯出', exact: true })).toHaveCount(
            0,
          );
        } else {
          const archive = item.archive!;
          expect(inspected.state).toBe('failed');
          expect(inspected.reason).toBe(
            kind === 'failed' ? 'verification_failed' : 'verification_unverified',
          );
          expect(inspected.cleanup_state).toBe('confirmed');
          expect(listing.items).toHaveLength(1);
          expect(listing.items[0]).toMatchObject(archive);
          await expect(page.locator('.detail .state-failed')).toBeVisible();
          await expect(page.locator('.result')).toContainText(
            kind === 'failed' ? 'Profile 設定的驗證失敗' : '未設定驗證條件',
          );
          await expect(page.locator('.result')).not.toContainText('Profile 設定的驗證通過');
          await expect(page.locator('.result')).not.toContainText('固定檔案修改驗收通過');
          await expect(page.getByText(item.run.result!.summary, { exact: true })).toBeVisible();
          await expect(page.getByRole('region', { name: '成果封存' })).toContainText(
            archive.sha256,
          );
          const response = await page.request.get(
            `/api/v1/runs/${item.run_id}/artifacts/${archive.id}`,
          );
          expect(response.status()).toBe(200);
          const bytes = await response.body();
          expect(bytes.length).toBe(archive.size);
          expect(createHash('sha256').update(bytes).digest('hex')).toBe(archive.sha256);
          expect(JSON.parse(bytes.toString()).result).toEqual(item.run.result);
          if (kind === 'failed') {
            expect(item.run.result!.verification).toMatchObject({
              status: 'failed',
              checks: [{ status: 'failed', exit_code: 7 }],
            });
          } else {
            expect(item.run.result!.verification).toMatchObject({
              status: 'unknown',
              reason: 'verification_not_configured',
              checks: [],
            });
            expect(item.run.result!.summary).toContain('tests passed');
            await expect(page.locator('.result img, .result script')).toHaveCount(0);
            expect(
              await page.evaluate(
                () => (window as Window & { __truthClaim?: number }).__truthClaim,
              ),
            ).toBeUndefined();
          }
          const downloaded = page.waitForEvent('download');
          await page.getByRole('button', { name: '下載封存結果', exact: true }).click();
          const file = await downloaded;
          expect(file.suggestedFilename()).toBe(`run-${item.run_id}-result.json`);
          expect(readFileSync((await file.path())!).equals(bytes)).toBe(true);
        }
        await page.reload();
        await expect(page.getByLabel('執行紀錄')).toHaveValue(item.run_id);
        if (kind === 'fault') {
          await expect(page.getByText('本次執行尚無封存結果。')).toBeVisible();
          await expect(page.locator('.result')).toHaveCount(0);
        } else {
          await expect(page.getByText(item.run.result!.summary, { exact: true })).toBeVisible();
          await expect(page.locator('.result')).toContainText(
            kind === 'failed' ? 'Profile 設定的驗證失敗' : '未設定驗證條件',
          );
          const archive = item.archive!;
          const restored = await page.request.get(
            `/api/v1/runs/${item.run_id}/artifacts/${archive.id}`,
          );
          expect(
            createHash('sha256')
              .update(await restored.body())
              .digest('hex'),
          ).toBe(archive.sha256);
        }
        expect(await fixture.observe()).toEqual(saved.observation);
        expect(unexpectedWrites).toEqual([]);
      });
    }
    expect(await fixture.observe()).toEqual(saved.observation);
    expect(unexpectedWrites).toEqual([]);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await fixture.close();
    } catch (error) {
      if (primaryError === undefined) throw error;
      console.error('owned truth helper cleanup:', error);
    }
  }
});
