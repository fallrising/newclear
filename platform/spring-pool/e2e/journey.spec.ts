import { test, expect, type Page } from '@playwright/test';

const SP_WEB_URL = process.env.SP_WEB_URL ?? 'http://127.0.0.1:8787';

test.beforeAll(async ({ request }) => {
  const res = await request.get(`${SP_WEB_URL}/healthz`).catch(() => null);
  if (!res || res.status() !== 200) {
    throw new Error(
      `spring-pool-web is not healthy at ${SP_WEB_URL} (override with SP_WEB_URL). ` +
        `Start the local workerd pair (lead-owned) in local auth mode before running E2E; no webServer auto-launch is configured.`
    );
  }
});

async function gotoChecked(page: Page, path: string): Promise<void> {
  const response = await page.goto(path, { waitUntil: 'load' });
  if (!response) throw new Error(`Navigation to ${path} produced no response`);
  if (response.status() >= 400) {
    throw new Error(`GET ${path} -> HTTP ${response.status()} at ${SP_WEB_URL}`);
  }
}

async function saveScript(page: Page): Promise<void> {
  await Promise.all([
    page.waitForURL(/\/scripts\/\d+/),
    page.getByRole('button', { name: /save/i }).click(),
  ]);
}

async function saveRunbook(page: Page): Promise<void> {
  await Promise.all([
    page.waitForURL(/\/runbooks\/\d+/),
    page.getByRole('button', { name: /save/i }).click(),
  ]);
}

async function fillStep(page: Page, n: number, scriptId: string, instruction: string): Promise<void> {
  const group = page.getByRole('group', { name: new RegExp(`Step ${n}`) });
  await group.getByLabel('Script', { exact: true }).selectOption(scriptId);
  await group.getByLabel('Revision', { exact: true }).fill('1');
  await group.getByLabel('Instruction', { exact: true }).fill(instruction);
}

async function readDownloadStream(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (!stream) throw new Error('download produced no stream');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function assertNoPageHorizontalScroll(page: Page): Promise<void> {
  const hasHorizontal = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth > el.clientWidth;
  });
  expect(hasHorizontal, 'page must not scroll horizontally on mobile').toBe(false);
}

test.describe('T-E2E-1 no-JS paste + file -> reordered runbook export', () => {
  test.use({ javaScriptEnabled: false });

  test('creates two scripts, builds a runbook, reorders without JS, export has both bodies in order', async ({ page }) => {
    const run = `t003-e2e-${Date.now()}`;
    const bodyA = `#!/bin/bash\necho "A-${run}"\n`;
    const bodyB = `#!/bin/bash\necho "B-${run}"\n`;
    const titleA = `Script A ${run}`;
    const titleB = `Script B ${run}`;
    const runbookTitle = `Runbook ${run}`;

    await gotoChecked(page, '/scripts/new');
    await page.getByLabel('Title').fill(titleA);
    await page.getByLabel('Language').selectOption('bash');
    await page.getByLabel('Script content').fill(bodyA);
    await saveScript(page);
    const idA = page.url().match(/\/scripts\/(\d+)/)?.[1];
    expect(idA, 'script A detail URL should carry its id').toBeTruthy();

    await gotoChecked(page, '/scripts/new');
    await page.getByLabel('Title').fill(titleB);
    await page.getByLabel('Language').selectOption('python');
    await page.getByLabel('Upload file').setInputFiles({
      name: 'upload.py',
      mimeType: 'text/x-python',
      buffer: Buffer.from(bodyB, 'utf8'),
    });
    await saveScript(page);
    const idB = page.url().match(/\/scripts\/(\d+)/)?.[1];
    expect(idB, 'script B detail URL should carry its id').toBeTruthy();

    await gotoChecked(page, '/runbooks/new');
    await page.getByLabel('Title').fill(runbookTitle);
    await fillStep(page, 1, idA!, 'run the paste script');
    await page.getByRole('button', { name: /add step/i }).click();
    await expect(page.getByRole('group', { name: 'Step 2' })).toBeVisible();
    await fillStep(page, 2, idB!, 'run the uploaded script');

    await page.getByRole('group', { name: 'Step 1' }).getByRole('button', { name: 'Down' }).click();
    const step1Script = page.getByRole('group', { name: 'Step 1' }).getByLabel('Script', { exact: true });
    const step2Script = page.getByRole('group', { name: 'Step 2' }).getByLabel('Script', { exact: true });
    await expect(step1Script).toHaveValue(String(idB));
    await expect(step2Script).toHaveValue(String(idA));

    await saveRunbook(page);
    await expect(page.getByRole('heading', { name: runbookTitle })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: /export markdown/i }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^runbook-\d+-r1\.md$/);
    const markdown = await readDownloadStream(await download.createReadStream());
    expect(markdown).toContain(bodyA);
    expect(markdown).toContain(bodyB);
    expect(markdown.indexOf(bodyA)).toBeGreaterThan(markdown.indexOf(bodyB));
  });
});

test.describe('T-XSS-1 literal rendering + CSP', () => {
  test('hostile title and body render literally and no dialog fires', async ({ page }) => {
    const run = `t003-xss-${Date.now()}`;
    const payload = '<img src=x onerror=alert(1)></code><script>alert(1)</script>';
    const body = `#!/bin/bash\n# <script>alert(1)</script>\n# <img src=x onerror=alert(1)>\n`;

    let dialogSeen = false;
    page.on('dialog', async (dialog) => {
      dialogSeen = true;
      await dialog.dismiss();
    });

    await gotoChecked(page, '/scripts/new');
    await page.getByLabel('Title').fill(payload);
    await page.getByLabel('Script content').fill(body);
    await page.getByLabel('Language').selectOption('bash');

    const detailResponsePromise = page.waitForResponse(
      (res) => /\/scripts\/\d+$/.test(res.url()) && res.request().method() === 'GET'
    );
    await saveScript(page);
    const detail = await detailResponsePromise;
    expect(detail.headers()['content-security-policy']).toContain("default-src 'none'");
    expect(detail.headers()['content-security-policy']).toContain("script-src 'self'");
    expect(detail.headers()['x-content-type-options']).toBe('nosniff');

    await expect(page.getByRole('heading', { name: payload })).toBeVisible();
    const code = page.locator('pre code');
    await expect(code).toContainText('<script>alert(1)</script>');
    await expect(code).toContainText('<img src=x onerror=alert(1)>');

    await page.waitForTimeout(750);
    expect(dialogSeen, 'no alert dialog may fire').toBe(false);
  });
});

test.describe('T-CONC-3 two-tab edit conflict', () => {
  test('second tab save returns 409 with edits preserved and a link to the current revision', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'two-tab conflict journey runs on the desktop project');
    const run = `t003-conc-${Date.now()}`;
    const title = `Conflict ${run}`;

    await gotoChecked(page, '/scripts/new');
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Script content').fill('echo one\n');
    await page.getByLabel('Language').selectOption('bash');
    await saveScript(page);
    const detailUrl = page.url();
    expect(detailUrl).toMatch(/\/scripts\/\d+$/);

    const tabA = await page.context().newPage();
    const tabB = await page.context().newPage();
    await tabA.goto(`${detailUrl}/edit`);
    await tabB.goto(`${detailUrl}/edit`);

    await tabA.getByLabel('Script content').fill('echo saved by tab A\n');
    await Promise.all([
      tabA.waitForURL(detailUrl),
      tabA.getByRole('button', { name: /save/i }).click(),
    ]);

    await tabB.getByLabel('Script content').fill('echo kept from tab B\n');
    const conflictResponsePromise = tabB.waitForResponse(
      (res) => res.request().method() === 'POST' && /\/scripts\/\d+$/.test(res.url())
    );
    await tabB.getByRole('button', { name: /save/i }).click();
    expect((await conflictResponsePromise).status()).toBe(409);

    await expect(tabB.getByText(/Not saved/)).toBeVisible();
    await expect(tabB.getByLabel('Script content')).toHaveValue(/echo kept from tab B/);
    const currentLink = tabB.locator('a[href^="/scripts/"]').first();
    await expect(currentLink).toBeVisible();

    await page.reload();
    await expect(page.locator('pre code')).toContainText('echo saved by tab A');
  });
});

test.describe('T-UI-1 mobile usability', () => {
  test('list, detail and step editor usable on a mobile viewport with no page-level horizontal scroll', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'mobile journey runs only in the mobile project');
    const run = `t003-ui-${Date.now()}`;

    await gotoChecked(page, '/scripts');
    await expect(page.getByRole('navigation')).toBeVisible();
    await assertNoPageHorizontalScroll(page);

    await gotoChecked(page, '/scripts/new');
    await page.getByLabel('Title').fill(`Mobile ${run}`);
    await page.getByLabel('Script content').fill('#!/bin/bash\necho mobile\n');
    await page.getByLabel('Language').selectOption('bash');
    await saveScript(page);
    await expect(page.locator('pre code')).toContainText('echo mobile');
    await assertNoPageHorizontalScroll(page);

    await gotoChecked(page, '/runbooks/new');
    await page.getByLabel('Title').fill(`Mobile runbook ${run}`);
    const stepGroup = page.getByRole('group', { name: 'Step 1' });
    await stepGroup.getByLabel('Instruction', { exact: true }).fill('mobile step');
    await assertNoPageHorizontalScroll(page);
  });
});
