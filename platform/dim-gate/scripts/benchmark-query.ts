import { createSeed } from '../src/demo/seed'
import { createEngine } from '../src/domain/engine'
import type { CI, Page } from '../src/domain/schemas'

// Independent read-only memory profile: baseline 60 CIs, then deterministic
// provider-preserving clones with unique canonical identities up to 5,000.
// Existing references remain intact; capacity is explicitly enlarged for this
// synthetic profile. No benchmark snapshot is written to application storage.
export function runQueryBenchmark() {
  const profile = createSeed('benchmark-readonly-5000')
  const baseline = [...profile.entities.cis]
  for (let index = baseline.length; index < 5_000; index += 1) {
    const original = baseline[index % baseline.length]
    const serial = String(index).padStart(5, '0')
    profile.entities.cis.push({ ...structuredClone(original), id: `benchmark-ci-${serial}`,
      name: `benchmark-${original.provider}-${serial}`, externalId: `benchmark-external-${serial}`,
      ...(original.provider === 'onprem' && original.kind === 'compute'
        ? { attributes: { ...original.attributes, assetTag: `benchmark-asset-${serial}`, serialRef: `benchmark-serial-${serial}` } } : {}) })
  }
  for (const pool of profile.entities.pools) {
    pool.cpuCapacity = 100_000
    pool.memoryCapacityMiB = 100_000_000
  }
  let persisted = false
  const engine = createEngine(profile, () => { persisted = true; throw new Error('Read-only profile attempted persistence') })
  const before = JSON.stringify(engine.getSnapshot())
  const samples: { index: number; query: string; durationMs: number; total: number; ids: string[] }[] = []
  for (let index = 0; index < 100; index += 1) {
    const query = new URLSearchParams({ provider: ['aws', 'aliyun', 'onprem'][index % 3],
      q: index % 2 ? 'benchmark' : '', health: ['healthy', 'degraded', 'unknown'][Math.floor(index / 3) % 3],
      sort: ['name', 'id', 'health', 'updatedAt'][index % 4], order: index % 2 ? 'asc' : 'desc',
      page: String(index % 5 + 1), pageSize: '25' })
    const start = performance.now()
    const result = engine.read('/cis', query, 'user-ops') as Page<CI>
    const durationMs = performance.now() - start
    if (result.total === 0 || result.items.length === 0) throw new Error(`Empty synthetic query ${index}: ${query}`)
    samples.push({ index, query: query.toString(), durationMs, total: result.total, ids: result.items.map(ci => ci.id) })
  }
  if (persisted || before !== JSON.stringify(engine.getSnapshot())) throw new Error('Read-only benchmark mutated its profile')
  return { count: profile.entities.cis.length, profile: 'baseline 60 plus 4,940 deterministic provider-preserving clones; enlarged pool capacities; read-only memory',
    cpuThrottle: 1, httpDelay: 'excluded: direct production engine.read', warmupSamples: 0, samples,
    p95Ms: samples.map(sample => sample.durationMs).sort((a, b) => a - b)[94] }
}
