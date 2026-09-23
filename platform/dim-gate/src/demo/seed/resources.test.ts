import { describe, expect, it } from 'vitest'
import { createEngine } from '../../domain/engine'
import { integrityErrors } from '../../domain/integrity'
import { createController } from '../controller'
import { createSeed, personas } from '../seed'
import { buildApplicationSeed } from './applications'
import { buildCmdbSeed } from './cmdb'
import { buildTopologySeed } from './topology'

describe('W2 additive canonical fixtures', () => {
  it('preserves all original CIs/apps/environments/associations and adds exactly three bounded physical parents', () => {
    const s = createSeed('fixture-test'), baseline = buildCmdbSeed(), apps = buildApplicationSeed()
    const topology = buildTopologySeed(apps.applications, apps.environments)
    expect(s).toEqual(createSeed('fixture-test'))
    expect(integrityErrors(s)).toEqual([])
    expect(s.entities.cis.slice(0, 60)).toEqual(baseline.cis)
    expect(s.entities.cis).toHaveLength(63)
    expect(s.entities.applications).toEqual(apps.applications)
    expect(s.entities.environments).toEqual(apps.environments)
    expect(s.entities.placements.slice(0, topology.placements.length)).toEqual(topology.placements)
    expect(s.entities.relations).toEqual(topology.relations)
    expect(s.entities.cis.slice(60).map(ci => [ci.id, ci.kind, ci.provider])).toEqual([
      ['w2-ci-kafka-idc', 'queue', 'onprem'], ['w2-ci-kafka-aws', 'queue', 'aws'], ['w2-ci-k8s-aws', 'cluster', 'aws'],
    ])
    expect(s.entities.changes).toEqual([])
    expect(s.entities.changeExecutions).toEqual([])
    expect(s.entities.requests).toEqual([])
    expect(s.entities.releases).toEqual([])
    expect(s.jobs).toEqual([])
  })

  it('shares canonical Redis quota independently of binding count and reuses unique Placement projections', () => {
    const { entities: e } = createSeed('fixture-test')
    const commerce = e.resourceObjects.find(o => o.id === 'w2-object-redis-commerce')!
    expect(commerce).toMatchObject({ parentCiId: 'ci-idc-redis-01', kind: 'cache_allocation', spec: { quotaMiB: 1024 } })
    expect(e.resourceBindings.filter(b => b.resourceObjectId === commerce.id).map(b => b.applicationId).sort()).toEqual(['app-checkout', 'app-storefront'])
    expect(e.resourceBindings.find(b => b.id === 'w2-binding-checkout-redis')?.placementId).toBe('placement-checkout-redis')
    expect(e.resourceBindings.find(b => b.id === 'w2-binding-data-redis')?.placementId).toBe('placement-data-redis')
    expect(e.resourceBindings.filter(b => b.resourceObjectId === 'w2-object-redis-data').map(b => b.applicationId)).toEqual(['app-data'])
    expect(e.resourceObjects.filter(o => o.kind === 'cache_allocation').reduce((sum, o) => sum + o.spec.quotaMiB, 0)).toBe(3072)
    expect(e.resourceQuotas.find(q => q.parentCiId === commerce.parentCiId)).toMatchObject({ capacity: { quotaMiB: 8192 }, observedAt: null, observedUsage: { quotaMiB: null } })
    expect(new Set(e.placements.map(p => `${p.applicationId}/${p.environmentId}/${p.ciId}`)).size).toBe(e.placements.length)
    expect(e.resourceBindings.every(b => b.requestRef.sourceType === 'seed' && b.requestRef.sourceId === 'w2-seed-explicit-bindings')).toBe(true)
  })

  it('models distinct same-name Kafka objects and keeps private readonly K8s samples out of CI metadata', () => {
    const { entities: e } = createSeed('fixture-test')
    const topics = e.resourceObjects.filter(o => o.kind === 'kafka_topic')
    expect(topics).toHaveLength(2)
    expect(new Set(topics.map(o => o.parentCiId)).size).toBe(2)
    expect(new Set(topics.map(o => o.id)).size).toBe(2)
    expect(topics.every(o => o.externalRef === 'orders-events' && o.name === 'orders-events')).toBe(true)
    const namespace = e.resourceObjects.find(o => o.kind === 'kubernetes_namespace')!
    expect(namespace).toMatchObject({ id: 'w2-object-k8s-checkout', observedAt: '2026-09-18T08:00:00Z', spec: { workloads: [{ name: 'checkout-api', kind: 'Deployment', replicas: 2 }] } })
    const cluster = e.cis.find(ci => ci.id === namespace.parentCiId)!
    expect(cluster.attributes).toEqual({ orchestrator: 'kubernetes', versionLabel: '1-demo' })
    expect(JSON.stringify(cluster)).not.toContain('checkout-api')
    expect(e.catalogs.map(c => c.template.resourceKind)).toEqual(['compute', 'redis', 'kafka'])
    expect(e.catalogs.some(c => c.template.resourceKind !== 'compute' && c.template.allowedProviders.includes('aliyun'))).toBe(false)
    expect(e.resourceQuotas.filter(q => q.resourceKind === 'kafka').every(q => Object.values(q.observedUsage).every(value => value === null))).toBe(true)
  })

  it('keeps the original persona order and gives new actors only their explicit grants', () => {
    expect(personas.slice(0, 4).map(p => p.id)).toEqual(['user-rd-commerce', 'user-rd-data', 'user-ops', 'user-admin'])
    const s = createSeed('fixture-test'), engine = createEngine(s, () => undefined)
    const session = (id: string) => engine.read('/session', new URLSearchParams(), id) as { centers: string[]; assignments: Array<{ scopeType: string; scopeId: string; role: string }> }
    expect(session('w2-user-no-grant').centers).toEqual([])
    expect(session('w2-user-no-grant').assignments).toEqual([])
    expect(session('w2-user-multi').centers).toEqual(['rd', 'ops'])
    expect(session('w2-user-ops-secondary').centers).toEqual(['ops'])
    const grants = (id: string) => session(id).assignments.map(a => `${a.role}/${a.scopeType}/${a.scopeId}`).sort()
    expect(grants('w2-user-ops-secondary')).toEqual(grants('user-ops'))
    expect(session('user-admin').centers).toEqual(['admin'])
    const controller = createController({ storage: null, createSessionId: () => 'fresh-personas', mode: 'memory' })
    expect(controller.getPersonas().map(p => p.id)).toEqual(personas.map(p => p.id))
  })
})
