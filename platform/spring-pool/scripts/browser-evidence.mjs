#!/usr/bin/env node
// Deterministic, dependency-free Chromium CDP evidence runner. Requires Node 24.
import fs from "node:fs/promises";
import { spawn } from "node:child_process";

const DEFAULT_VIEWPORTS = ["1440x900", "768x1024", "375x812"];
const usage =
  "browser-evidence.mjs --mode self-test | --mode browser --url URL --output-dir DIR [--viewport WxH] [--cdp-url URL] [--chromium PATH]";

function parseArgs(argv) {
  const out = { viewports: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    }
    if (!arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[++i];
    if (value === undefined) throw new Error(`missing value for --${key}`);
    if (key === "viewport") out.viewports.push(value);
    else out[key.replaceAll("-", "_")] = value;
  }
  return out;
}

function viewport(value) {
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match || Number(match[1]) < 1 || Number(match[2]) < 1)
    throw new Error(`invalid viewport: ${value}`);
  return { name: value, width: Number(match[1]), height: Number(match[2]) };
}

function findingsFromMetrics(metrics) {
  const findings = [];
  if (metrics.scrollWidth > metrics.innerWidth)
    findings.push({
      type: "document-overflow",
      severity: "blocking",
      detail: `${metrics.scrollWidth}px document width exceeds ${metrics.innerWidth}px viewport`,
    });
  for (const item of metrics.outsideViewport ?? [])
    findings.push({
      type: "outside-viewport",
      severity: "blocking",
      detail: item,
    });
  for (const item of metrics.smallTouchTargets ?? [])
    findings.push({
      type: "small-touch-target",
      severity: "advisory",
      detail: item,
    });
  return findings;
}

function selfTest() {
  const result = findingsFromMetrics({
    innerWidth: 375,
    scrollWidth: 400,
    outsideViewport: ["button#save"],
    smallTouchTargets: ["a#tiny"],
  });
  if (
    result.length !== 3 ||
    result.filter((f) => f.severity === "blocking").length !== 2 ||
    result[2].severity !== "advisory"
  )
    throw new Error("finding classification self-test failed");
  const clean = findingsFromMetrics({
    innerWidth: 375,
    scrollWidth: 375,
    outsideViewport: [],
    smallTouchTargets: ["a#tiny"],
  });
  if (clean.some((f) => f.severity === "blocking"))
    throw new Error("advisory self-test failed");
  console.log("browser evidence self-test passed");
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.events = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          msg.error
            ? p.reject(new Error(msg.error.message))
            : p.resolve(msg.result);
        }
      } else {
        (this.events.get(msg.method) ?? []).forEach((fn) => fn(msg.params));
      }
    });
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    this.events.set(method, [...(this.events.get(method) ?? []), fn]);
  }
  off(method, fn) {
    this.events.set(
      method,
      (this.events.get(method) ?? []).filter((candidate) => candidate !== fn),
    );
  }
  clearEvents() {
    this.events.clear();
  }
  waitFor(method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const onEvent = (params) => {
        clearTimeout(timer);
        this.off(method, onEvent);
        resolve(params);
      };
      const timer = setTimeout(() => {
        this.off(method, onEvent);
        reject(new Error(`timed out waiting for ${method}`));
      }, timeoutMs);
      this.on(method, onEvent);
    });
  }
}

async function openCdp(cdpUrl) {
  const httpUrl = cdpUrl.replace(/^ws:/, "http:").replace(/^wss:/, "https:");
  const response = await fetch(`${httpUrl}/json/list`);
  const pages = await response.json();
  const page = pages.find((item) => item.type === "page") ?? pages[0];
  if (!page?.webSocketDebuggerUrl)
    throw new Error("CDP returned no page websocket");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return { cdp: new CDP(ws), close: () => ws.close() };
}

async function launchChromium(path) {
  const chromium = path || process.env.CHROMIUM_PATH || "chromium";
  const child = spawn(
    chromium,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--remote-debugging-port=0",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let buffer = "";
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for Chromium CDP")),
      15000,
    );
    const onData = (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1].replace(/\/devtools\/browser\/.*/, ""));
      }
    };
    child.stderr.on("data", onData);
    child.stdout.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code) reject(new Error(`Chromium exited with ${code}`));
    });
  });
  const connection = await openCdp(endpoint);
  return { ...connection, child };
}

const METRICS_SCRIPT = `(() => { const visible = (e) => { const r=e.getBoundingClientRect(), s=getComputedStyle(e); return r.width>0 && r.height>0 && s.visibility !== 'hidden' && s.display !== 'none'; }; const outside=[]; const small=[]; for (const e of document.querySelectorAll('*')) { if (!visible(e)) continue; const r=e.getBoundingClientRect(); if (r.right > innerWidth + 1 || r.left < -1) { if (e.children.length === 0) outside.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')); } if ((e.matches('button,a,input,select,textarea,[role="button"]')) && (r.width < 44 || r.height < 44)) small.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')); } return { innerWidth, innerHeight: innerHeight, scrollWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0), scrollHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0), outsideViewport: [...new Set(outside)].slice(0, 100), smallTouchTargets: [...new Set(small)].slice(0, 100), title: document.title }; })()`;

async function capture(options) {
  if (!options.url || !options.output_dir)
    throw new Error("--url and --output-dir are required in browser mode");
  const views = (
    options.viewports.length ? options.viewports : DEFAULT_VIEWPORTS
  ).map(viewport);
  await fs.mkdir(options.output_dir, { recursive: true });
  const browser = options.cdp_url
    ? await openCdp(options.cdp_url)
    : await launchChromium(options.chromium);
  const { cdp } = browser;
  const summary = { url: options.url, viewports: [], blockingFindings: 0 };
  try {
    await cdp.call("Page.enable");
    await cdp.call("Runtime.enable");
    await cdp.call("Network.enable");
    for (const view of views) {
      cdp.clearEvents();
      const failedRequests = [],
        httpErrors = [],
        exceptions = [],
        consoleErrors = [],
        requestUrls = new Map();
      cdp.on("Runtime.exceptionThrown", (p) =>
        exceptions.push(p.exceptionDetails?.text || "browser exception"),
      );
      cdp.on("Runtime.consoleAPICalled", (p) => {
        if (["error", "assert"].includes(p.type))
          consoleErrors.push(
            p.args?.map((a) => a.value ?? a.description).join(" ") || p.type,
          );
      });
      cdp.on("Network.requestWillBeSent", (p) =>
        requestUrls.set(p.requestId, p.request.url),
      );
      cdp.on("Network.loadingFailed", (p) =>
        failedRequests.push({
          url: requestUrls.get(p.requestId) || p.requestId,
          error: p.errorText,
        }),
      );
      cdp.on("Network.responseReceived", (p) => {
        if (p.response.status >= 400)
          httpErrors.push({ url: p.response.url, status: p.response.status });
      });
      await cdp.call("Emulation.setDeviceMetricsOverride", {
        width: view.width,
        height: view.height,
        deviceScaleFactor: 1,
        mobile: view.width < 600,
      });
      const loaded = cdp.waitFor("Page.loadEventFired", 10000);
      const navigation = await cdp.call("Page.navigate", { url: options.url });
      if (navigation.errorText)
        throw new Error(`navigation failed: ${navigation.errorText}`);
      await loaded;
      await new Promise((resolve) => setTimeout(resolve, 250));
      const metricResult = await cdp.call("Runtime.evaluate", {
        expression: METRICS_SCRIPT,
        returnByValue: true,
      });
      const metrics = metricResult.result.value;
      const findings = findingsFromMetrics(metrics);
      exceptions.forEach((detail) =>
        findings.push({
          type: "browser-exception",
          severity: "blocking",
          detail,
        }),
      );
      consoleErrors.forEach((detail) =>
        findings.push({ type: "console-error", severity: "blocking", detail }),
      );
      failedRequests.forEach((detail) =>
        findings.push({ type: "failed-request", severity: "blocking", detail }),
      );
      httpErrors.forEach((detail) =>
        findings.push({
          type: "http-error-response",
          severity: "blocking",
          detail,
        }),
      );
      const image = await cdp.call("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
      });
      const stem = view.name;
      await fs.writeFile(
        `${options.output_dir}/${stem}.png`,
        Buffer.from(image.data, "base64"),
      );
      const record = { viewport: view, metrics, findings, url: options.url };
      await fs.writeFile(
        `${options.output_dir}/${stem}.json`,
        JSON.stringify(record, null, 2) + "\n",
      );
      summary.viewports.push({
        viewport: view,
        json: `${stem}.json`,
        png: `${stem}.png`,
        blockingFindings: findings.filter((f) => f.severity === "blocking")
          .length,
      });
      summary.blockingFindings += summary.viewports.at(-1).blockingFindings;
    }
    await fs.writeFile(
      `${options.output_dir}/summary.json`,
      JSON.stringify(summary, null, 2) + "\n",
    );
  } finally {
    await browser.close();
    if (browser.child) browser.child.kill();
  }
  return summary.blockingFindings ? 2 : 0;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "self-test") selfTest();
  else if (options.mode === "browser")
    process.exitCode = await capture(options);
  else throw new Error(`--mode must be self-test or browser\n${usage}`);
} catch (error) {
  console.error(`browser evidence operational failure: ${error.message}`);
  process.exitCode = 1;
}
