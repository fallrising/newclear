import type { Snapshot } from './schemas'

export function deliveryIntegrityErrors(s: Snapshot): string[] {
  const errors: string[] = []
  const { pipelines, releases, environments, artifacts } = s.entities
  const liveRun = pipelines.filter(r => !['succeeded', 'failed', 'cancelled'].includes(r.state))
  const liveRelease = releases.filter(r => !['succeeded', 'failed', 'rejected', 'cancelled'].includes(r.state))
  if (new Set(artifacts.map(a => a.digest)).size !== artifacts.length) errors.push('artifact: duplicate digest')
  for (const artifact of artifacts) if (!s.entities.applications.some(a => a.id === artifact.applicationId && a.orgId === artifact.orgId)) errors.push('artifact: invalid application')
  for (const run of pipelines) {
    const env = environments.find(e => e.id === run.environmentId && e.orgId === run.orgId && e.applicationId === run.applicationId)
    if (!env || !s.entities.users.some(u => u.id === run.triggeredBy && u.orgId === run.orgId)) errors.push('pipeline: invalid scope/actor')
    if (run.stages.map(stage => stage.name).join(',') !== 'build,test,package,deploy,verify') errors.push('pipeline: invalid stages')
    if (run.retryOfRunId && !pipelines.some(r => r.id === run.retryOfRunId && r.environmentId === run.environmentId && ['failed', 'cancelled'].includes(r.state))) errors.push('pipeline: invalid retry history')
    if (run.releaseId && !releases.some(r => r.id === run.releaseId && r.pipelineRunId === run.id && r.environmentId === run.environmentId && r.artifactDigest === run.artifactDigest)) errors.push('pipeline: invalid release')
    if (run.artifactDigest && !artifacts.some(a => a.digest === run.artifactDigest && a.applicationId === run.applicationId && a.revision === run.revision)) errors.push('pipeline: invalid artifact')
    if (run.state === 'succeeded' && (!run.stages.every(stage => stage.state === 'succeeded') || !releases.some(r => r.id === run.releaseId && r.state === 'succeeded'))) errors.push('pipeline: invalid success')
  }
  for (const release of releases) {
    const env = environments.find(e => e.id === release.environmentId && e.orgId === release.orgId && e.applicationId === release.applicationId)
    if (!env || !s.entities.users.some(u => u.id === release.createdBy && u.orgId === release.orgId)) errors.push('release: invalid scope/actor')
    if (!artifacts.some(a => a.digest === release.artifactDigest && a.orgId === release.orgId && a.applicationId === release.applicationId)) errors.push('release: missing artifact')
    if (release.previousReleaseId && !releases.some(r => r.id === release.previousReleaseId && r.environmentId === release.environmentId && r.state === 'succeeded' && r.id !== release.id)) errors.push('release: invalid previous')
    if (release.kind === 'rollback' && !releases.some(r => r.id === release.targetReleaseId && r.environmentId === release.environmentId && r.state === 'succeeded' && r.artifactDigest === release.artifactDigest && r.id !== release.id)) errors.push('release: invalid rollback target')
    if (release.kind === 'deploy' && !pipelines.some(r => r.id === release.pipelineRunId && r.releaseId === release.id && r.environmentId === release.environmentId)) errors.push('release: invalid pipeline')
    if (release.state === 'succeeded' && release.health !== 'healthy' || release.state === 'failed' && release.health !== 'unhealthy') errors.push('release: invalid health state')
    if (release.approval && (release.approval.actorId === release.createdBy || !s.entities.users.some(u => u.id === release.approval!.actorId && u.orgId === release.orgId))) errors.push('release: invalid approval actor')
    if (env?.stage === 'prod' && ['queued', 'deploying', 'verifying', 'succeeded', 'failed'].includes(release.state) && !release.approval) errors.push('release: missing prod approval')
  }
  for (const env of environments) {
    if (env.activeReleaseId && !releases.some(r => r.id === env.activeReleaseId && r.environmentId === env.id && r.state === 'succeeded' && r.health === 'healthy')) errors.push('environment: invalid active release')
    const operations = new Set([
      ...liveRun.filter(r => r.environmentId === env.id).map(r => r.id),
      ...liveRelease.filter(r => r.environmentId === env.id).map(r => r.pipelineRunId ?? r.id),
    ])
    if (operations.size > 1) errors.push('environment: conflicting operations')
  }
  const expectedTasks = [
    ...liveRun.filter(r => !r.releaseId).map(r => r.id),
    ...liveRelease.filter(r => r.state !== 'pending_approval').map(r => r.id),
  ]
  for (const id of expectedTasks) if (s.scheduler.tasks.filter(t => t.operationId === id).length !== 1) errors.push('delivery: missing/duplicate scheduler task')
  for (const task of s.scheduler.tasks) if ((pipelines.some(r => r.id === task.operationId) || releases.some(r => r.id === task.operationId)) && !expectedTasks.includes(task.operationId)) errors.push('delivery: ghost scheduler task')
  for (const log of s.deliveryLogs) if (![...pipelines, ...releases].some(r => r.id === log.operationId && r.applicationId === log.applicationId && r.environmentId === log.environmentId)) errors.push('delivery: invalid log reference')
  return errors
}
