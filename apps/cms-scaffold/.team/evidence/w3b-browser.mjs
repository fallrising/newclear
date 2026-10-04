// Run from the component root with the Front mock server running; fixtures contain only synthetic data.
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const fixture = JSON.parse(await readFile('docs/v2/contracts/fixtures/member-entries.json', 'utf8'));
const out = '.team/evidence/w3b-browser';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const records = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Taipei', reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(fixture.clock));
    const errors = [];
    page.on('pageerror', error => errors.push({ kind: 'pageerror', message: error.message }));
    page.on('console', message => { if (message.type() === 'error') errors.push({ kind: 'console', message: message.text() }); });
    page.on('requestfailed', request => errors.push({ kind: 'requestfailed', path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
    page.on('response', response => { if (response.status() >= 400) errors.push({ kind: 'http', status: response.status(), path: new URL(response.url()).pathname }); });
    for (const [name, path, scenario, user, expectedStatus] of [
      ['dashboard', '/clinic/me', 'none', 'seed-member-clinic', 0],
      ['pets-empty', '/clinic/me', 'memberPetsEmpty', 'seed-member-clinic', 0],
      ['appointments-empty', '/clinic/me', 'memberAppointmentsEmpty', 'seed-member-clinic', 0],
      ['detail', `/clinic/appointments/${fixture.members[0].appointmentRequests[0].id}`, 'none', 'seed-member-clinic', 0],
      ['forbidden', `/clinic/appointments/${fixture.members[0].appointmentRequests[0].id}`, 'none', 'seed-member-projects', 403],
      ['new', '/clinic/appointments/new', 'none', 'seed-member-clinic', 0],
      ['validation', '/clinic/appointments/new', 'none', 'seed-member-clinic', 0],
      ['rate-limited', '/clinic/appointments/new', 'rateLimited', 'seed-member-clinic', 429],
      ['member-menu', '/clinic/me', 'none', 'seed-member-clinic', 0],
    ]) {
      errors.length = 0;
      await page.goto(`http://localhost:5173${path}?mock=${scenario}&mockUser=${user}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByTestId('query-loading')).toHaveCount(0);
      if (name === 'validation') {
        await page.getByTestId('appointment-submit').click();
        await expect(page.getByText('請選擇未來的日期與時間。', { exact: true })).toBeVisible();
      }
      if (name === 'rate-limited') {
        await page.getByTestId('appointment-preferred-at').fill('2026-10-20T09:30');
        await page.getByTestId('appointment-reason').fill('皮膚搔癢');
        await page.getByTestId('appointment-submit').click();
        await expect(page.getByTestId('appointment-form-alert')).toContainText('送出次數過多，請稍後再試。');
      }
      if (name === 'member-menu') {
        await page.getByRole('button', { name: fixture.members[0].principal.displayName, exact: true }).click();
        await expect(page.getByRole('menu')).toBeVisible();
      }
      const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, title: document.title }));
      const png = `${width}-${name}.png`;
      await page.screenshot({ path: `${out}/${png}`, fullPage: true, animations: 'disabled' });
      const intentional = errors.filter(e => expectedStatus && ((e.kind === 'http' && e.status === expectedStatus && e.path.startsWith('/api/v1/me/')) || (e.kind === 'console' && e.message.includes(String(expectedStatus)) && e.message.includes('Failed to load resource'))));
      const unexpected = errors.filter(e => !intentional.includes(e));
      const record = { name, viewport: { width, height: 900 }, layout, png, expectedStatus, intentionalResponses: intentional, unexpected, overflow: layout.scrollWidth > layout.width };
      records.push(record);
      console.log(JSON.stringify({ name, width, unexpected: unexpected.length, overflow: record.overflow }));
    }
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(`${out}/summary.json`, JSON.stringify({ captures: records.length, blocking: records.filter(r => r.unexpected.length || r.overflow).length, records }, null, 2) + '\n');
if (records.some(r => r.unexpected.length || r.overflow)) process.exitCode = 2;
