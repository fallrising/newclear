import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const python = process.env.PYTHON ?? '../.venv/bin/python';
function fixture(action: string) {
  return JSON.parse(
    execFileSync(python, ['../scripts/browser-fixture.py', action], {
      encoding: 'utf8',
      timeout: 20000,
      maxBuffer: 131072,
    }),
  );
}
async function login(page: Page, task: string, username: string, password: string) {
  await page.goto(`/#${task}`);
  await page.getByLabel('帳號', { exact: true }).fill(username);
  await page.getByLabel('密碼', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登入工作台' }).click();
}
async function stage<T>(label: string, action: () => Promise<T>): Promise<T> {
  return test.step(label, async () => {
    console.info(`[BGC] start: ${label}`);
    try {
      const value = await action();
      console.info(`[BGC] completed: ${label}`);
      return value;
    } catch (error) {
      console.error(`[BGC] failed: ${label}`, error);
      throw error;
    }
  });
}

test('owned historical export survives real GC while stale archive controls refuse', async ({
  page: a,
  browser,
}) => {
  // History is imported fixture data, never an observed 31-day worker lifecycle.
  const credentials = JSON.parse(readFileSync('../.artifacts/browser-fixture.json', 'utf8'));
  const saved = fixture('m4-retention-seed');
  const baseline = fixture('export-observe');
  expect(baseline.operations).toHaveLength(0);
  expect(baseline.pulls).toHaveLength(0);
  expect(baseline.mutations).toEqual([]);
  const bContext = await browser.newContext({ baseURL: 'http://127.0.0.1:18600' });
  const b = await bContext.newPage();
  let release!: () => void;
  let observed!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    observed = resolve;
  });
  let first = true;
  await a.route(`**/runs/${saved.a.run_id}/events?**`, async (route) => {
    if (first) {
      first = false;
      observed();
      await gate;
    }
    await route.continue(); // All responses come from the actual API.
  });
  let primaryError: unknown;
  try {
    console.info('[BGC] start: authenticated pages and retained previews');
    await login(a, saved.a.task_id, credentials.username, credentials.password);
    await requested;
    await login(b, saved.b.task_id, credentials.username, credentials.password);
    const aExport = a.getByRole('region', { name: 'GitHub 匯出', exact: true });
    const bExport = b.getByRole('region', { name: 'GitHub 匯出', exact: true });
    const bDownload = b.getByRole('button', { name: '下載封存結果', exact: true });
    await expect(bDownload).toBeEnabled();
    await bExport.getByRole('button', { name: '檢視匯出內容' }).click();
    await expect(bExport.getByRole('button', { name: '授權建立分支與 Draft PR' })).toBeEnabled();
    await aExport.getByRole('button', { name: '檢視匯出內容' }).click();
    await expect(aExport.getByText('驗證狀態：尚未確認')).toBeVisible();
    const approvalResponse = a.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/runs/${saved.a.run_id}/exports`),
    );
    await aExport.getByRole('button', { name: '授權建立分支與 Draft PR' }).click();
    const approved = await approvalResponse;
    expect(approved.status()).toBe(202);
    const body = approved.request().postDataJSON();
    const operationId = (await approved.json()).id;
    expect(body.artifact_sha256).toBe(saved.a.sha256);
    expect(body.base_sha).toBe(credentials.export_fixture.base_sha);
    expect(body.approved).toBe(true);
    await expect(aExport.getByText('等待匯出')).toBeVisible();
    const queued = fixture('export-observe');
    expect(queued.operations).toHaveLength(1);
    expect(queued.operations[0].id).toBe(operationId);
    expect(queued.operations[0].state).toBe('queued');
    expect(queued.mutations).toEqual([]);
    console.info('[BGC] completed: authenticated pages and queued A approval');

    const pruned = fixture('m4-retention-prune');
    expect(pruned.event.total_count).toBe(2);
    expect(pruned.event.ranges).toHaveLength(1);
    expect(pruned.event.ranges[0].run_id).toBe(saved.a.run_id);
    expect(pruned.event.ranges[0].new_floor).toBe(3);
    expect(pruned.archive.count).toBe(1);
    expect(pruned.archive.artifact_ids).toEqual([saved.b.artifact_id]);
    console.info('[BGC] completed: real event/archive GC');
    const expiredEvents = a.waitForResponse(
      (response) =>
        response.url().includes(`/runs/${saved.a.run_id}/events?`) && response.status() === 410,
    );
    release();
    expect((await expiredEvents).status()).toBe(410);
    await expect(a.getByText('活動保留範圍已更新，已重新載入目前狀態。')).toBeVisible();
    await expect(a.getByText('M4 retained suffix', { exact: true })).toHaveCount(1);
    await expect(a.getByText('M4 expired prefix')).toHaveCount(0);
    await expect(a.getByText(saved.a.result.summary)).toBeVisible();
    await expect(aExport.getByText('等待匯出')).toBeVisible();
    const currentA = await (await a.request.get(`/api/v1/runs/${saved.a.run_id}`)).json();
    expect(currentA.result).toEqual(saved.a.result);
    expect(currentA.event_floor).toBe(3);
    expect(currentA.last_event_seq).toBe(3);
    const archivePath = `/api/v1/runs/${saved.a.run_id}/artifacts/${saved.a.artifact_id}`;
    const available = await a.request.get(archivePath);
    expect(available.status()).toBe(200);
    expect(
      createHash('sha256')
        .update(await available.body())
        .digest('hex'),
    ).toBe(saved.a.sha256);
    const downloaded = a.waitForEvent('download');
    await a.getByRole('button', { name: '下載封存結果', exact: true }).click();
    expect(await (await downloaded).failure()).toBeNull();
    console.info('[BGC] completed: A real410, retained suffix and canonical download');

    const session = await (await a.request.get('/api/v1/session')).json();
    for (const key of [
      approved.request().headers()['idempotency-key'],
      'm4-fresh-key-same-export',
    ]) {
      const replay = await a.request.post(`/api/v1/runs/${saved.a.run_id}/exports`, {
        data: body,
        headers: {
          Origin: 'http://127.0.0.1:18600',
          'X-CSRF-Token': session.csrf_token,
          'Idempotency-Key': key,
        },
      });
      expect(replay.status()).toBe(202);
      expect((await replay.json()).id).toBe(operationId);
    }
    expect(fixture('export-observe').mutations).toEqual([]);
    expect(fixture('m4-retention-dispatch').processed).toBe(true);
    await expect(aExport.getByText('已建立 Draft PR')).toBeVisible();
    const exported = fixture('export-observe');
    expect(exported.operations).toHaveLength(1);
    expect(exported.pulls).toHaveLength(1);
    expect(exported.mutations).toEqual(
      ['git/trees', 'git/commits', 'git/refs', 'pulls'].map((suffix) => ({
        method: 'POST',
        path: `/repos/${credentials.export_fixture.repo}/${suffix}`,
      })),
    );
    expect(Object.keys(exported.branches)).toHaveLength(Object.keys(baseline.branches).length + 1);
    const pull = exported.pulls[0];
    expect(pull.draft).toBe(true);
    expect(pull.head.ref).toBe(body.branch);
    expect(pull.base.sha).toBe(body.base_sha);
    expect(pull.body).toContain(body.approval_digest);
    expect(pull.body).toContain('Verification: unknown.');
    expect(fixture('m4-retention-dispatch').processed).toBe(false);
    console.info('[BGC] completed: A approval replay, exact export effects and idle redispatch');

    // Definitive approval expiry retires stale actions without another download.
    const downloads: string[] = [];
    b.on('download', (file) => downloads.push(file.suggestedFilename()));
    const refusedApproval = b.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/runs/${saved.b.run_id}/exports`),
    );
    await stage('B stale approval button click', () =>
      bExport.getByRole('button', { name: '授權建立分支與 Draft PR' }).click(),
    );
    const refusal = await stage('B stale approval API response', () => refusedApproval);
    expect(refusal.status()).toBe(410);
    expect(await refusal.json()).toEqual({ error: 'artifact_expired' });
    await stage('B approval expiry immediately removes controls and renders expiry', async () => {
      await expect(b.getByText('此封存已依保留期限清理；摘要與原始 diff 仍保留。')).toBeVisible();
      await expect(bDownload).toHaveCount(0);
      await expect(bExport).toHaveCount(0);
    });
    expect(downloads).toEqual([]);
    await stage('B authenticated API independently confirms expired artifact JSON', async () => {
      const expiredArtifact = await b.request.get(
        `/api/v1/runs/${saved.b.run_id}/artifacts/${saved.b.artifact_id}`,
      );
      expect(expiredArtifact.status()).toBe(410);
      expect(await expiredArtifact.json()).toEqual({ error: 'artifact_expired' });
    });
    await expect(b.getByRole('region', { name: '成果封存' })).toContainText(saved.b.sha256);
    await expect(b.getByRole('region', { name: '成果封存' })).toContainText(
      `${saved.b.size} bytes`,
    );
    await expect(b.getByRole('button', { name: '下載 diff', exact: true })).toBeEnabled();
    const currentB = await (await b.request.get(`/api/v1/runs/${saved.b.run_id}`)).json();
    expect(currentB.result).toEqual(saved.b.result);
    expect(currentB.cleanup_state).toBe('not_allocated');
    expect(fixture('m4-retention-check').owned).toBe(true);
    expect(fixture('export-observe').operations).toEqual(exported.operations);
    expect(fixture('export-observe').mutations).toEqual(exported.mutations);
    console.info('[BGC] completed: B stale refusals, result/authority and remote preservation');
    await stage('A reload', () => a.reload());
    await stage('B reload', () => b.reload());
    await expect(aExport.getByText('已建立 Draft PR')).toBeVisible();
    await expect(a.getByRole('region', { name: '成果封存' })).toContainText(saved.a.sha256);
    await expect(b.getByText('此封存已依保留期限清理；摘要與原始 diff 仍保留。')).toBeVisible();
    await expect(bExport).toHaveCount(0);
    await expect(b.getByRole('button', { name: '下載 diff', exact: true })).toBeEnabled();
    expect(fixture('export-observe').pulls).toEqual(exported.pulls);
    expect(fixture('export-observe').mutations).toEqual(exported.mutations);
    expect(fixture('m4-retention-check').owned).toBe(true);
    console.info('[BGC] completed: reloaded final states and remote invariants');
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    release();
    try {
      console.info('[BGC] start: owned B context cleanup');
      await bContext.close();
      console.info('[BGC] completed: owned B context cleanup');
    } catch (cleanupError) {
      // Preserve the scenario failure/timeout; cleanup failure remains in the log.
      console.error('[BGC] failed: owned B context cleanup', cleanupError);
      if (primaryError === undefined && test.info().status !== 'timedOut') throw cleanupError;
    }
  }
});
