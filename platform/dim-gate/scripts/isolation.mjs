import { spawnSync } from 'node:child_process'

for (const args of [
  ['exec', 'vite', 'build', '--mode', 'demo', '--outDir', 'dist/isolation-demo'],
  ['exec', 'vite', 'build', '--mode', 'live', '--outDir', 'dist/isolation-live'],
  ['exec', 'playwright', 'test', '--config', 'playwright.isolation.config.ts'],
]) {
  const result = spawnSync('pnpm', args, { stdio: 'inherit', env: { ...process.env, ...(args.includes('--mode') ? { VITE_DATA_MODE: args[args.indexOf('--mode') + 1] } : {}) } })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
