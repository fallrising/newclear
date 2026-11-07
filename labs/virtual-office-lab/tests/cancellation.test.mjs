import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {run} from '../bin/office-run.mjs';

for (const [signal, expected, stubborn] of [['SIGINT', 130, false], ['SIGTERM', 143, false], ['SIGTERM', 143, true]]) {
  test(`real cancellation ${signal}, ignores signal=${stubborn}`, {timeout: 15000, skip: process.platform === 'win32'}, async () => {
    const childCode = `process.on('${signal}', () => { ${stubborn ? '' : 'process.exit(0)'} }); console.log('READY'); setInterval(() => {}, 1000);`;
    const moduleUrl = new URL('../bin/office-run.mjs', import.meta.url).href;
    const script = `import {run} from ${JSON.stringify(moduleUrl)};
      const result = await run(['content','--',process.execPath,'-e',${JSON.stringify(childCode)}], process.env,
        async args => console.log('STATUS:' + args[1]));
      console.log('RESULT:' + JSON.stringify(result)); process.exitCode = result.exitCode;`;
    const wrapper = spawn(process.execPath, ['--input-type=module', '-e', script], {stdio: ['ignore', 'pipe', 'pipe']});
    let output = ''; let sent = false;
    wrapper.stdout.on('data', chunk => {
      output += chunk;
      if (!sent && output.includes('READY')) { sent = true; wrapper.kill(signal); }
    });
    const timeout = setTimeout(() => wrapper.kill('SIGKILL'), 12000);
    try {
      const code = await new Promise((resolve, reject) => { wrapper.once('error', reject); wrapper.once('exit', resolve); });
      assert.equal(sent, true);
      assert.equal(code, expected);
      assert.match(output, /STATUS:terminal/);
      assert.match(output, /STATUS:error/);
      assert.doesNotMatch(output, /STATUS:done/);
      assert.match(output, /"reported":true/);
    } finally { clearTimeout(timeout); wrapper.kill('SIGKILL'); }
  });
}
test('normal completion removes signal listeners', async () => {
  const before = ['SIGINT', 'SIGTERM'].map(s => process.listenerCount(s));
  await run(['content', '--', process.execPath, '-e', ''], process.env, async () => {});
  assert.deepEqual(['SIGINT', 'SIGTERM'].map(s => process.listenerCount(s)), before);
});
