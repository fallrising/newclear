import { spawnSync } from 'node:child_process'

// A fresh production demo build is mandatory; do not benchmark a stale dist.
for (const args of [['build', '--mode', 'demo'], ['exec', 'playwright', 'test', '--config', 'playwright.performance.config.ts']]) {
  const result = spawnSync('pnpm', args, { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
