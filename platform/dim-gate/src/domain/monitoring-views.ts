import { z } from 'zod'
import type { Policy } from './policy'
import type { MonitoringTarget, Snapshot } from './schema-models'
import { canReadTarget, ruleTarget, monitoringNow } from './monitoring'
import { fail, notFound } from './engine-shared'
import { idSchema } from './schema-primitives'

type Collection = 'monitor-policies' | 'alert-rules' | 'slo-policies' | 'silences' | 'alert-evaluations' | 'notification-deliveries'
const listSchema = z.strictObject({
  applicationId: idSchema.optional(), environmentId: idSchema.optional(), ciId: idSchema.optional(),
  ruleId: idSchema.optional(), status: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['createdAt', 'updatedAt', 'id']).default('updatedAt'), order: z.enum(['asc', 'desc']).default('desc'),
})
const statuses: Record<Collection, string[]> = {
  'monitor-policies': ['draft', 'validated', 'submitted', 'approved', 'rejected', 'active'],
  'alert-rules': ['draft', 'validated', 'submitted', 'approved', 'rejected', 'active'],
  'slo-policies': ['draft', 'validated', 'submitted', 'approved', 'rejected', 'active'],
  silences: ['scheduled', 'active', 'expired'], 'alert-evaluations': ['fresh', 'stale', 'unknown'],
  'notification-deliveries': ['queued', 'suppressed', 'delivered', 'failed'],
}
function rowTarget(s: Snapshot, name: Collection, row: { id: string }): MonitoringTarget | undefined {
  if (name === 'monitor-policies') return s.entities.monitorPolicies.find(x => x.id === row.id)?.spec.target
  if (name === 'alert-rules') { const rule = s.entities.alertRules.find(x => x.id === row.id); return rule ? ruleTarget(s, rule) : undefined }
  if (name === 'slo-policies') {
    const slo = s.entities.sloPolicies.find(x => x.id === row.id)
    return s.entities.monitorPolicies.find(x => x.id === slo?.spec.monitorPolicyId)?.spec.target
  }
  return 'target' in row ? row.target as MonitoringTarget : undefined
}
function rowStatus(name: Collection, row: Record<string, unknown>, now: string): string {
  if (name === 'silences') return String(row.startAt) > now ? 'scheduled' : String(row.expiresAt) <= now ? 'expired' : 'active'
  if (name === 'alert-evaluations') return String(row.freshness)
  return String(row.status)
}
export function readMonitoring(s: Snapshot, policy: Policy, path: string, query: URLSearchParams): unknown {
  const match = /^\/(monitor-policies|alert-rules|slo-policies|silences|alert-evaluations|notification-deliveries)(?:\/([^/]+))?$/.exec(path)
  if (!match) return undefined
  const name = match[1] as Collection
  const rows = name === 'monitor-policies' ? s.entities.monitorPolicies : name === 'alert-rules' ? s.entities.alertRules
    : name === 'slo-policies' ? s.entities.sloPolicies : name === 'silences' ? s.entities.silences
      : name === 'alert-evaluations' ? s.entities.alertEvaluations : s.entities.notificationDeliveries
  const visible = rows.filter(row => {
    const target = rowTarget(s, name, row)
    return row.orgId === policy.user?.orgId && !!target && canReadTarget(s, policy, target)
  })
  if (match[2]) {
    if (query.size) fail(422, 'VALIDATION_ERROR', '詳情不接受查詢欄位。')
    return structuredClone(visible.find(row => row.id === match[2]) ?? notFound())
  }
  for (const key of query.keys()) if (query.getAll(key).length !== 1 || query.get(key) === '') fail(422, 'VALIDATION_ERROR', '不接受重複或空白查詢欄位。')
  const parsed = listSchema.safeParse(Object.fromEntries(query))
  if (!parsed.success) fail(422, 'VALIDATION_ERROR', '查詢欄位不符合契約。')
  const values = parsed.data!, now = monitoringNow(s)
  if (values.status && !statuses[name].includes(values.status)) fail(422, 'VALIDATION_ERROR', '不支援的狀態。')
  const filtered = visible.filter(row => {
    const target = rowTarget(s, name, row)!
    const ruleId = name === 'alert-rules' ? row.id : 'ruleId' in row ? String(row.ruleId) : undefined
    return (!values.applicationId || target.kind === 'service' && target.applicationId === values.applicationId)
      && (!values.environmentId || target.kind === 'service' && target.environmentId === values.environmentId)
      && (!values.ciId || target.kind === 'infrastructure' && target.ciId === values.ciId)
      && (!values.ruleId || ruleId === values.ruleId)
      && (!values.status || rowStatus(name, row as Record<string, unknown>, now) === values.status)
  }).toSorted((a, b) => {
    const left = String(a[values.sort]), right = String(b[values.sort])
    return (values.order === 'desc' ? -1 : 1) * left.localeCompare(right) || a.id.localeCompare(b.id)
  })
  return structuredClone({ items: filtered.slice((values.page - 1) * values.pageSize, values.page * values.pageSize),
    total: filtered.length, page: values.page, pageSize: values.pageSize })
}
