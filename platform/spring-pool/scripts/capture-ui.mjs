import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import net from "node:net";
import { mkdir, writeFile } from "node:fs/promises";

const web = process.env.SP_WEB_URL ?? "http://127.0.0.1:8817";
const api = process.env.SP_API_URL ?? "http://127.0.0.1:8818";
for (const value of [web, api]) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("UI evidence requires local loopback Workers");
}
const response = await fetch(`${api}/v1/scripts`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Spring-Pool-Actor": "owner@example.test",
  },
  body: JSON.stringify({
    title: "Database backup checklist",
    description:
      "Inspect the pinned revision before copying.\nRun manually in the intended environment.",
    tags: ["database", "ops"],
    language: "bash",
    body: '#!/usr/bin/env bash\nset -euo pipefail\nprintf "%s\\n" "Review target."\n',
  }),
});
if (response.status !== 201)
  throw new Error(`UI fixture failed: ${response.status}`);
const fixture = await response.json();
const server = net.createServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const browser = await chromium.launch({
  chromiumSandbox: true,
  args: [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
  ],
});
try {
  await browser.newPage();
  await mkdir("artifacts/ui", { recursive: true });
  await writeFile(
    "artifacts/ui/source.json",
    JSON.stringify(
      {
        fixture: fixture.id,
        chromiumSandbox: true,
        viewportWidths: [1440, 768, 390],
      },
      null,
      2,
    ),
  );
  for (const [name, path] of [
    ["list", "/scripts"],
    ["detail", `/scripts/${fixture.id}`],
    ["step-editor", "/runbooks/new"],
  ]) {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "scripts/browser-evidence.mjs",
          "--mode",
          "browser",
          "--url",
          `${web}${path}`,
          "--cdp-url",
          `http://127.0.0.1:${port}`,
          "--output-dir",
          `artifacts/ui/${name}`,
          "--viewport",
          "1440x900",
          "--viewport",
          "768x1024",
          "--viewport",
          "390x844",
        ],
        { stdio: "inherit", timeout: 60000 },
      );
      child.once("error", reject);
      child.once("exit", (code) => resolve(code));
    });
    if (code !== 0) throw new Error(`UI evidence ${name} exited ${code}`);
  }
} finally {
  await browser.close();
}
