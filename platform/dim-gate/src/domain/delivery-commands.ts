import type { CommandInput } from './command-input-schemas'
import { createPipelineInputSchema, reasonCommandSchema, rollbackReleaseInputSchema } from './command-input-schemas'
import { canReadDelivery, rollbackTargets } from './delivery'
import { assertEnvironmentAvailable } from './service-delivery-shared'
import type { z } from 'zod'
import { DomainError } from './errors'
import type { Policy } from './policy'
import { scenarioInputSchema, type CommandReceipt, type Environment, type PipelineRun, type Release, type Snapshot } from './schema-models'

const time = (s: Snapshot) => new Date(Date.parse('2026-09-20T09:00:00Z') + s.logicalClock * 1000).toISOString()
const fail = (status: number, code: string, message: string): never => { throw new DomainError(status, code, message) }
const missing = (): never => fail(404, 'NOT_FOUND', '此資源不存在或不在目前授權範圍。')
const denied = (): never => fail(403, 'FORBIDDEN', '目前身分沒有此操作的授權。')
const invalid = (): never => fail(409, 'INVALID_STATE', '目前狀態無法執行此操作。')
const terminalRun = (run: PipelineRun) => ['succeeded', 'failed', 'cancelled'].includes(run.state)
const terminalRelease = (release: Release) => ['succeeded', 'failed', 'rejected', 'cancelled'].includes(release.state)
const touch = (s: Snapshot, entity: { version: number; updatedAt: string }) => { entity.version += 1; entity.updatedAt = time(s) }
const ref = (entityType: string, entityId: string) => ({ entityType, entityId })
const stamp = (s: Snapshot, orgId: string, id: string) => ({ id, orgId, version: 1, createdAt: time(s), updatedAt: time(s) })
const nextId = (s: Snapshot, prefix: string) => `${prefix}-${String(s.sequence + 1).padStart(4, '0')}`
function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)
  if (!result.success) throw new DomainError(422, 'VALIDATION_ERROR', '輸入欄位不符合契約。', {
    body: result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
  })
  return result.data
}
function environment(s: Snapshot, id: string): Environment {
  return s.entities.environments.find(e => e.id === id) ?? missing()
}
function authorize(s: Snapshot, policy: Policy, id: string, role: 'rd' | 'ops') {
  if (!policy.centers.includes(role)) denied()
  const env = environment(s, id)
  const app = s.entities.applications.find(a => a.id === env.applicationId && a.orgId === env.orgId)
  if (!app || env.orgId !== policy.user?.orgId || !policy.hasProject(app.projectId, env.stage, role)) missing()
  return env
}
function checkVersion(actual: number, expected: number) {
  if (actual !== expected) fail(409, 'VERSION_CONFLICT', '資料版本已變更，請重新讀取後再確認。')
}
const checkAvailable = assertEnvironmentAvailable
function schedule(s: Snapshot, id: string, stepIndex = 0) {
  s.scheduler.tasks.push({ id: `task-${id}`, operationId: id, stepIndex, dueTick: s.logicalClock + 1 })
}
function unschedule(s: Snapshot, id: string) {
  s.scheduler.tasks = s.scheduler.tasks.filter(t => t.operationId !== id)
}
function clearFaults(s: Snapshot, id: string) {
  for (const key of ['build-failure', 'health-failure', 'rollback-failure']) delete s.scenarioFlags[`${key}:${id}`]
}
export type DeliveryEffect = CommandReceipt & { action: string; fields: string[]; reason?: string; projectIds: string[]; stages: Environment['stage'][] }
export function deliveryEffect(s: Snapshot, entity: PipelineRun | Release, type: 'pipeline' | 'release', action: string, reason?: string): DeliveryEffect {
  const env = environment(s, entity.environmentId)
  const app = s.entities.applications.find(a => a.id === env.applicationId)!
  return { ...ref(type, entity.id), entityVersion: entity.version, operationId: entity.id, correlationId: entity.correlationId,
    changed: [ref(type, entity.id), ref('environment', env.id)], action, fields: ['state'], reason, projectIds: [app.projectId], stages: [env.stage] }
}
export function newRun(s: Snapshot, env: Environment, actorId: string, revision: string, retryOfRunId?: string) {
  const run: PipelineRun = { ...stamp(s, env.orgId, nextId(s, 'run')), applicationId: env.applicationId, environmentId: env.id,
    revision, stages: ['build', 'test', 'package', 'deploy', 'verify'].map(name => ({ name, state: 'queued' })) as PipelineRun['stages'],
    state: 'queued', triggeredBy: actorId, correlationId: nextId(s, 'corr-pipeline'), ...(retryOfRunId ? { retryOfRunId } : {}) }
  s.entities.pipelines.push(run); schedule(s, run.id)
  return run
}
function newRelease(s: Snapshot, env: Environment, fields: Pick<Release, 'artifactDigest' | 'createdBy' | 'correlationId' | 'kind'> & Partial<Release>) {
  const release: Release = { ...stamp(s, env.orgId, nextId(s, 'release')), applicationId: env.applicationId, environmentId: env.id,
    previousReleaseId: env.activeReleaseId, state: env.stage === 'prod' ? 'pending_approval' : 'queued', health: 'pending', ...fields }
  s.entities.releases.push(release)
  if (release.state === 'queued') schedule(s, release.id)
  return release
}
function skipStages(run: PipelineRun) {
  for (const stage of run.stages) if (stage.state === 'queued' || stage.state === 'running') stage.state = 'skipped'
}

/** Authorization is evaluated before replay; this closure applies state/version checks only for a fresh command. */
export function prepareDelivery(s: Snapshot, policy: Policy, input: CommandInput): { apply(next: Snapshot): DeliveryEffect } | undefined {
  if (input.method.toUpperCase() !== 'POST') return undefined
  if (input.path === '/pipelines') {
    if (!policy.effectiveActions.includes('pipeline.trigger')) denied()
    const body = parse(createPipelineInputSchema, input.body)
    const env = authorize(s, policy, body.environmentId, 'rd')
    if (env.applicationId !== body.applicationId) missing()
    return { apply(next) {
      const target = environment(next, env.id)
      checkVersion(target.version, body.environmentVersion); checkAvailable(next, target)
      return deliveryEffect(next, newRun(next, target, input.actorId, body.revision), 'pipeline', 'pipeline.trigger')
    } }
  }
  const runMatch = /^\/pipelines\/([^/]+)\/(cancel|retry)$/.exec(input.path)
  if (runMatch) {
    if (!policy.effectiveActions.includes(`pipeline.${runMatch[2]}`)) denied()
    const body = parse(reasonCommandSchema, input.body)
    const run = s.entities.pipelines.find(r => r.id === runMatch[1]) ?? missing()
    authorize(s, policy, run.environmentId, 'rd')
    if (runMatch[2] === 'cancel' && run.triggeredBy !== input.actorId) denied()
    return { apply(next) {
      const target = next.entities.pipelines.find(r => r.id === run.id)!
      checkVersion(target.version, body.expectedVersion)
      if (runMatch[2] === 'retry') {
        if (!['failed', 'cancelled'].includes(target.state)) invalid()
        const env = environment(next, target.environmentId); checkAvailable(next, env)
        const retry = newRun(next, env, input.actorId, target.revision, target.id)
        if (target.definitionId) Object.assign(retry, { definitionId: target.definitionId, definitionRevision: target.definitionRevision, sourceRevision: target.sourceRevision, definitionSnapshot: structuredClone(target.definitionSnapshot) })
        return deliveryEffect(next, retry, 'pipeline', 'pipeline.retry', body.reason)
      }
      const release = next.entities.releases.find(r => r.id === target.releaseId)
      if (terminalRun(target) || release && !['pending_approval', 'queued'].includes(release.state)) invalid()
      target.state = 'cancelled'; skipStages(target); touch(next, target); unschedule(next, target.id); clearFaults(next, target.id)
      const result = deliveryEffect(next, target, 'pipeline', 'pipeline.cancel', body.reason)
      if (release) {
        release.state = 'cancelled'; release.completedAt = time(next); touch(next, release); unschedule(next, release.id); clearFaults(next, release.id)
        result.changed.push(ref('release', release.id))
      }
      return result
    } }
  }
  const releaseMatch = /^\/releases\/([^/]+)\/(approve|reject|rollback)$/.exec(input.path)
  if (releaseMatch) {
    const action = releaseMatch[2]
    if (!policy.effectiveActions.includes(`release.${action}`)) denied()
    const body = parse(action === 'rollback' ? rollbackReleaseInputSchema : reasonCommandSchema, input.body)
    const release = s.entities.releases.find(r => r.id === releaseMatch[1]) ?? missing()
    authorize(s, policy, release.environmentId, action === 'rollback' ? 'rd' : 'ops')
    if (action !== 'rollback' && release.createdBy === input.actorId) fail(403, 'SELF_APPROVAL_DENIED', '發布發起者不能審批自己的發布。')
    if (action === 'rollback') {
      const rollback = parse(rollbackReleaseInputSchema, input.body)
      const target = s.entities.releases.find(r => r.id === rollback.targetReleaseId)
      if (!target || !canReadDelivery(s, policy, target.environmentId) || target.environmentId !== release.environmentId) missing()
    }
    return { apply(next) {
      const current = next.entities.releases.find(r => r.id === release.id)!
      checkVersion(current.version, body.expectedVersion)
      const env = environment(next, current.environmentId)
      if (action === 'rollback') {
        const rollback = body as z.infer<typeof rollbackReleaseInputSchema>
        checkVersion(env.version, rollback.environmentVersion); checkAvailable(next, env)
        if (env.activeReleaseId !== current.id || !rollbackTargets(next, current).some(r => r.id === rollback.targetReleaseId)) invalid()
        const target = next.entities.releases.find(r => r.id === rollback.targetReleaseId)!
        const created = newRelease(next, env, { kind: 'rollback', artifactDigest: target.artifactDigest, targetReleaseId: target.id,
          createdBy: input.actorId, correlationId: nextId(next, 'corr-rollback'), reason: body.reason })
        return deliveryEffect(next, created, 'release', 'release.rollback', body.reason)
      }
      if (current.state !== 'pending_approval') invalid()
      const run = next.entities.pipelines.find(r => r.id === current.pipelineRunId)
      current.approval = { actorId: input.actorId, occurredAt: time(next), reason: body.reason }
      current.state = action === 'approve' ? 'queued' : 'rejected'; touch(next, current)
      if (action === 'approve') schedule(next, current.id)
      else { current.completedAt = time(next); clearFaults(next, current.id) }
      const result = deliveryEffect(next, current, 'release', `release.${action}`, body.reason)
      if (run) {
        run.state = action === 'approve' ? 'running' : 'failed'; touch(next, run)
        if (action === 'reject') { skipStages(run); run.failureCode = 'RELEASE_REJECTED'; clearFaults(next, run.id) }
        result.changed.push(ref('pipeline', run.id))
      }
      return result
    } }
  }
  if (input.path !== '/scenarios' || !['build-failure', 'health-failure', 'rollback-failure'].includes(String((input.body as { scenarioKey?: string })?.scenarioKey))) return undefined
  const body = parse(scenarioInputSchema, input.body)
  const targets = [body.runId, body.releaseId, body.jobId, body.poolId].filter(Boolean)
  if (targets.length !== 1 || body.environmentId || body.jobId || body.poolId || body.scenarioKey === 'build-failure' && !body.runId || body.scenarioKey === 'rollback-failure' && !body.releaseId) {
    fail(422, 'VALIDATION_ERROR', '請為故障選擇一個相容的 run 或 release。')
  }
  const op = (body.runId ? s.entities.pipelines.find(r => r.id === body.runId) : s.entities.releases.find(r => r.id === body.releaseId)) ?? missing()
  if (!canReadDelivery(s, policy, op.environmentId, true)) missing()
  return { apply(next) {
    const run = body.runId ? next.entities.pipelines.find(r => r.id === body.runId) : undefined
    const release = body.releaseId ? next.entities.releases.find(r => r.id === body.releaseId) : undefined
    if (run && (terminalRun(run) || body.scenarioKey === 'build-failure' && run.stages[0].state === 'succeeded')
      || release && (terminalRelease(release) || (body.scenarioKey === 'rollback-failure') !== (release.kind === 'rollback'))) {
      fail(422, 'VALIDATION_ERROR', '此 operation 已終止或與故障情境不相容。')
    }
    next.scenarioFlags[`${body.scenarioKey}:${op.id}`] = true
    return deliveryEffect(next, (run ?? release)!, run ? 'pipeline' : 'release', `demo.scenario.${body.scenarioKey}`)
  } }
}

function syntheticDigest(applicationId: string, revision: string) {
  const text = JSON.stringify([applicationId, revision, 'demo-web-v1'])
  const hash = (input: string) => { let value = 2166136261; for (const char of input) value = Math.imul(value ^ char.codePointAt(0)!, 16777619) >>> 0; return value.toString(16).padStart(8, '0') }
  return `demo-fnv1a-${hash(text)}${hash([...text].reverse().join(''))}`
}
function stageLog(s: Snapshot, operation: PipelineRun | Release, stage: PipelineRun['stages'][number]['name'], message: string, failed = false) {
  const operationId = 'triggeredBy' in operation ? operation.id : operation.pipelineRunId ?? operation.id
  s.deliveryLogs.push({ id: `log-${operationId}-${s.logicalClock}-${stage}`, operationId,
    applicationId: operation.applicationId, environmentId: operation.environmentId, stage, occurredAt: time(s), level: failed ? 'error' : 'info', message })
}
function recordTransition(s: Snapshot, entity: PipelineRun | Release, type: 'pipeline' | 'release', action: string, changed: CommandReceipt['changed']) {
  s.sequence += 1
  const serial = String(s.sequence).padStart(4, '0')
  const env = environment(s, entity.environmentId)
  const app = s.entities.applications.find(a => a.id === env.applicationId)!
  s.events.push({ eventId: `event-${serial}`, entities: changed, type: action, occurredAt: time(s), correlationId: entity.correlationId })
  s.audit.push({ id: `audit-${serial}`, orgId: entity.orgId, actorId: 'demo-scheduler', action, entityType: type, entityId: entity.id,
    scopeSnapshot: { projectIds: [app.projectId], poolIds: [], stages: [env.stage] }, outcome: 'succeeded',
    diffSummary: [`state: ${entity.state}`], requestId: `scheduler-${serial}`, correlationId: entity.correlationId, occurredAt: time(s) })
}

/** Called once per logical tick inside the same transaction as provisioning and clock persistence. */
export function advanceDelivery(s: Snapshot): CommandReceipt['changed'] {
  const changes: CommandReceipt['changed'] = []
  const due = s.scheduler.tasks.filter(t => t.dueTick <= s.logicalClock &&
    (s.entities.pipelines.some(r => r.id === t.operationId) || s.entities.releases.some(r => r.id === t.operationId)))
    .toSorted((a, b) => a.id.localeCompare(b.id))
  for (const task of due) {
    const run = s.entities.pipelines.find(r => r.id === task.operationId)
    const release = s.entities.releases.find(r => r.id === task.operationId)
    if (run && !terminalRun(run) && !run.releaseId) {
      const stage = run.stages[task.stepIndex]
      run.state = 'running'; stage.startedAt ??= time(s); stage.completedAt = time(s)
      const failed = stage.name === 'build' && s.scenarioFlags[`build-failure:${run.id}`] === true
      stage.state = failed ? 'failed' : 'succeeded'; touch(s, run)
      stageLog(s, run, stage.name, `${stage.name}: ${failed ? 'simulated build failure' : 'completed'}`, failed)
      const changed = [ref('pipeline', run.id)]
      if (failed) { run.state = 'failed'; run.failureCode = 'SIMULATED_BUILD_FAILURE'; skipStages(run); unschedule(s, run.id); clearFaults(s, run.id) }
      else if (stage.name === 'package') {
        const digest = syntheticDigest(run.applicationId, run.revision)
        const existing = s.entities.artifacts.find(a => a.digest === digest)
        if (existing && (existing.revision !== run.revision || existing.applicationId !== run.applicationId || existing.orgId !== run.orgId)) fail(409, 'ARTIFACT_COLLISION', '示範 artifact digest 衝突。')
        if (!existing) s.entities.artifacts.push({ ...stamp(s, run.orgId, digest), applicationId: run.applicationId, digest, revision: run.revision, recipe: 'demo-web-v1', filename: 'web-service.demo.tar' })
        run.artifactDigest = digest
        const candidate = newRelease(s, environment(s, run.environmentId), { kind: 'deploy', artifactDigest: digest, createdBy: run.triggeredBy, correlationId: run.correlationId, pipelineRunId: run.id })
        run.releaseId = candidate.id; run.state = candidate.state === 'pending_approval' ? 'awaiting_approval' : 'running'
        changed.push(ref('artifact', digest), ref('release', candidate.id)); unschedule(s, run.id)
      } else { task.stepIndex += 1; task.dueTick = s.logicalClock + 1; run.stages[task.stepIndex].state = 'running'; run.stages[task.stepIndex].startedAt = time(s) }
      recordTransition(s, run, 'pipeline', `pipeline.${stage.name}.${stage.state}`, changed); changes.push(...changed)
    } else if (release && ['queued', 'deploying', 'verifying'].includes(release.state)) {
      const linkedRun = s.entities.pipelines.find(r => r.id === release.pipelineRunId)
      const changed = [ref('release', release.id), ...(linkedRun ? [ref('pipeline', linkedRun.id)] : [])]
      if (release.state === 'queued') {
        release.state = 'deploying'; release.startedAt = time(s)
        if (linkedRun) { linkedRun.stages[3].state = 'running'; linkedRun.stages[3].startedAt = time(s) }
        stageLog(s, release, 'deploy', 'deploy: candidate rollout started')
      } else if (release.state === 'deploying') {
        release.state = 'verifying'
        if (linkedRun) { linkedRun.stages[3].state = 'succeeded'; linkedRun.stages[3].completedAt = time(s); linkedRun.stages[4].state = 'running'; linkedRun.stages[4].startedAt = time(s) }
        stageLog(s, release, 'deploy', 'deploy: candidate ready for health gate')
      } else {
        const failed = s.scenarioFlags[`health-failure:${release.id}`] === true || !!linkedRun && s.scenarioFlags[`health-failure:${linkedRun.id}`] === true || s.scenarioFlags[`rollback-failure:${release.id}`] === true
        release.state = failed ? 'failed' : 'succeeded'; release.health = failed ? 'unhealthy' : 'healthy'; release.completedAt = time(s)
        if (failed) release.failureCode = release.kind === 'rollback' ? 'SIMULATED_ROLLBACK_FAILURE' : 'SIMULATED_HEALTH_FAILURE'
        if (linkedRun) {
          linkedRun.state = failed ? 'failed' : 'succeeded'; linkedRun.stages[4].state = failed ? 'failed' : 'succeeded'; linkedRun.stages[4].completedAt = time(s)
          if (failed) linkedRun.failureCode = release.failureCode
          clearFaults(s, linkedRun.id)
        }
        stageLog(s, release, 'verify', failed ? 'verify: health gate failed; active release unchanged' : 'verify: healthy; active release switched', failed)
        if (!failed) {
          const env = environment(s, release.environmentId); env.activeReleaseId = release.id; touch(s, env); changed.push(ref('environment', env.id))
          s.observations.recoveries = s.observations.recoveries.filter(task => task.environmentId !== env.id)
          for (const incident of s.entities.incidents.filter(i => i.environmentId === env.id && i.state !== 'resolved' && i.recoverySamples > 0)) {
            incident.recoverySamples = 0; touch(s, incident); changed.push(ref('incident', incident.id))
          }
          if (release.kind === 'rollback') s.observations.recoveries.push({ environmentId: env.id, releaseId: release.id, remaining: 3, dueTick: s.logicalClock + 60 })
        }
        unschedule(s, release.id); clearFaults(s, release.id)
      }
      touch(s, release); if (linkedRun) touch(s, linkedRun)
      task.stepIndex += 1; task.dueTick = s.logicalClock + 1
      recordTransition(s, release, 'release', `release.${release.state}`, changed)
      if (release.kind === 'rollback' && release.state === 'succeeded') recordTransition(s, release, 'release', 'observation.recovery-requested', [ref('release', release.id), ref('environment', release.environmentId)])
      changes.push(...changed)
    } else unschedule(s, task.operationId)
  }
  return changes
}
