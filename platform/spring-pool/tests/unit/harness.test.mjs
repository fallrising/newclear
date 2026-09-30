import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  chmod,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";

async function freePort() {
  const server = net.createServer();
  await new Promise((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  const port = server.address().port;
  await new Promise((yes) => server.close(yes));
  return port;
}
for (const scenario of ["crash", "startup-signal", "stubborn-child"]) {
  test(`local harness handles ${scenario}`, { timeout: 15000 }, async () => {
    const fixture = await mkdtemp(join(tmpdir(), "spring-pool-harness-"));
    let child;
    try {
      await mkdir(join(fixture, "scripts"));
      await mkdir(join(fixture, "node_modules/.bin"), { recursive: true });
      await copyFile(
        new URL("../../scripts/local-test.mjs", import.meta.url),
        join(fixture, "scripts/local-test.mjs"),
      );
      // A controlled child process tests lifecycle handling; this does not verify Workers/D1.
      const stub = join(fixture, "node_modules/.bin/wrangler");
      await writeFile(
        stub,
        `#!/usr/bin/env node
const http = require('node:http');
const args = process.argv.slice(2);
if (args[0] === 'd1') process.exit(0);
const port = Number(args[args.indexOf('--port') + 1]);
const isWeb = args.includes('web/wrangler.jsonc');
if (process.env.SP_SCENARIO === 'startup-signal' && !isWeb) process.kill(process.pid, 'SIGKILL');
if (process.env.SP_SCENARIO === 'stubborn-child' && !isWeb) process.on('SIGTERM', () => {});
const server = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'application/json'); res.end('{"status":"ok"}');
  if (isWeb) setTimeout(() => process.exit(23), 150);
});
server.listen(port, '127.0.0.1');
`,
      );
      await chmod(stub, 0o700);
      const api = await freePort();
      const web = await freePort();
      child = spawn(
        process.execPath,
        [join(fixture, "scripts/local-test.mjs"), "serve"],
        {
          env: {
            ...process.env,
            SP_SCENARIO: scenario,
            SP_API_PORT: String(api),
            SP_WEB_PORT: String(web),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.on("data", (data) => {
        output += data;
      });
      child.stderr.on("data", (data) => {
        output += data;
      });
      const result = await new Promise((yes, no) => {
        child.once("error", no);
        child.once("exit", (code, signal) => yes({ code, signal }));
      });
      assert.notEqual(result.code, 0, `worker exit 23 was masked: ${output}`);
      assert.match(
        output,
        scenario === "startup-signal" ? /worker.*SIGKILL/i : /worker.*23/i,
      );
      await Promise.all(
        [api, web].map(async (port) => {
          const server = net.createServer();
          await new Promise((yes, no) => {
            server.once("error", no);
            server.listen(port, "127.0.0.1", yes);
          });
          await new Promise((yes) => server.close(yes));
        }),
      );
    } finally {
      if (child && child.exitCode === null) child.kill("SIGTERM");
      await rm(fixture, { recursive: true, force: true });
    }
  });
}
