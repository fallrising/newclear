import type { z } from 'zod'
import type { Snapshot, Request as DomainRequest } from './schemas'
import { integrityErrors } from './integrity'
import { DomainError } from './errors'

export const clockIso = (ticks: number) => new Date(Date.parse('2026-09-20T09:00:00Z') + ticks * 1000).toISOString()
export const clone = <T>(value: T): T => structuredClone(value)
export const fail = (status: number, code: string, message: string): never => { throw new DomainError(status, code, message) }
export const notFound = (): never => fail(404, 'NOT_FOUND', '此資源不存在或不在目前授權範圍。')
export const forbidden = (): never => fail(403, 'FORBIDDEN', '目前身分沒有此操作的授權。')

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const fields: Record<string, string[]> = {}
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || 'body'
    ;(fields[key] ??= []).push(issue.message)
  }
  throw new DomainError(422, 'VALIDATION_ERROR', '輸入欄位不符合契約。', fields)
}

export function assertIntegrity(snapshot: Snapshot): void {
  const errors = integrityErrors(snapshot)
  if (errors.length) throw new DomainError(422, 'INVALID_SNAPSHOT', '示範資料的實體關係不一致。', { snapshot: errors })
}

export function requestableCatalog(snapshot: Snapshot, id: string) {
  const current = snapshot.entities.catalogs.find((item) => item.id === id)
  if (!current) return undefined
  if (current.status === 'published') return current
  if (current.status !== 'draft') return undefined
  const predecessor = snapshot.entities.catalogHistory.find((item) =>
    item.id === id && item.revision === current.revision - 1)
  return predecessor?.status === 'published' ? predecessor : undefined
}

export function requestPoolUsage(snapshot: Snapshot, poolId: string) {
  const pool = snapshot.entities.pools.find((entry) => entry.id === poolId)
  if (!pool) return notFound()
  const active = snapshot.entities.cis.filter((ci) => ci.poolId === poolId && ci.kind === 'compute' && ci.lifecycle === 'active')
  const reservedRequests = snapshot.jobs.filter((job) => ['queued', 'running'].includes(job.state))
    .map((job) => snapshot.entities.requests.find((request) => request.id === job.requestId && request.poolId === poolId))
    .filter((request): request is DomainRequest => Boolean(request))
  const scenario = snapshot.scenarioFlags[`capacity:${poolId}`]
  const scenarioCpu = scenario && typeof scenario === 'object' && !Array.isArray(scenario) && typeof scenario.cpu === 'number' ? scenario.cpu : 0
  const scenarioMemory = scenario && typeof scenario === 'object' && !Array.isArray(scenario) && typeof scenario.memoryMiB === 'number' ? scenario.memoryMiB : 0
  const cpuUsed = active.reduce((sum, ci) => sum + Number(ci.attributes.cpu), 0)
  const memoryUsed = active.reduce((sum, ci) => sum + Number(ci.attributes.memoryMiB), 0)
  const cpuReserved = reservedRequests.reduce((sum, request) => sum + request.cpu, 0) + scenarioCpu
  const memoryReserved = reservedRequests.reduce((sum, request) => sum + request.memoryMiB, 0) + scenarioMemory
  return {
    pool,
    cpu: { used: cpuUsed, reserved: cpuReserved, available: Math.max(0, pool.cpuCapacity - cpuUsed - cpuReserved) },
    memoryMiB: { used: memoryUsed, reserved: memoryReserved, available: Math.max(0, pool.memoryCapacityMiB - memoryUsed - memoryReserved) },
  }
}
