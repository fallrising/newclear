import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpus, platform, release, arch, totalmem } from 'node:os'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'
import type { runQueryBenchmark } from '../scripts/benchmark-query'

const p95 = (samples: number[]) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1]
const metadata = () => ({
  testedCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  trackedDiffSha256: createHash('sha256').update(execFileSync('git', ['diff', 'HEAD', '--', 'src', 'vite.config.ts'])).digest('hex'),
  runtime: process.version, os: `${platform()} ${release()} ${arch()}`,
  benchmarkSources: Object.fromEntries(['scripts/benchmark.mjs', 'scripts/benchmark-query.ts', 'e2e/m5-performance.spec.ts', 'playwright.performance.config.ts'].map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])),
  cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(),
  viewport: { width: 1440, height: 900 }, networkThrottle: 'none',
})

test('AC-27: five isolated cold LCP navigations and all necessary initial JS', async ({ browser, baseURL }, testInfo) => {
  const observations: { index: number; lcpMs: number; lcpEntries: unknown[]; scripts: { path: string; bytes: number; gzipBytes: number }[]; gzipBytes: number; errors: string[] }[] = []
  for (let index = 0; index < 5; index += 1) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const errors: string[] = []
    const scripts = new Set<string>()
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`))
    page.on('response', response => {
      if (!response.ok()) errors.push(`${response.status()} ${response.url()}`)
      if (new URL(response.url()).pathname.endsWith('.js')) scripts.add(new URL(response.url()).pathname)
    })
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await context.addInitScript(() => {
      const entries: { startTime: number; size: number; element: string }[] = []
      Object.assign(window, { benchmarkLcpEntries: entries })
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          const lcp = entry as PerformanceEntry & { size: number; element?: Element }
          entries.push({ startTime: lcp.startTime, size: lcp.size, element: lcp.element?.outerHTML.slice(0, 500) ?? '' })
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true })
    })
    try {
      await page.goto(baseURL!)
      await expect(page.getByRole('heading', { name: '事件與待辦' })).toBeVisible()
      await page.waitForLoadState('networkidle')
      const workerUrls = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations())
        .map(registration => registration.active?.scriptURL).filter((url): url is string => Boolean(url)))
      for (const url of workerUrls) scripts.add(new URL(url).pathname)
      const entries = await page.evaluate(() => (window as unknown as { benchmarkLcpEntries: { startTime: number; size: number; element: string }[] }).benchmarkLcpEntries)
      // Include static imports, modulepreloads, awaited demo boot, route imports,
      // and the actual registered worker once each. Never count only index.js.
      const assets = [...scripts].sort().map(path => {
        const relative = path.slice(new URL(baseURL!).pathname.length)
        if (relative.startsWith('..') || !relative.endsWith('.js')) throw new Error(`Unexpected script path ${path}`)
        const bytes = readFileSync(resolve('dist', relative))
        return { path, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, sha256: createHash('sha256').update(bytes).digest('hex') }
      })
      observations.push({ index, lcpMs: entries.at(-1)?.startTime ?? 0, lcpEntries: entries,
        scripts: assets, gzipBytes: assets.reduce((total, asset) => total + asset.gzipBytes, 0), errors })
      await page.screenshot({ path: testInfo.outputPath(`cold-${index + 1}.png`) })
    } finally { await context.close() }
  }
  const medianLcpMs = observations.map(sample => sample.lcpMs).sort((a, b) => a - b)[2]
  await testInfo.attach('initial-route-and-lcp.json', { contentType: 'application/json', body: JSON.stringify({
    ...metadata(), browser: browser.version(), coldIsolation: 'new context and empty storage/cache/SW per sample; CDP cache disabled',
    cpuThrottle: 4, gzipAlgorithm: 'Node gzipSync default level 6; per-file sum, unique paths including MSW',
    samples: observations, medianLcpMs,
  }, null, 2) })
  expect(observations).toHaveLength(5)
  for (const observation of observations) {
    expect(observation.errors).toEqual([])
    expect(observation.lcpMs).toBeGreaterThan(0)
    expect(observation.gzipBytes).toBeLessThanOrEqual(300 * 1024)
  }
  expect(medianLcpMs).toBeLessThanOrEqual(2500)
})

test('AC-27: 100 real filtered and sorted engine reads of 5,000 CIs', async ({ browser }, testInfo) => {
  const result = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: true,
    lib: { entry: resolve('scripts/benchmark-query.ts'), formats: ['iife'], name: 'DimGateQueryBenchmark' } } })
  const output = Array.isArray(result) ? result[0] : result
  if (!('output' in output)) throw new Error('Benchmark compilation did not produce chunks')
  const code = output.output.find(item => item.type === 'chunk')
  if (!code || code.type !== 'chunk') throw new Error('Benchmark browser module missing')
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  try {
    const page = await context.newPage()
    await page.addScriptTag({ content: code.code })
    const result = await page.evaluate(() => (window as unknown as { DimGateQueryBenchmark: { runQueryBenchmark: typeof runQueryBenchmark } }).DimGateQueryBenchmark.runQueryBenchmark())
    await testInfo.attach('engine-query.json', { contentType: 'application/json', body: JSON.stringify({ ...metadata(), browser: browser.version(), ...result }, null, 2) })
    expect(result.count).toBe(5_000)
    expect(result.samples).toHaveLength(100)
    expect(result.p95Ms).toBeLessThanOrEqual(150)
  } finally { await context.close() }
})

test('AC-27: 100 successful persisted safe HTTP commands including 150 ms mock latency', async ({ page, browser, baseURL }, testInfo) => {
  await page.goto(baseURL!)
  await expect(page.getByRole('heading', { name: '事件與待辦' })).toBeVisible()
  const result = await page.evaluate(async () => {
    type Saved = { personaId: string; snapshot: { sessionId: string; commandCount: number; logicalClock: number; storeRevision: number; audit: unknown[]; events: unknown[]; idempotency: unknown[] } }
    const read = () => JSON.parse(sessionStorage.getItem('dim-gate.demo.v1')!) as Saved
    const before = read()
    const samples: { index: number; durationMs: number; status: number; receipt: unknown }[] = []
    for (let index = 0; index < 100; index += 1) {
      const started = performance.now()
      const response = await fetch(new URL('__demo/v1/clock/advance', document.baseURI), { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Demo-Persona': before.personaId,
          'X-Demo-Session': before.snapshot.sessionId, 'Idempotency-Key': `benchmark-safe-clock-${index}` },
        body: JSON.stringify({ ticks: 1 }) })
      const receipt: unknown = await response.json()
      samples.push({ index, durationMs: performance.now() - started, status: response.status, receipt })
    }
    const after = read()
    return { samples, before: before.snapshot, after: after.snapshot,
      persistedBytes: new TextEncoder().encode(sessionStorage.getItem('dim-gate.demo.v1')!).length }
  })
  const p95Ms = p95(result.samples.map(sample => sample.durationMs))
  await testInfo.attach('http-mutation.json', { contentType: 'application/json', body: JSON.stringify({ ...metadata(), browser: browser.version(),
    cpuThrottle: 1, delayMs: 150, command: 'POST /__demo/v1/clock/advance {ticks:1}; baseline with no queued jobs; unique key for each command',
    p95Ms, ...result }, null, 2) })
  expect(result.samples).toHaveLength(100)
  expect(result.samples.every(sample => sample.status === 200)).toBe(true)
  expect(result.after.commandCount - result.before.commandCount).toBe(100)
  expect(result.after.logicalClock - result.before.logicalClock).toBe(100)
  for (const key of ['events', 'audit', 'idempotency'] as const) expect(result.after[key].length - result.before[key].length).toBe(100)
  expect(p95Ms).toBeLessThanOrEqual(500)
})
