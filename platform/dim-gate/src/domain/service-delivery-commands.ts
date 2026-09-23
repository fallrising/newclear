import { createPipelineDefinitionInputSchema, createServiceConfigInputSchema, createTrafficPolicyInputSchema,
  patchPipelineDefinitionInputSchema, patchServiceConfigInputSchema, patchTrafficPolicyInputSchema,
  serviceActionInputSchema, serviceRevisionInputSchema, runPipelineDefinitionInputSchema, scenarioInputSchema,
  type Snapshot, type ServiceSource, type PipelineDefinition, type TrafficPolicy, type ServiceExecution, type CommandInput, type CommandReceipt } from './schemas'
import { type Policy } from './policy'
import { parse, fail, forbidden, notFound, clone } from './engine-shared'
import { serviceScope, serviceVisible, serviceApprovalCurrent, serviceApprovalGrants } from './service-delivery-policy'
import { serviceSource, serviceSources, serviceActive, serviceProduction, serviceTime, serviceTouch, effectiveTraffic, assertEnvironmentAvailable } from './service-delivery-shared'
import { serviceValidationErrors } from './service-delivery-validation'
import { newRun, deliveryEffect } from './delivery-commands'

const invalid = () => fail(409, 'INVALID_STATE', '目前狀態無法執行此操作。')
const checkVersion = (actual: number, expected: number) => { if (actual !== expected) fail(409, 'VERSION_CONFLICT', '資料版本已變更，請重新讀取。') }
const nextId = (s: Snapshot, prefix: string) => `${prefix}-${String(s.sequence + 1).padStart(4, '0')}`
const stamp = (s: Snapshot, orgId: string, id: string) => ({ id, orgId, version: 1, createdAt: serviceTime(s), updatedAt: serviceTime(s) })
const ref = (entityType: string, entityId: string) => ({entityType, entityId})
type Effect = CommandReceipt & {action: string; fields: string[]; reason?: string; projectIds: string[]; poolIds: string[]; stages: ('dev'|'staging'|'prod')[]}
function effect(s: Snapshot, row: ServiceSource, action: string, operationId?: string): Effect {
  const app = s.entities.applications.find(a => a.id === row.applicationId)!
  return { ...ref(row.sourceType, row.id), entityVersion: row.version, correlationId: row.correlationId,
    ...(operationId ? {operationId} : {}), changed: [ref(row.sourceType, row.id), ...(operationId ? [ref('serviceExecution', operationId)] : [])],
    action: `${row.sourceType}.${action}`, fields: ['state', 'version'], reason: row.reason, projectIds: [app.projectId], poolIds: [],
    stages: [...new Set(row.affectedEnvironmentIds.map(id => s.entities.environments.find(e => e.id === id)!.stage))] }
}
function addSource(s: Snapshot, row: ServiceSource) {
  if (row.sourceType === 'pipelineDefinition') s.entities.pipelineDefinitions.push(row)
  else if (row.sourceType === 'serviceConfig') s.entities.serviceConfigs.push(row)
  else s.entities.trafficPolicies.push(row)
}
function currentScope(s: Snapshot, p: Policy, appId: string, ids: string[], role: 'rd'|'ops' = 'rd') {
  if (!serviceScope(s, p, appId, ids, role)) forbidden()
}
function previousTargets(s: Snapshot, row: PipelineDefinition) {
  return s.entities.pipelineDefinitions.find(r => r.id === row.baseActiveRevisionId)?.spec.targetEnvironmentIds ?? []
}
function affectedTargets(s: Snapshot, row: PipelineDefinition, ids: string[]) {
  return [...new Set([...ids, ...previousTargets(s, row)])].sort()
}
function ensureValid(s: Snapshot, row: ServiceSource) {
  if (!row.validationResult?.valid || serviceValidationErrors(s, row).length) fail(409, 'VALIDATION_REQUIRED', '請修正並重新驗證此版本。')
}
function guardBase(s: Snapshot, row: ServiceSource) {
  if ((serviceActive(s, row)?.id ?? null) !== row.baseActiveRevisionId) fail(409, 'BASE_REVISION_CONFLICT', '生效版本已變更，請建立新版本。')
}
function newRevision(s: Snapshot, source: ServiceSource, actorId: string, reason: string, envVersion?: number, restore = false): ServiceSource {
  const active = serviceActive(s, source)
  const history = serviceSources(s).filter(row => row.sourceType === source.sourceType && (source.sourceType === 'pipelineDefinition'
    ? row.sourceType === 'pipelineDefinition' && row.familyId === source.familyId : row.sourceType !== 'pipelineDefinition' && row.environmentId === source.environmentId))
  const previous = history.toSorted((a, b) => b.revision - a.revision)[0]
  const result = clone(source)
  Object.assign(result, stamp(s, source.orgId, nextId(s, source.sourceType)), {state:'draft', revision: Math.max(...history.map(r => r.revision)) + 1,
    previousRevisionId: previous.id, requesterId: actorId, reason, baseActiveRevisionId: active?.id ?? null,
    validationResult: null, decisions: [], correlationId: nextId(s, 'corr-service')})
  delete result.specSnapshot; delete result.restoredFromId
  if (restore) result.restoredFromId = source.id
  if (result.sourceType === 'pipelineDefinition') result.affectedEnvironmentIds = affectedTargets(s, result, result.spec.targetEnvironmentIds)
  else {
    delete result.latestExecutionId
    result.targetEnvironmentVersion = envVersion!
    checkVersion(s.entities.environments.find(e => e.id === result.environmentId)!.version, envVersion!)
    if (result.sourceType === 'trafficPolicy') result.baseEffectiveTraffic = effectiveTraffic(s, result.environmentId)
  }
  addSource(s, result); return result
}
export function prepareServiceDelivery(s: Snapshot, p: Policy, input: CommandInput): {apply(next: Snapshot): Effect} | undefined {
  const method = input.method.toUpperCase()
  if (method === 'POST' && input.path === '/scenarios' && ['config-failure','traffic-abnormal','traffic-missing'].includes(String((input.body as {scenarioKey?: string})?.scenarioKey))) {
    const body = parse(scenarioInputSchema, input.body)
    const execution = s.entities.serviceExecutions.find(e => e.id === body.executionId) ?? notFound()
    const source = serviceSource(s, execution.sourceId) ?? notFound()
    if (!serviceVisible(s, p, source)) forbidden()
    if ((body.scenarioKey === 'config-failure') !== (execution.kind === 'config')) fail(422, 'VALIDATION_ERROR', '故障目標與情境不相容。')
    return {apply(next) {
      const e = next.entities.serviceExecutions.find(e => e.id === execution.id)!
      if (!['queued','running'].includes(e.state) || e.kind === 'config' && e.stepResults[1].state === 'succeeded') fail(422, 'VALIDATION_ERROR', '此執行已超過故障階段。')
      for (const key of ['config-failure','traffic-abnormal','traffic-missing']) delete next.scenarioFlags[`${key}:${e.id}`]
      next.scenarioFlags[`${body.scenarioKey}:${e.id}`] = true
      return {...effect(next, source, `scenario.${body.scenarioKey}`, e.id), action: `demo.scenario.${body.scenarioKey}`}
    }}
  }
  const match = /^\/(pipeline-definitions|service-configs|traffic-policies)(?:\/([^/]+)(?:\/(validate|submit|approve|reject|cancel|activate|apply|start|revisions|restore|runs))?)?$/.exec(input.path)
  if (!match || !['POST','PATCH'].includes(method)) return undefined
  const type = match[1] === 'pipeline-definitions' ? 'pipelineDefinition' : match[1] === 'service-configs' ? 'serviceConfig' : 'trafficPolicy'
  const id = match[2], action = method === 'PATCH' ? 'edit' : match[3] ?? 'create'
  const allowed = type === 'pipelineDefinition' ? ['create','edit','validate','submit','approve','reject','cancel','activate','revisions','runs']
    : type === 'serviceConfig' ? ['create','edit','validate','submit','approve','reject','cancel','apply','revisions','restore'] : ['create','edit','validate','submit','approve','reject','cancel','start','revisions']
  if (!allowed.includes(action) || action === 'create' && id || method === 'PATCH' && (!id || match[3])) fail(422, 'VALIDATION_ERROR', '不支援此來源操作。')
  if (action === 'create') {
    const body = parse(type === 'pipelineDefinition' ? createPipelineDefinitionInputSchema : type === 'serviceConfig' ? createServiceConfigInputSchema : createTrafficPolicyInputSchema, input.body)
    const ids = 'environmentId' in body ? [body.environmentId] : body.spec.targetEnvironmentIds
    currentScope(s, p, body.applicationId, ids)
    return {apply(next) {
      const orgId = p.user!.orgId, sourceId = nextId(next, type)
      const common = {...stamp(next, orgId, sourceId), applicationId: body.applicationId, requesterId: input.actorId, reason: body.reason,
        revision: 1, affectedEnvironmentIds: [...new Set(ids)].sort(), validationResult: null, decisions: [], baseActiveRevisionId: null,
        correlationId: nextId(next, 'corr-service')}
      let row: ServiceSource
      if (!('environmentId' in body)) row = {...common,sourceType:'pipelineDefinition',familyId:nextId(next,'definition-family'),name:body.name,state:'draft',spec:body.spec}
      else {
        const env = next.entities.environments.find(e => e.id === body.environmentId)!
        checkVersion(env.version, body.environmentVersion)
        const history = serviceSources(next).filter(r => r.sourceType === type && r.sourceType !== 'pipelineDefinition' && r.environmentId === env.id).toSorted((a,b) => b.revision-a.revision)
        const latest = history[0], active = history.find(r => r.state === 'active')
        const fields = {...common, environmentId: env.id, targetEnvironmentVersion: env.version, revision: (latest?.revision ?? 0)+1,
          ...(latest ? {previousRevisionId:latest.id} : {}), baseActiveRevisionId: active?.id ?? null}
        row = type === 'serviceConfig' ? {...fields,sourceType:'serviceConfig',state:'draft',spec:parse(createServiceConfigInputSchema,body).spec}
          : {...fields,sourceType:'trafficPolicy',state:'draft',spec:parse(createTrafficPolicyInputSchema,body).spec,baseEffectiveTraffic:effectiveTraffic(next,env.id)}
      }
      addSource(next,row); return effect(next,row,'create')
    }}
  }
  const source = serviceSource(s, id!)
  if (!source || source.sourceType !== type) notFound()
  const row = source!
  const role = ['approve','reject'].includes(action) ? 'ops' : 'rd'
  currentScope(s,p,row.applicationId,row.affectedEnvironmentIds,role)
  if (role === 'ops' && row.requesterId === input.actorId) fail(403,'SELF_APPROVAL_DENIED','發起者不能審批自己的變更。')
  if (role === 'rd' && !['revisions','restore','runs'].includes(action) && row.requesterId !== input.actorId) forbidden()
  if (action === 'runs' && !p.effectiveActions.includes('pipeline.trigger')) forbidden()
  const body = action === 'edit' ? parse(type === 'pipelineDefinition' ? patchPipelineDefinitionInputSchema : type === 'serviceConfig' ? patchServiceConfigInputSchema : patchTrafficPolicyInputSchema,input.body)
    : action === 'runs' ? parse(runPipelineDefinitionInputSchema,input.body)
      : ['revisions','restore'].includes(action) && type !== 'pipelineDefinition' ? parse(serviceRevisionInputSchema,input.body) : parse(serviceActionInputSchema,input.body)
  if (action === 'edit' && row.sourceType === 'pipelineDefinition') {
    const patch = parse(patchPipelineDefinitionInputSchema,body)
    currentScope(s,p,row.applicationId,affectedTargets(s,row,patch.spec.targetEnvironmentIds))
  }
  // Revision copying includes the newest family impact, even when copying older content.
  if (action === 'revisions' && row.sourceType === 'pipelineDefinition') {
    const active = serviceActive(s,row)
    currentScope(s,p,row.applicationId,[...new Set([...row.spec.targetEnvironmentIds,...(active?.sourceType === 'pipelineDefinition' ? active.spec.targetEnvironmentIds : [])])])
  }
  if (action === 'runs') {
    const run = parse(runPipelineDefinitionInputSchema,body)
    currentScope(s,p,row.applicationId,[run.environmentId])
  }
  return {apply(next) {
    const target = serviceSource(next,row.id)!
    checkVersion(target.version,body.expectedVersion)
    if (['revisions','restore'].includes(action)) {
      const version = target.sourceType === 'pipelineDefinition' ? undefined : parse(serviceRevisionInputSchema,body).environmentVersion
      return effect(next,newRevision(next,target,input.actorId,body.reason,version,action === 'restore'),action)
    }
    if (action === 'edit') {
      if (!['draft','validated'].includes(target.state)) invalid()
      if (target.sourceType === 'pipelineDefinition') {
        const patch = parse(patchPipelineDefinitionInputSchema,body); target.name=patch.name;target.spec=clone(patch.spec);target.affectedEnvironmentIds=affectedTargets(next,target,patch.spec.targetEnvironmentIds)
      } else {
        const patch = target.sourceType === 'serviceConfig' ? parse(patchServiceConfigInputSchema,body) : parse(patchTrafficPolicyInputSchema,body)
        checkVersion(next.entities.environments.find(e => e.id === target.environmentId)!.version,patch.environmentVersion)
        target.targetEnvironmentVersion=patch.environmentVersion
        if (target.sourceType === 'serviceConfig') target.spec=clone(parse(patchServiceConfigInputSchema,body).spec)
        else target.spec=clone(parse(patchTrafficPolicyInputSchema,body).spec)
      }
      target.reason=body.reason;target.state='draft';target.validationResult=null
    } else if (action === 'validate') {
      if (!['draft','validated'].includes(target.state)) invalid()
      const errors=serviceValidationErrors(next,target)
      target.validationResult={valid:errors.length===0,checkedAt:serviceTime(next),errors}; target.state=errors.length ? 'draft' : 'validated'
    } else if (action === 'submit') {
      if (target.state !== 'validated' || !serviceProduction(next,target)) invalid()
      ensureValid(next,target); target.specSnapshot=clone(target.spec) as typeof target.specSnapshot;target.state='pending_approval'
    } else if (role === 'ops') {
      if (target.state !== 'pending_approval') invalid()
      target.decisions.push({actorId:input.actorId,decision:action === 'approve' ? 'approved' : 'rejected',reason:body.reason,
        occurredAt:serviceTime(next),grantIds:serviceApprovalGrants(next,p,target)})
      target.state=action === 'approve' ? 'approved' : 'rejected'
    } else if (action === 'cancel') {
      if (!['draft','validated','pending_approval','approved'].includes(target.state)) invalid()
      target.state='cancelled'
    } else if (action === 'runs' && target.sourceType === 'pipelineDefinition') {
      if (target.state !== 'active' || !target.specSnapshot) invalid()
      const runBody=parse(runPipelineDefinitionInputSchema,body), spec=target.specSnapshot!
      if (!spec.targetEnvironmentIds.includes(runBody.environmentId)) fail(409,'TARGET_CONFLICT','所選環境不屬於此版本。')
      if (!(spec.refPattern === 'main' ? runBody.sourceRef === 'main' : runBody.sourceRef.startsWith('release/'))) fail(409,'SOURCE_REF_CONFLICT','來源 ref 不符合定義。')
      const env=next.entities.environments.find(e=>e.id===runBody.environmentId)!
      checkVersion(env.version,runBody.environmentVersion);assertEnvironmentAvailable(next,env)
      const run=newRun(next,env,input.actorId,runBody.sourceRevision)
      const {targetEnvironmentIds:_targets,...executionSpec}=spec;void _targets
      Object.assign(run,{definitionId:target.id,definitionRevision:target.revision,sourceRevision:runBody.sourceRevision,definitionSnapshot:{...clone(executionSpec),environmentId:env.id,sourceRef:runBody.sourceRef}})
      return {...deliveryEffect(next,run,'pipeline','pipelineDefinition.run',body.reason),poolIds:[]}
    } else {
      const prod=serviceProduction(next,target)
      if (target.state !== (prod ? 'approved' : 'validated')) invalid()
      if (prod && !serviceApprovalCurrent(next,target)) fail(409,'APPROVAL_STALE','批准授權已變更，請建立新版本及決策。')
      ensureValid(next,target);guardBase(next,target)
      target.specSnapshot=clone(target.spec) as typeof target.specSnapshot
      if (target.sourceType === 'pipelineDefinition') {
        const active=serviceActive(next,target)
        if(active){active.state='superseded';serviceTouch(next,active)}
        target.state='active'
      } else {
        const env=next.entities.environments.find(e=>e.id===target.environmentId)!
        checkVersion(env.version,target.targetEnvironmentVersion);assertEnvironmentAvailable(next,env)
        if(target.sourceType==='trafficPolicy') {
          const current=effectiveTraffic(next,env.id)
          if(JSON.stringify(current)!==JSON.stringify(target.baseEffectiveTraffic)) fail(409,'BASE_TRAFFIC_CONFLICT','目前流量分配已變更，請建立新版本。')
          if(current.weights.some(w=>w.weight>0&&!target.spec.targets.some(t=>t.releaseId===w.releaseId))) fail(409,'RESIDUAL_TRAFFIC_CONFLICT','新目標必須保留目前仍有流量的發布。')
        }
        const executionId=nextId(next,'service-execution')
        const common={...stamp(next,target.orgId,executionId),sourceId:target.id,applicationId:target.applicationId,environmentId:env.id,state:'running' as const,startedAt:serviceTime(next),correlationId:target.correlationId}
        const execution:ServiceExecution=target.sourceType==='serviceConfig' ? {...common,kind:'config',stepResults:['validate','render','activate'].map((name,i)=>({name:name as 'validate'|'render'|'activate',state:i===0?'running':'queued',...(i===0?{startedAt:serviceTime(next)}:{})}))}
          : {...common,kind:'traffic',priorDistribution:effectiveTraffic(next,env.id),stepResults:([10,50,100] as const).map((weight,i)=>({weight,state:i===0?'running':'queued',...(i===0?{startedAt:serviceTime(next)}:{})})),samples:[],checkpoints:[]}
        next.entities.serviceExecutions.push(execution);next.scheduler.tasks.push({id:`task-${execution.id}`,operationId:execution.id,stepIndex:0,dueTick:next.logicalClock+(execution.kind==='traffic'?30:1)})
        target.latestExecutionId=execution.id;target.state=target.sourceType==='serviceConfig'?'applying':'rolling_out';serviceTouch(next,target)
        return effect(next,target,action,execution.id)
      }
    }
    serviceTouch(next,target);return effect(next,target,action)
  }}
}

export function advanceServiceDelivery(s: Snapshot): CommandReceipt['changed'] {
  const changes:CommandReceipt['changed']=[]
  const due=s.scheduler.tasks.filter(t=>t.dueTick<=s.logicalClock&&s.entities.serviceExecutions.some(e=>e.id===t.operationId)).toSorted((a,b)=>a.id.localeCompare(b.id))
  for(const task of due) {
    const execution=s.entities.serviceExecutions.find(e=>e.id===task.operationId)!
    const source=serviceSource(s,execution.sourceId)!
    const step=execution.stepResults[task.stepIndex]
    let failure:string|undefined, complete:boolean
    if(execution.kind==='config') {
      failure=task.stepIndex===1&&s.scenarioFlags[`config-failure:${execution.id}`]===true?'SIMULATED_CONFIG_FAILURE':undefined
      complete=!failure
    } else {
      const policy=source as TrafficPolicy,spec=policy.specSnapshot!,weight=execution.stepResults[task.stepIndex].weight
      const missing=s.scenarioFlags[`traffic-missing:${execution.id}`]===true,abnormal=s.scenarioFlags[`traffic-abnormal:${execution.id}`]===true
      const to=serviceTime(s),from=new Date(Date.parse(to)-30_000).toISOString()
      const sample={id:`sample-${execution.id}-${execution.samples.length+1}`,policyId:source.id,executionId:execution.id,step:weight,
        candidateReleaseId:spec.targets[1].releaseId,from,to,p95LatencyMs:missing?null:abnormal?900:120,errorRate:missing?null:abnormal?0.08:0.002,source:'demo' as const}
      execution.samples.push(sample)
      if(sample.p95LatencyMs!==null&&sample.errorRate!==null&&(sample.p95LatencyMs>spec.thresholds.p95LatencyMs||sample.errorRate>spec.thresholds.errorRate)) failure='TRAFFIC_HEALTH_FAILED'
      const samples=execution.samples.filter(v=>v.step===weight).slice(-spec.healthWindowSeconds/30)
      complete=!failure&&samples.length===spec.healthWindowSeconds/30&&samples.every(v=>v.p95LatencyMs!==null&&v.errorRate!==null)
        &&Date.parse(samples.at(-1)!.to)-Date.parse(samples[0].from)===spec.healthWindowSeconds*1000
      if(complete) execution.checkpoints.push({id:`checkpoint-${execution.id}-${weight}`,step:weight,weights:[{releaseId:spec.targets[0].releaseId,weight:100-weight},{releaseId:spec.targets[1].releaseId,weight}],windowStart:samples[0].from,verifiedAt:to,sampleIds:samples.map(v=>v.id)})
      else if(!failure&&Date.parse(to)-Date.parse(step.startedAt!)>=spec.timeoutSeconds*1000) failure='TRAFFIC_HEALTH_TIMEOUT'
    }
    if(failure) {
      step.state='failed';step.completedAt=serviceTime(s);execution.state='failed';execution.failureCode=failure;source.state='failed'
      for(const remaining of execution.stepResults)if(remaining.state==='queued')remaining.state='skipped'
    } else if(complete) {
      step.state='succeeded';step.completedAt=serviceTime(s)
      if(task.stepIndex===2) {
        const active=serviceActive(s,source)
        if(active){active.state='superseded';serviceTouch(s,active);changes.push(ref(active.sourceType,active.id))}
        execution.state='succeeded';source.state='active'
        if(execution.kind==='config') {const env=s.entities.environments.find(e=>e.id===execution.environmentId)!;serviceTouch(s,env);changes.push(ref('environment',env.id))}
      } else {task.stepIndex++;const next=execution.stepResults[task.stepIndex];next.state='running';next.startedAt=serviceTime(s)}
    }
    if(['succeeded','failed'].includes(execution.state)) {
      execution.completedAt=serviceTime(s);s.scheduler.tasks=s.scheduler.tasks.filter(t=>t.operationId!==execution.id)
      for(const key of ['config-failure','traffic-abnormal','traffic-missing'])delete s.scenarioFlags[`${key}:${execution.id}`]
    } else task.dueTick=s.logicalClock+(execution.kind==='traffic'?30:1)
    serviceTouch(s,execution);serviceTouch(s,source)
    const changed=[ref(source.sourceType,source.id),ref('serviceExecution',execution.id)];changes.push(...changed)
    s.sequence++;const serial=String(s.sequence).padStart(4,'0'),action=`${source.sourceType}.${execution.state==='running'?'step':execution.state}`
    const result=effect(s,source,action,execution.id)
    s.events.push({eventId:`event-${serial}`,entities:changed,type:action,occurredAt:serviceTime(s),correlationId:source.correlationId})
    s.audit.push({id:`audit-${serial}`,orgId:source.orgId,actorId:'demo-scheduler',action,entityType:source.sourceType,entityId:source.id,
      scopeSnapshot:{projectIds:result.projectIds,poolIds:[],stages:result.stages},outcome:'succeeded',diffSummary:[`state: ${source.state}`],requestId:`scheduler-${serial}`,correlationId:source.correlationId,occurredAt:serviceTime(s)})
  }
  return changes
}
