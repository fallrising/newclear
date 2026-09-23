import type { CommandInput } from './command-input-schemas'
import type { Policy } from './policy'
import { policyFor } from './policy'
import type { AlertRule, CommandReceipt, MonitorPolicy, MonitoringTarget, SLOPolicy, Snapshot } from './schema-models'
import { createAlertRuleInputSchema, createMonitorPolicyInputSchema, createSilenceInputSchema, createSLOPolicyInputSchema,
  monitoringActionInputSchema, reviseAlertRuleInputSchema, reviseMonitorPolicyInputSchema, reviseSLOPolicyInputSchema,
  alertScenarioInputSchema } from './monitoring-input-schemas'
import { fail, forbidden, notFound, parse } from './engine-shared'
import { activeSpec, monitoringNow, requireTarget, ruleTarget, targetScope, validateMonitorSpec, validateRuleSpec } from './monitoring'
import { runAlertScenario } from './monitoring-evaluation'

type Kind = 'monitorPolicy' | 'alertRule' | 'sloPolicy'
type Config = MonitorPolicy | AlertRule | SLOPolicy
type Action = 'revise' | 'validate' | 'submit' | 'approve' | 'reject' | 'activate'
const names: Record<string, Kind> = { 'monitor-policies': 'monitorPolicy', 'alert-rules': 'alertRule', 'slo-policies': 'sloPolicy' }
const ref = (entityType: string, entityId: string) => ({ entityType, entityId })
const invalid = (): never => fail(409, 'INVALID_STATE', '目前狀態無法執行此操作。')
const conflict = (): never => fail(409, 'VERSION_CONFLICT', '資源版本已變更，請重新讀取。')
function item(s: Snapshot, kind: Kind, id: string): Config | undefined {
  if (kind === 'monitorPolicy') return s.entities.monitorPolicies.find(x => x.id === id)
  if (kind === 'alertRule') return s.entities.alertRules.find(x => x.id === id)
  return s.entities.sloPolicies.find(x => x.id === id)
}
function checkSpec(s: Snapshot, kind: Kind, spec: Config['spec'], current?: Config) {
  if (kind === 'monitorPolicy') {
    const next = spec as MonitorPolicy['spec']
    validateMonitorSpec(s, next)
    if (current && 'target' in current.spec && JSON.stringify(next.target) !== JSON.stringify(current.spec.target)) invalid()
    return next.target
  }
  if (kind === 'alertRule') {
    const next = spec as AlertRule['spec']
    const monitor = validateRuleSpec(s, next)
    if (current && 'monitorPolicyId' in current.spec && next.monitorPolicyId !== current.spec.monitorPolicyId) invalid()
    return monitor.spec.target
  }
  const next = spec as SLOPolicy['spec']
  const monitor = s.entities.monitorPolicies.find(m => m.id === next.monitorPolicyId) ?? notFound()
  if (monitor.spec.target.kind !== 'service' || !monitor.spec.metrics.includes(next.indicator === 'availability' ? 'errorRate' : 'p95Latency')
    || next.indicator === 'availability' && next.unit !== 'fraction' || next.indicator === 'latency' && next.unit !== 'ms')
    fail(422, 'VALIDATION_ERROR', 'SLO 指標、單位或服務監控來源不相容。')
  if (current && 'monitorPolicyId' in current.spec && next.monitorPolicyId !== current.spec.monitorPolicyId) invalid()
  return monitor.spec.target
}
function scopedFields(s: Snapshot, target: MonitoringTarget) {
  const scope = targetScope(s, target)!
  return { projectIds: scope.projectId ? [scope.projectId] : [], poolIds: scope.poolId ? [scope.poolId] : [], stages: scope.stage ? [scope.stage] : [] }
}
export type MonitoringEffect = CommandReceipt & { action: string; fields: string[]; reason: string; projectIds: string[]; poolIds: string[]; stages: ('dev' | 'staging' | 'prod')[] }
export function prepareMonitoring(s: Snapshot, policy: Policy, input: CommandInput,
  advance: (next: Snapshot, ticks: number) => CommandReceipt['changed']): { apply(next: Snapshot): MonitoringEffect } | undefined {
  if (input.method.toUpperCase() !== 'POST') return undefined
  const createKind = names[input.path.slice(1)]
  const match = /^\/(monitor-policies|alert-rules|slo-policies)\/([^/]+)\/(revise|validate|submit|approve|reject|activate)$/.exec(input.path)
  const kind = match ? names[match[1]] : createKind
  const action = match?.[3] as Action | undefined
  if (kind) {
    const schema = kind === 'monitorPolicy' ? action === 'revise' ? reviseMonitorPolicyInputSchema : action ? monitoringActionInputSchema : createMonitorPolicyInputSchema
      : kind === 'alertRule' ? action === 'revise' ? reviseAlertRuleInputSchema : action ? monitoringActionInputSchema : createAlertRuleInputSchema
        : action === 'revise' ? reviseSLOPolicyInputSchema : action ? monitoringActionInputSchema : createSLOPolicyInputSchema
    const body = parse(schema, input.body) as { expectedVersion?: number; spec?: Config['spec']; reason: string }
    const original = match ? item(s, kind, match[2]) ?? notFound() : undefined
    const spec = body.spec ?? original!.spec
    const targetRef = checkSpec(s, kind, spec, original)
    if (original && original.orgId !== policy.user!.orgId) notFound()
    requireTarget(s, policy, targetRef, action === 'approve' || action === 'reject' ? 'approve' : 'write')
    if (action === 'approve' || action === 'reject') {
      if (targetRef.kind !== 'service' || targetScope(s, targetRef)?.stage !== 'prod' || original!.requesterId === input.actorId) forbidden()
    }
    return { apply(next) {
      const now = monitoringNow(next)
      const targetNext = checkSpec(next, kind, spec, original)
      let result: Config
      if (!original) {
        const id = `w4-${kind}-${String(next.sequence + 1).padStart(4, '0')}`
        const common = { id, orgId: policy.user!.orgId, version: 1, createdAt: now, updatedAt: now,
          requesterId: input.actorId, correlationId: `corr-${id}`, revision: 1, activeRevision: null, status: 'draft' as const }
        if (kind === 'monitorPolicy') { const row: MonitorPolicy = { ...common, spec: spec as MonitorPolicy['spec'], revisions: [{ revision: 1, spec: spec as MonitorPolicy['spec'] }] }; next.entities.monitorPolicies.push(row); result = row }
        else if (kind === 'alertRule') { const row: AlertRule = { ...common, spec: spec as AlertRule['spec'], revisions: [{ revision: 1, spec: spec as AlertRule['spec'] }] }; next.entities.alertRules.push(row); result = row }
        else { const row: SLOPolicy = { ...common, spec: spec as SLOPolicy['spec'], revisions: [{ revision: 1, spec: spec as SLOPolicy['spec'] }] }; next.entities.sloPolicies.push(row); result = row }
      } else {
        result = item(next, kind, original.id)!
        if (result.version !== body.expectedVersion) conflict()
        if (action === 'revise') {
          // Even an unsubmitted draft is revised by making a new immutable revision.
          result.revision += 1; result.status = 'draft'; result.requesterId = input.actorId
          if (kind === 'monitorPolicy') { const row = result as MonitorPolicy; row.spec = spec as MonitorPolicy['spec']; row.revisions.push({ revision: row.revision, spec: row.spec }) }
          else if (kind === 'alertRule') { const row = result as AlertRule; row.spec = spec as AlertRule['spec']; row.revisions.push({ revision: row.revision, spec: row.spec }) }
          else { const row = result as SLOPolicy; row.spec = spec as SLOPolicy['spec']; row.revisions.push({ revision: row.revision, spec: row.spec }) }
        } else if (action === 'validate') {
          if (result.status !== 'draft') invalid()
          result.status = 'validated'
        } else if (action === 'submit') {
          if (result.status !== 'validated') invalid()
          result.status = targetNext.kind === 'service' && targetScope(next, targetNext)?.stage === 'prod' ? 'submitted' : 'approved'
          result.revisions.at(-1)!.submittedAt = now
        } else if (action === 'approve' || action === 'reject') {
          if (result.status !== 'submitted') invalid()
          result.status = action === 'approve' ? 'approved' : 'rejected'
          result.revisions.at(-1)!.decision = { actorId: input.actorId, decision: action === 'approve' ? 'approved' : 'rejected', reason: body.reason, occurredAt: now }
        } else if (action === 'activate') {
          if (result.status !== 'approved') invalid()
          if (kind === 'monitorPolicy') {
            const nextSpec = (result as MonitorPolicy).spec
            if (next.entities.alertRules.some(r => r.spec.monitorPolicyId === result.id && r.activeRevision !== null
              && !nextSpec.metrics.includes((activeSpec(r) ?? r.spec).metric))
              || next.entities.sloPolicies.some(r => r.spec.monitorPolicyId === result.id && r.activeRevision !== null
                && !(activeSpec(r)?.indicator === 'availability' ? nextSpec.metrics.includes('errorRate') : nextSpec.metrics.includes('p95Latency'))))
              invalid()
          }
          if (targetNext.kind === 'service' && targetScope(next, targetNext)?.stage === 'prod') {
            const decision = result.revisions.at(-1)?.decision
            if (!decision || decision.decision !== 'approved' || decision.actorId === result.requesterId
              || !policyFor(next, decision.actorId).user || !policyFor(next, decision.actorId).hasProject(
                targetScope(next, targetNext)!.projectId!, 'prod', 'ops')) invalid()
          }
          if (kind !== 'monitorPolicy') {
            const monitorId = (result.spec as AlertRule['spec']).monitorPolicyId
            const monitor = next.entities.monitorPolicies.find(m => m.id === monitorId && m.orgId === result.orgId)
            if (!monitor || !activeSpec(monitor)?.enabled) invalid()
          }
          if (kind === 'alertRule' && !(result as AlertRule).spec.enabled || kind === 'monitorPolicy' && !(result as MonitorPolicy).spec.enabled) invalid()
          result.activeRevision = result.revision; result.status = 'active'
        }
        result.version += 1; result.updatedAt = now
      }
      return { ...ref(kind, result.id), entityVersion: result.version, correlationId: result.correlationId,
        changed: [ref(kind, result.id)], action: `${kind}.${action ?? 'create'}`, fields: [action === 'revise' ? 'revision' : 'status'], reason: body.reason,
        ...scopedFields(next, targetNext) }
    } }
  }
  if (input.path === '/silences') {
    const body = parse(createSilenceInputSchema, input.body)
    const rule = s.entities.alertRules.find(r => r.id === body.ruleId && r.orgId === policy.user!.orgId) ?? notFound()
    const targetRef = ruleTarget(s, rule)
    requireTarget(s, policy, targetRef, 'write')
    return { apply(next) {
      const currentRule = next.entities.alertRules.find(r => r.id === rule.id)!
      if (!activeSpec(currentRule)?.enabled) invalid()
      const now = Date.parse(monitoringNow(next)), start = Date.parse(body.startAt), end = Date.parse(body.expiresAt)
      if (start < now || start > now + 300_000 || end <= start || end - start > 86_400_000) fail(422, 'VALIDATION_ERROR', 'Silence 需在目前時間起五分鐘內開始，且期限不超過 24 小時。')
      const id = `w4-silence-${String(next.sequence + 1).padStart(4, '0')}`, nowIso = monitoringNow(next)
      next.entities.silences.push({ id, orgId: currentRule.orgId, version: 1, createdAt: nowIso, updatedAt: nowIso, ruleId: currentRule.id,
        ruleRevision: currentRule.activeRevision!, target: targetRef, actorId: input.actorId, reason: body.reason,
        startAt: body.startAt, expiresAt: body.expiresAt, correlationId: `corr-${id}` })
      return { ...ref('silence', id), entityVersion: 1, correlationId: `corr-${id}`, changed: [ref('silence', id)],
        action: 'silence.create', fields: ['startAt', 'expiresAt', 'reason'], reason: body.reason, ...scopedFields(next, targetRef) }
    } }
  }
  if (input.path === '/scenarios' && ['alert-breach', 'alert-recovery', 'alert-unknown', 'alert-delivery-failure'].includes(String((input.body as { scenarioKey?: string })?.scenarioKey))) {
    const body = parse(alertScenarioInputSchema, input.body)
    const rule = s.entities.alertRules.find(r => r.id === body.ruleId && r.orgId === policy.user!.orgId) ?? notFound()
    const targetRef = ruleTarget(s, rule)
    requireTarget(s, policy, targetRef, 'write')
    return { apply(next) {
      const current = next.entities.alertRules.find(r => r.id === rule.id)!
      if (!activeSpec(current)?.enabled) invalid()
      const changed = runAlertScenario(next, current, body.scenarioKey, advance)
      return { ...ref('alertRule', rule.id), entityVersion: current.version, correlationId: current.correlationId,
        changed: [ref('alertRule', rule.id), ...changed], action: `demo.scenario.${body.scenarioKey}`,
        fields: ['synthetic monitoring samples'], reason: 'Registered deterministic monitoring scenario', ...scopedFields(next, targetRef) }
    } }
  }
  return undefined
}
