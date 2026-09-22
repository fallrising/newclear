import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const path = new URL('../../../.github/workflows/dim-gate-ci.yml', import.meta.url)
const text = await readFile(path, 'utf8')
for (const required of ['pull_request:', 'branches: [main]', 'workflow_dispatch:', 'contents: read', 'timeout-minutes:', 'cancel-in-progress: true', 'persist-credentials: false', 'working-directory: platform/dim-gate', '.team/tasks/T-*.md', '.team/reports/T-*.md']) {
  assert(text.includes(required), `Missing workflow policy: ${required}`)
}
assert.equal((text.match(/- platform\/dim-gate\/\*\*/g) ?? []).length, 2, 'PR and main push must be path scoped')
assert.equal((text.match(/- \.github\/workflows\/dim-gate-ci\.yml/g) ?? []).length, 2, 'Workflow must validate its own changes')
for (const line of text.split('\n').filter(line => /uses:/.test(line))) {
  assert(/uses: [\w/-]+@[a-f0-9]{40}(?:\s|$)/.test(line), `Action is not pinned: ${line}`)
}
assert(!/secrets\.|pull_request_target:|packages: write|id-token: write/.test(text), 'Unexpected authority')
for (const gate of ['pnpm install --frozen-lockfile', 'pnpm lint', 'pnpm typecheck', 'pnpm test', 'pnpm check:docs', 'pnpm check:contracts', 'pnpm check:architecture', 'pnpm build --mode demo', 'pnpm test:e2e', 'pnpm test:smoke', 'pnpm benchmark', 'pnpm test:isolation']) {
  assert(text.includes(gate), `Missing native gate: ${gate}`)
}
console.log('dim-gate workflow scope, action pins, authority and native gates passed.')
