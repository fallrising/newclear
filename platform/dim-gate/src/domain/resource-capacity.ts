import type { ChangeInput, ResourceCapacity, ResourceQuota, Snapshot } from './schemas'
import type { Policy } from './policy'
import { resourcePolicy } from './resource-policy'
import { observationTime } from './observation'

type Dimension = ResourceCapacity['dimensions'][number]['name']
export type ResourceDemand = Partial<Record<Dimension, number>>
export function resourceDemand(s: Snapshot, input: ChangeInput): ResourceDemand {
  if (input.kind === 'kafka.topic.create') return { topics: 1, partitions: input.partitions, throughputKiBPerSecond: input.throughputKiBPerSecond }
  if (input.kind === 'resource.bind') return input.mode === 'create' ? { quotaMiB: input.quotaMiB! } : {}
  const object = s.entities.resourceObjects.find(o => o.id === input.resourceObjectId)
  return { quotaMiB: Math.max(0, input.quotaMiB - (object?.kind === 'cache_allocation' ? object.spec.quotaMiB : 0)) }
}
export function resourceUsage(s: Snapshot, quota: ResourceQuota, exceptChangeId?: string) {
  const objects = s.entities.resourceObjects.filter(o => o.parentCiId === quota.parentCiId && o.lifecycle === 'active')
  const used: ResourceDemand = {}
  for (const object of objects) {
    if (object.kind === 'cache_allocation') used.quotaMiB = (used.quotaMiB ?? 0) + object.spec.quotaMiB
    if (object.kind === 'kafka_topic') {
      used.topics = (used.topics ?? 0) + 1; used.partitions = (used.partitions ?? 0) + object.spec.partitions
      used.throughputKiBPerSecond = (used.throughputKiBPerSecond ?? 0) + object.spec.throughputKiBPerSecond
    }
  }
  const reserved: ResourceDemand = {}
  for (const change of s.entities.changes.filter(c => c.id !== exceptChangeId && c.spec.targetCiId === quota.parentCiId && ['approved', 'executing'].includes(c.state))) {
    for (const [key, value] of Object.entries(resourceDemand(s, change.specSnapshot ?? change.spec))) {
      const dimension = key as Dimension; reserved[dimension] = (reserved[dimension] ?? 0) + value
    }
  }
  return Object.entries(quota.capacity).map(([key, capacity]) => {
    const name = key as Dimension
    return { name, capacity, used: used[name] ?? 0, reserved: reserved[name] ?? 0,
      available: Math.max(0, capacity - (used[name] ?? 0) - (reserved[name] ?? 0)),
      observed: (quota.observedUsage as Partial<Record<Dimension, number | null>>)[name] ?? null }
  })
}
export function resourceCapacity(s: Snapshot, policy: Policy, ciId: string): ResourceCapacity | null {
  const quota = s.entities.resourceQuotas.find(q => q.parentCiId === ciId)
  if (!quota) return null
  const rp = resourcePolicy(s, policy)
  const incomplete = s.entities.resourceObjects.some(o => o.parentCiId === ciId && o.lifecycle === 'active' && !rp.objectVisible(o))
    || s.entities.resourceBindings.some(b => b.ciId === ciId && b.state === 'active' && !rp.bindingVisible(b))
    || s.entities.changes.some(c => c.spec.targetCiId === ciId && ['approved', 'executing'].includes(c.state) && !rp.changeVisible(c))
  return { ciId, impactIncomplete: incomplete, dataAsOf: observationTime(s.logicalClock),
    dimensions: resourceUsage(s, quota).map(d => incomplete ? { ...d, used: null, reserved: null, available: null, observed: null } : d) }
}
