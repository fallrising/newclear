'use strict';
// Optional test tooling only: use an existing Playwright Core and Chromium install.
// Run through agent-workspace; raw observations and screenshots stay private.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const source = path.resolve(__dirname, '..');
const evidence = process.env.AGENT_EVIDENCE_DIR && path.join(process.env.AGENT_EVIDENCE_DIR, 'run-' + Date.now());
const build = process.env.AGENT_BUILD_DIR;
assert.ok(evidence && build, 'Run through agent-workspace');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}
async function until(check, message) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await delay(100); }
  throw new Error(message);
}
async function main() {
  fs.mkdirSync(evidence, { recursive: true });
  if (process.env.BROWSER_FONT_DIR) {
    const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const fontConfig = path.join(build, 'fonts.conf');
    fs.writeFileSync(fontConfig, '<fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include><dir>' + xml(process.env.BROWSER_FONT_DIR) + '</dir><cachedir>' + xml(path.join(build, 'font-cache')) + '</cachedir></fontconfig>');
    process.env.FONTCONFIG_FILE = fontConfig;
  }
  const versionFiles = ['go.mod', 'main.go', 'fingerprint.go', 'fingerprint_schema.go', 'analyze-observations.cjs', ...fs.readdirSync(path.join(source, 'public')).map(name => 'public/' + name)];
  const sourceHashes = () => Object.fromEntries(versionFiles.map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(source, name))).digest('hex')]));
  const hashes = sourceHashes();
  fs.writeFileSync(path.join(evidence, 'source-sha256.json'), JSON.stringify(hashes, null, 2) + '\n');
  const binary = path.join(build, 'daylight-server');
  const compile = spawnSync(process.env.GO_BINARY || 'go', ['build', '-o', binary, '.'], { cwd: source, encoding: 'utf8' });
  fs.writeFileSync(path.join(evidence, 'build.log'), compile.stdout + compile.stderr);
  assert.equal(compile.status, 0, compile.stderr);
  // Chromium's Unix-domain socket has a 108-byte path limit. Only this short
  // symlink lives in /tmp; all profile/socket data remains in the disk workspace.
  const originalTmp = os.tmpdir();
  const shortTmp = '/tmp/daylight-' + crypto.randomBytes(6).toString('hex');
  fs.symlinkSync(originalTmp, shortTmp);
  process.env.TMPDIR = shortTmp;
  let browser;
  try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true, args: ['--no-sandbox'] }); }
  catch (error) { process.env.TMPDIR = originalTmp; fs.unlinkSync(shortTmp); throw error; }
  const results = { browser: browser.version(), journeys: [] };
  try {
    for (const mode of ['normal', 'events-fail', 'fingerprints-fail']) {
      const root = path.join(evidence, mode);
      fs.mkdirSync(root, { recursive: true });
      fs.cpSync(path.join(source, 'public'), path.join(root, 'public'), { recursive: true });
      fs.copyFileSync(path.join(source, 'analyze-observations.cjs'), path.join(root, 'analyze-observations.cjs'));
      const logs = path.join(root, 'observations'); fs.mkdirSync(logs);
      if (mode !== 'normal') fs.symlinkSync('/dev/full', path.join(logs, mode.split('-')[0] + '.jsonl'));
      const port = await freePort(); const base = `http://127.0.0.1:${port}`;
      const output = fs.openSync(path.join(root, 'server.log'), 'w');
      const server = spawn(binary, [], { cwd: root, env: { ...process.env, PORT: String(port), LOG_DIR: logs, DEMO_RUN_ID: mode }, stdio: ['ignore', output, output] });
      fs.closeSync(output);
      let context;
      try {
        await until(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } }, 'server startup');
        context = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
        const page = await context.newPage();
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.goto(base + '/?sample=' + mode);
        await page.waitForFunction(() => document.querySelector('#task-list').getAttribute('aria-busy') === 'false');
        await page.evaluate(() => window.daylightObservation.ready);
        await page.click('#start-tutorial');
        const step = n => page.waitForFunction(n => document.querySelector('#tutorial-title').textContent.startsWith(n + ' / 5'), n);
        const tasks = async () => (await (await context.request.get(base + '/api/tasks')).json()).tasks;
        const initial = (await tasks()).length; assert.equal(initial, 6);
        await page.click('#add-task'); await page.fill('#task-title', '驗收任務'); await page.click('#save-task'); await step(2);
        let task = (await tasks()).find(row => row.title === '驗收任務'); assert.ok(task); const taskId = task.id;
        await page.getByRole('button', { name: '編輯任務：驗收任務', exact: true }).click();
        await page.fill('#task-title', '驗收任務修改'); await page.selectOption('#task-priority', 'high'); await page.click('#save-task'); await step(3);
        task = (await tasks()).find(row => row.id === taskId); assert.equal(task.title, '驗收任務修改'); assert.equal(task.priority, 'high');
        await page.getByRole('button', { name: '完成任務：驗收任務修改', exact: true }).click(); await step(4);
        assert.equal((await tasks()).find(row => row.id === taskId).completed, true);
        await page.click('[data-filter="pending"]');
        await page.fill('#search', '驗收任務');
        await page.waitForTimeout(700);
        assert.equal(await page.locator('.task-row').count(), 0);
        assert.ok((await page.locator('#tutorial-title').textContent()).startsWith('4 / 5'));
        await page.click('[data-filter="all"]');
        await page.fill('#search', '驗收任務修改'); await step(5);
        assert.equal(await page.locator('.task-row').count(), 1);
        await page.getByRole('button', { name: '刪除任務：驗收任務修改', exact: true }).click(); await page.click('#confirm-delete');
        const expected = mode === 'normal' ? '觀測與事件已寫入實驗日誌' : '不需要重做已成功的操作';
        await page.waitForFunction(text => document.querySelector('#tutorial-instruction').textContent.includes(text), expected);
        const final = await tasks(); assert.equal(final.length, initial); assert.ok(!final.some(row => row.id === taskId));
        assert.equal(await page.locator('#error-box').isVisible(), false);
        assert.deepEqual(errors, []);
        await page.screenshot({ path: path.join(root, 'completed.png'), fullPage: true });
        const status = await page.locator('#tutorial-instruction').textContent();
        const denied = [];
        for (const route of ['/observations/requests.jsonl', '/.runtime/observations/events.jsonl', '/fingerprints.jsonl', '/api/logs', '/api/events', '/%2e%2e%2fobservations/requests.jsonl']) {
          const response = await context.request.get(base + route);
          assert.ok([403, 404, 405].includes(response.status()), route + ': ' + response.status());
          denied.push({ route, status: response.status() });
        }
        const entry = { mode, fiveSteps: true, serverCRUD: true, status, denied, browserErrors: errors };
        if (mode === 'normal') {
          await until(() => fs.readFileSync(path.join(logs, 'events.jsonl'), 'utf8').includes('tutorial_complete'), 'complete log');
          const analyzed = spawnSync(process.execPath, [path.join(root, 'analyze-observations.cjs'), '--log-dir', logs, '--sample', mode], { encoding: 'utf8' });
          fs.writeFileSync(path.join(root, 'analyzer.log'), analyzed.stdout + analyzed.stderr);
          assert.equal(analyzed.status, 0, analyzed.stderr);
          const analysis = JSON.parse(fs.readFileSync(path.join(logs, 'analysis.json')));
          assert.equal(analysis.tutorials.length, 1); assert.equal(analysis.tutorials[0].completed, true);
          assert.equal(analysis.tutorials[0].stepsMatchExpected, true);
          assert.equal(analysis.crud.matchesExpectedMutationCounts, true); assert.equal(analysis.crud.allMutationsSucceeded, true);
          assert.equal(analysis.fingerprints.sessionCount, 1);
          assert.ok(Object.values(analysis.parseErrors).every(rows => rows.length === 0));
          const events = fs.readFileSync(path.join(logs, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
          const steps = events.filter(row => row.type === 'tutorial_step'); assert.equal(steps.length, 5);
          assert.ok(steps.every(row => row.details.taskId === taskId));
          const fingerprints = fs.readFileSync(path.join(logs, 'fingerprints.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
          assert.equal(fingerprints.length, 1);
          assert.ok(events.every(row => row.sessionId === fingerprints[0].sessionId && row.fingerprintId === fingerprints[0].fingerprintId && row.runId === 'normal'));
          for (const name of ['requests','events','fingerprints']) assert.ok(!fs.readFileSync(path.join(logs, name + '.jsonl'), 'utf8').includes('驗收任務'));
          entry.analysis = { steps: 5, events: events.length, fingerprints: 1, mutations: analysis.crud.observedMutationCounts, sameSessionRunFingerprint: true, taskTextExcluded: true };
        } else {
          assert.match(fs.readFileSync(path.join(root, 'server.log'), 'utf8'), /no space left on device/);
          entry.realWriteFailure = true;
        }
        results.journeys.push(entry);
      } finally {
        if (context) await context.close();
        server.kill('SIGTERM');
        await Promise.race([once(server, 'exit'), delay(6000).then(() => { if (server.exitCode === null) server.kill('SIGKILL'); })]);
      }
    }
    assert.deepEqual(sourceHashes(), hashes, 'source changed during browser run');
    results.sourceHashes = hashes;
    fs.writeFileSync(path.join(evidence, 'browser-results.json'), JSON.stringify(results, null, 2) + '\n');
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); process.env.TMPDIR = originalTmp; fs.unlinkSync(shortTmp); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
