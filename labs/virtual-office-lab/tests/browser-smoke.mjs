import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {preview} from '../bin/office-preview.mjs';
const chrome = process.env.OFFICE_CHROME;
if (!chrome) throw new Error('set OFFICE_CHROME to a local Chrome/Chromium executable');
const dir = await mkdtemp(join(tmpdir(), 'office-browser-'));
const fixture = {schemaVersion: 1, mode: 'demo', simulated: true, bots: [{id: 'sample', name: '<img src=x onerror=alert(1)>', role: '測試', summary: '固定摘要', seat: 'director', status: 'idle', reportedStatus: 'error', stale: true, alert: true, collaborators: []}]};
const backend = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(fixture)); });
await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
const server = preview(`http://127.0.0.1:${backend.address().port}`);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let child;
try {
  child = spawn(chrome, ['--headless', '--disable-gpu', '--no-first-run', `--user-data-dir=${dir}`, '--dump-dom', '--virtual-time-budget=3000', `http://127.0.0.1:${server.address().port}`], {stdio: ['ignore', 'pipe', 'ignore']});
  let html = ''; child.stdout.on('data', chunk => { html += chunk; });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 20000);
  let code;
  try { code = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); }); }
  finally { clearTimeout(timeout); }
  assert.equal(code, 0);
  assert.match(html, /模擬資料/); assert.match(html, /資料過期/); assert.match(html, /出錯/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img\s/); assert.match(html, /上次成功：/);
  console.log('PASS: real Chrome renders demo/stale/error and untrusted name as text');
} finally {
  child?.kill('SIGKILL'); server.closeAllConnections(); backend.closeAllConnections();
  await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => backend.close(resolve))]);
  await rm(dir, {recursive: true, force: true});
}
