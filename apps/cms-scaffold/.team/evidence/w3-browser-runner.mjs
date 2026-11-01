import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
const tool = process.argv[2];
if (!tool) throw new Error('Pass the codex-ui-evidence browser-evidence.mjs path');
const probe = net.createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/clinic');
  await page.getByRole('heading', { name: 'Cedar Pet Clinic' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-testid="query-loading"]'));
  const proc = spawn(process.execPath, [tool, '--mode', 'browser', '--cdp-url', `http://localhost:${port}`, '--url', 'http://localhost:5173/clinic', '--output-dir', '.team/evidence/w3-browser/runner-clinic', '--viewport', '1440x900', '--viewport', '390x900'], { stdio: 'inherit' });
  const [code] = await once(proc, 'exit');
  process.exitCode = code;
} finally { await browser.close(); }
