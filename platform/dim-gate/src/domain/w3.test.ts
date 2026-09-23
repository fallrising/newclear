import { describe, expect, it } from 'vitest'
import { createSeed } from '../demo/seed'
import { createEngine } from './engine'
import { integrityErrors } from './integrity'
import { pipelineDefinitionDetailSchema, serviceConfigDetailSchema, trafficPolicyDetailSchema, deliveryOptionsSchema, workItemSchema,
  type Snapshot, type ServiceSource, type PipelineDefinition, type ServiceConfig, type TrafficPolicy, type TrafficPolicyDetail, type ServiceConfigDetail } from './schemas'
const rd='user-rd-commerce',ops='user-ops',admin='user-admin',data='user-rd-data'
function harness(initial=createSeed('w3-test'),persist:(s:Snapshot)=>void=()=>undefined) {
  let sequence=0
  const engine=createEngine(initial,persist)
  const command=(path:string,body:unknown,actorId=rd,key=`w3-${++sequence}`,method='POST')=>engine.command({sessionId:initial.sessionId,actorId,path,body,key,method})
  const read=<T>(path:string,actor=rd,query='')=>engine.read(path,new URLSearchParams(query),actor) as T
  const source=(id:string)=>[...engine.getSnapshot().entities.pipelineDefinitions,...engine.getSnapshot().entities.serviceConfigs,...engine.getSnapshot().entities.trafficPolicies].find(r=>r.id===id)!
  const path=(row:ServiceSource)=>`/${row.sourceType==='pipelineDefinition'?'pipeline-definitions':row.sourceType==='serviceConfig'?'service-configs':'traffic-policies'}/${row.id}`
  const action=(id:string,action:string,extra:Record<string,unknown>={},actor=rd,key?:string)=>command(`${path(source(id))}/${action}`,{expectedVersion:source(id).version,reason:'Meaningful W3 domain regression',...extra},actor,key)
  const env=(id='env-checkout-dev')=>engine.getSnapshot().entities.environments.find(e=>e.id===id)!
  const advance=(ticks=1)=>command('/clock/advance',{ticks},ops)
  const success=async(revision:string,id='env-checkout-dev')=>{const r=await command('/pipelines',{applicationId:env(id).applicationId,environmentId:id,environmentVersion:env(id).version,revision});await advance(6);return engine.getSnapshot().entities.releases.find(v=>v.pipelineRunId===r.entityId)!}
  const traffic=async()=>{
    const a=await success('baseline'),b=await success('candidate')
    const result=await command('/traffic-policies',{applicationId:'app-checkout',environmentId:env().id,environmentVersion:env().version,reason:'Verify canary samples',spec:{endpointRef:'w3-endpoint-checkout',matchRef:'demo-path-api-v1',targets:[{releaseId:b.id,weight:0},{releaseId:a.id,weight:100}],healthWindowSeconds:60,timeoutSeconds:120,thresholds:{p95LatencyMs:500,errorRate:0.05}}})
    await action(result.entityId,'validate');return result.entityId
  }
  return {engine,command,read,source,path,action,env,advance,success,traffic}
}
const configId='w3-config-checkout-dev-1',definitionId='w3-definition-checkout-1'

describe('W3 canonical delivery execution',()=>{
  it('keeps typed draft validation, immutable runs and execution snapshots across definition revisions and retry',async()=>{
    const h=harness();await h.action(definitionId,'validate');await h.action(definitionId,'activate')
    const source=h.source(definitionId) as PipelineDefinition
    const receipt=await h.action(definitionId,'runs',{environmentId:h.env().id,environmentVersion:h.env().version,sourceRef:'main',sourceRevision:'sha-first'})
    const run=h.engine.getSnapshot().entities.pipelines.find(r=>r.id===receipt.entityId)!
    expect(run).toMatchObject({definitionId,definitionRevision:1,sourceRevision:'sha-first',revision:'sha-first'})
    expect(run.definitionSnapshot).not.toHaveProperty('targetEnvironmentIds');expect(run.artifactDigest).toBeUndefined()
    await h.command('/scenarios',{scenarioKey:'build-failure',runId:run.id});await h.advance()
    const revised=await h.action(definitionId,'revisions')
    await h.action(revised.entityId,'validate');await h.action(revised.entityId,'activate')
    expect((h.source(definitionId) as PipelineDefinition).specSnapshot).toEqual(source.specSnapshot)
    const failed=h.engine.getSnapshot().entities.pipelines.find(r=>r.id===run.id)!
    const retry=await h.command(`/pipelines/${run.id}/retry`,{expectedVersion:failed.version,reason:'Retry original frozen definition'})
    expect(h.engine.getSnapshot().entities.pipelines.find(r=>r.id===retry.entityId)?.definitionSnapshot).toEqual(run.definitionSnapshot)
    await h.advance(6)
    expect(h.engine.getSnapshot().entities.pipelines.find(r=>r.id===retry.entityId)?.state).toBe('succeeded')
    expect(pipelineDefinitionDetailSchema.safeParse(h.read(h.path(h.source(definitionId)))) .success).toBe(true)
    expect(integrityErrors(h.engine.getSnapshot())).toEqual([])
  })
  it('records semantic validation errors, then invalidates edited validation and rejects unsafe secret literals',async()=>{
    const h=harness(),source=h.source(configId) as ServiceConfig
    const duplicate=[...source.spec.entries,source.spec.entries[0]]
    await h.command(h.path(source),{expectedVersion:source.version,environmentVersion:1,reason:'Check duplicate keys',spec:{entries:duplicate}},rd,undefined,'PATCH')
    await h.action(configId,'validate')
    expect(h.source(configId)).toMatchObject({state:'draft',validationResult:{valid:false,errors:[{field:'spec.entries.4.key'}]}})
    await h.command(h.path(source),{expectedVersion:h.source(configId).version,environmentVersion:1,reason:'Correct keys',spec:source.spec},rd,undefined,'PATCH')
    await h.action(configId,'validate');expect(h.source(configId).state).toBe('validated')
    await expect(h.command(h.path(source),{expectedVersion:h.source(configId).version,environmentVersion:1,reason:'Unsafe secret',spec:{entries:[{key:'SECRET',description:'',valueType:'secretRef',value:'password-plaintext'}]}},rd,undefined,'PATCH')).rejects.toMatchObject({status:422})
    const updated={...source.spec,entries:[...source.spec.entries.slice(0,1)]}
    await h.command(h.path(source),{expectedVersion:h.source(configId).version,environmentVersion:1,reason:'New content',spec:updated},rd,undefined,'PATCH')
    expect(h.source(configId)).toMatchObject({state:'draft',validationResult:null})
  })
  it('applies config atomically; failed render keeps active, and restore creates a new draft with typed diff',async()=>{
    const h=harness();await h.success('stable')
    const original=h.source(configId) as ServiceConfig
    await h.command(h.path(original),{expectedVersion:1,environmentVersion:h.env().version,reason:'Bind current environment',spec:original.spec},rd,undefined,'PATCH')
    await h.action(configId,'validate');await h.action(configId,'apply');const release=h.env().activeReleaseId
    await h.advance(3);expect(h.source(configId).state).toBe('active');expect(h.env().activeReleaseId).toBe(release)
    const next=await h.action(configId,'revisions',{environmentVersion:h.env().version})
    await h.action(next.entityId,'validate');const start=await h.action(next.entityId,'apply')
    await h.command('/scenarios',{scenarioKey:'config-failure',executionId:start.operationId});await h.advance(3)
    const detail=h.read<ServiceConfigDetail>(h.path(h.source(next.entityId)))
    expect(detail.source.state).toBe('failed');expect(detail.active?.id).toBe(configId);expect(detail.executions[0]).toMatchObject({state:'failed',failureCode:'SIMULATED_CONFIG_FAILURE'})
    const restored=await h.action(configId,'restore',{environmentVersion:h.env().version})
    expect(h.source(restored.entityId)).toMatchObject({state:'draft',restoredFromId:configId,revision:3,validationResult:null,decisions:[]})
    expect(serviceConfigDetailSchema.safeParse(detail).success).toBe(true)
  })
  it('requires two actual 30-second samples per checkpoint, retains verified 10 after abnormal 50, and never changes active release',async()=>{
    const h=harness(),id=await h.traffic(),activeReleaseId=h.env().activeReleaseId
    const start=await h.action(id,'start');await h.advance(59)
    let detail=h.read<TrafficPolicyDetail>(h.path(h.source(id)))
    expect(detail.executions[0].samples).toHaveLength(1);expect(detail.executions[0].checkpoints).toEqual([])
    await h.advance();detail=h.read(h.path(h.source(id)))
    expect(detail.effective.weights.map(w=>w.weight)).toEqual([90,10]);expect(detail.currentStep).toBe(50)
    await h.command('/scenarios',{scenarioKey:'traffic-abnormal',executionId:start.operationId});await h.advance(30)
    detail=h.read(h.path(h.source(id)))
    expect(detail.source.state).toBe('failed');expect(detail.effective.weights.map(w=>w.weight)).toEqual([90,10]);expect(detail.executions[0].samples.at(-1)).toMatchObject({p95LatencyMs:900,errorRate:0.08})
    expect(h.env().activeReleaseId).toBe(activeReleaseId);expect(trafficPolicyDetailSchema.safeParse(detail).success).toBe(true)
    expect(integrityErrors(h.engine.getSnapshot())).toEqual([])
  })
  it('unknown probes wait and timeout at 120; threshold values are evaluated and healthy windows reach 100',async()=>{
    const h=harness(),id=await h.traffic(),start=await h.action(id,'start')
    await h.command('/scenarios',{scenarioKey:'traffic-missing',executionId:start.operationId});await h.advance(60)
    expect(h.source(id).state).toBe('rolling_out');await h.advance(60);expect(h.source(id).state).toBe('failed')
    let detail=h.read<TrafficPolicyDetail>(h.path(h.source(id)))
    expect(detail.executions[0].failureCode).toBe('TRAFFIC_HEALTH_TIMEOUT');expect(detail.effective.origin).toBe('activeReleaseFallback')
    const next=await h.action(id,'revisions',{environmentVersion:h.env().version});await h.action(next.entityId,'validate');await h.action(next.entityId,'start')
    for(let i=0;i<3;i++)await h.advance(60)
    detail=h.read(h.path(h.source(next.entityId)));expect(detail.source.state).toBe('active');expect(detail.executions[0].checkpoints).toHaveLength(3);expect(detail.effective.weights.map(w=>w.weight)).toEqual([0,100])
    const strict=await h.action(next.entityId,'revisions',{environmentVersion:h.env().version}),source=h.source(strict.entityId) as TrafficPolicy
    await h.command(h.path(source),{expectedVersion:source.version,environmentVersion:h.env().version,reason:'Stricter real threshold',spec:{...source.spec,thresholds:{p95LatencyMs:100,errorRate:0.05}}},rd,undefined,'PATCH')
    await h.action(source.id,'validate');await h.action(source.id,'start');await h.advance(30)
    expect(h.source(source.id).state).toBe('failed')
  })
})

describe('W3 policy, locks and durable proof',()=>{
  it('anchors production removal impact to the active definition across an unapproved copy chain',async()=>{
    const h=harness(),source=h.source(definitionId) as PipelineDefinition
    await h.command(h.path(source),{expectedVersion:1,name:source.name,reason:'Include production',spec:{...source.spec,targetEnvironmentIds:['env-checkout-dev','env-checkout-prod']}},rd,undefined,'PATCH')
    await h.action(definitionId,'validate');await h.action(definitionId,'submit')
    await expect(h.action(definitionId,'activate')).rejects.toMatchObject({status:409})
    await h.action(definitionId,'approve',{},ops);await h.action(definitionId,'activate')
    const second=await h.action(definitionId,'revisions'),r2=h.source(second.entityId) as PipelineDefinition
    await h.command(h.path(r2),{expectedVersion:r2.version,name:r2.name,reason:'Remove prod from proposed targets',spec:{...r2.spec,targetEnvironmentIds:['env-checkout-dev']}},rd,undefined,'PATCH')
    const third=await h.action(r2.id,'revisions'),r3=h.source(third.entityId) as PipelineDefinition
    expect(r3.baseActiveRevisionId).toBe(definitionId);expect(r3.affectedEnvironmentIds).toContain('env-checkout-prod')
    await h.action(r3.id,'validate');await expect(h.action(r3.id,'activate')).rejects.toMatchObject({status:409})
    await h.action(r3.id,'submit');expect(h.source(r3.id).state).toBe('pending_approval')
    const changed=h.engine.getSnapshot(),grant=changed.entities.assignments.find(g=>g.userId===rd&&g.scopeId==='project-store')!
    grant.stages=['dev']
    const partial=harness(changed)
    expect(()=>partial.read(`/pipeline-definitions/${r3.id}`)).toThrow(expect.objectContaining({status:404}))
    await expect(partial.action(r3.id,'cancel')).rejects.toMatchObject({status:403})
  })
  it('requires current independent approval and denies Admin-only, pool-only and same-key replay after revocation',async()=>{
    const h=harness(),body={applicationId:'app-checkout',environmentId:'env-checkout-prod',environmentVersion:h.env('env-checkout-prod').version,reason:'Prod service config',spec:{entries:[]}}
    await expect(h.command('/service-configs',body,admin)).rejects.toMatchObject({status:403})
    const receipt=await h.command('/service-configs',body,rd,'create-prod'),id=receipt.entityId
    await h.action(id,'validate');await h.action(id,'submit')
    const seed=h.engine.getSnapshot(),ownOps=seed.entities.assignments.find(g=>g.userId===ops&&g.scopeId==='project-store')!
    seed.entities.assignments.push({...ownOps,id:'self-ops-grant',userId:rd})
    const self=harness(seed)
    await expect(self.action(id,'approve')).rejects.toMatchObject({status:403,code:'SELF_APPROVAL_DENIED'})
    await h.action(id,'approve',{},ops)
    const grant=h.engine.getSnapshot().entities.assignments.find(g=>g.userId===ops&&g.scopeId==='project-store')!
    await h.command(`/admin/assignments/${grant.id}`,{expectedVersion:grant.version,reason:'Revoke approver project grant'},admin,undefined,'DELETE')
    await expect(h.action(id,'apply')).rejects.toMatchObject({status:409,code:'APPROVAL_STALE'})
    await expect(h.command(`/service-configs/${id}/approve`,{expectedVersion:3,reason:'Meaningful W3 domain regression'},ops)).rejects.toMatchObject({status:403})
    const requester=h.engine.getSnapshot().entities.assignments.find(g=>g.userId===rd&&g.scopeId==='project-store')!
    await h.command(`/admin/assignments/${requester.id}`,{expectedVersion:requester.version,reason:'Revoke requester'},admin,undefined,'DELETE')
    await expect(h.command('/service-configs',body,rd,'create-prod')).rejects.toMatchObject({status:403})
  })
  it('enforces original release/config/traffic locks in both directions, including original prod approval waits',async()=>{
    const h=harness(),id=await h.traffic()
    const c=h.source(configId) as ServiceConfig
    await h.command(h.path(c),{expectedVersion:c.version,environmentVersion:h.env().version,reason:'Latest environment',spec:c.spec},rd,undefined,'PATCH');await h.action(configId,'validate')
    const old=await h.command('/pipelines',{applicationId:'app-checkout',environmentId:h.env().id,environmentVersion:h.env().version,revision:'blocking-old-run'})
    await expect(h.action(configId,'apply')).rejects.toMatchObject({status:409,code:'ENVIRONMENT_BUSY'})
    await expect(h.action(id,'start')).rejects.toMatchObject({status:409,code:'ENVIRONMENT_BUSY'})
    await h.command(`/pipelines/${old.entityId}/cancel`,{expectedVersion:1,reason:'Release lock'})
    await h.action(configId,'apply')
    await expect(h.command('/pipelines',{applicationId:'app-checkout',environmentId:h.env().id,environmentVersion:h.env().version,revision:'blocked-by-config'})).rejects.toMatchObject({status:409,code:'ENVIRONMENT_BUSY'})
    const active=h.engine.getSnapshot().entities.releases.find(r=>r.id===h.env().activeReleaseId)!,previous=h.engine.getSnapshot().entities.releases.find(r=>r.id!==active.id)!
    await expect(h.command(`/releases/${active.id}/rollback`,{expectedVersion:active.version,environmentVersion:h.env().version,targetReleaseId:previous.id,reason:'Blocked rollback'})).rejects.toMatchObject({status:409,code:'ENVIRONMENT_BUSY'})
    await h.advance(3)
    const revised=await h.action(id,'revisions',{environmentVersion:h.env().version});await h.action(revised.entityId,'validate');await h.action(revised.entityId,'start')
    await expect(h.command('/pipelines',{applicationId:'app-checkout',environmentId:h.env().id,environmentVersion:h.env().version,revision:'blocked-by-traffic'})).rejects.toMatchObject({status:409,code:'ENVIRONMENT_BUSY'})
    const prod=await h.command('/service-configs',{applicationId:'app-checkout',environmentId:'env-checkout-prod',environmentVersion:1,reason:'Prod config pending does not lock',spec:{entries:[]}})
    await h.action(prod.entityId,'validate');await h.action(prod.entityId,'submit');await h.action(prod.entityId,'approve',{},ops)
    await h.command('/pipelines',{applicationId:'app-checkout',environmentId:'env-checkout-prod',environmentVersion:1,revision:'prod-approval-lock'})
    await h.advance(3)
    await expect(h.action(prod.entityId,'apply')).rejects.toMatchObject({status:409,code:'ENVIRONMENT_BUSY'})
  })
  it('serializes concurrent applies and leaves state, history, samples, receipts and clock intact after persistence failure',async()=>{
    let fail=false,saved:Snapshot|undefined
    const h=harness(undefined,next=>{if(fail)throw new Error('QuotaExceededError');saved=next})
    await h.action(configId,'validate')
    const outcomes=await Promise.allSettled([h.action(configId,'apply'),h.action(configId,'apply')])
    expect(outcomes.map(r=>r.status)).toEqual(['fulfilled','rejected'])
    const before=h.engine.getSnapshot();fail=true
    await expect(h.advance(3)).rejects.toMatchObject({status:507});expect(h.engine.getSnapshot()).toEqual(before);expect(saved).toEqual(before)
    fail=false;await h.advance(3);expect(h.source(configId).state).toBe('active');expect(h.engine.getSnapshot().entities.serviceExecutions).toHaveLength(1)
    const traffic=harness(),id=await traffic.traffic();await traffic.action(id,'start');await traffic.advance(30)
    const resumed=harness(traffic.engine.getSnapshot());await resumed.advance(30)
    expect((resumed.read<TrafficPolicyDetail>(resumed.path(resumed.source(id)))).executions[0].samples).toHaveLength(2)
    expect(integrityErrors(resumed.engine.getSnapshot())).toEqual([])
  })
  it('rejects corrupt scheduler, sample and checkpoint proofs at startup without repairing bytes',async()=>{
    const h=harness(),id=await h.traffic();await h.action(id,'start');await h.advance(60)
    const good=h.engine.getSnapshot()
    const mutations:((s:Snapshot)=>void)[]=[
      s=>{s.scheduler.tasks=[]},s=>{s.scheduler.tasks[0].stepIndex=0},s=>{s.scheduler.tasks[0].dueTick++},
      s=>{const e=s.entities.serviceExecutions[0];if(e.kind==='traffic')e.samples[0].candidateReleaseId='missing'},
      s=>{const e=s.entities.serviceExecutions[0];if(e.kind==='traffic')e.samples[1].from=e.samples[0].from},
      s=>{const e=s.entities.serviceExecutions[0];if(e.kind==='traffic')e.checkpoints[0].weights[0].weight=95},
      s=>{const e=s.entities.serviceExecutions[0];if(e.kind==='traffic')e.checkpoints[0].sampleIds=[e.samples[0].id,e.samples[0].id]},
    ]
    for(const mutate of mutations){const bad=structuredClone(good);mutate(bad);const original=JSON.stringify(bad);expect(()=>createEngine(bad,()=>undefined)).toThrow(expect.objectContaining({code:'INVALID_SNAPSHOT'}));expect(JSON.stringify(bad)).toBe(original)}
  })
  it('uses scoped options and source predicates across list, search, WorkItems, home, audit and notifications',async()=>{
    const h=harness();await h.action(configId,'validate');await h.action(configId,'apply');await h.advance(3)
    expect(deliveryOptionsSchema.safeParse(h.read('/applications/app-checkout/delivery-options',rd,'environmentId=env-checkout-dev')).success).toBe(true)
    expect(()=>h.read('/applications/app-checkout/delivery-options',rd,'environmentId=env-data-dev')).toThrow(expect.objectContaining({status:404}))
    const items=h.read<{items:unknown[]}>('/work-items',rd,'center=rd&owner=team&source=serviceConfig')
    expect(items.items.length).toBeGreaterThan(0);for(const item of items.items)expect(workItemSchema.safeParse(item).success).toBe(true)
    for(const actor of [data,admin]) {
      expect(()=>h.read(`/service-configs/${configId}`,actor)).toThrow(expect.objectContaining({status:404}))
      expect(JSON.stringify(h.read('/search',actor,'q=w3-config-checkout'))).not.toContain(configId)
      expect(JSON.stringify(h.read('/audit',actor,`entityType=serviceConfig&entityId=${configId}`))).not.toContain(configId)
      expect(JSON.stringify(h.read('/notifications',actor))).not.toContain(configId)
    }
    const grant=h.engine.getSnapshot().entities.assignments.find(g=>g.userId===rd&&g.scopeId==='project-store')!
    await h.command(`/admin/assignments/${grant.id}`,{expectedVersion:grant.version,reason:'Remove old scope'},admin,undefined,'DELETE')
    expect(()=>h.read(`/service-configs/${configId}`)).toThrow(expect.objectContaining({status:404}))
    expect(JSON.stringify(h.read('/dashboard',rd,'center=rd'))).not.toContain(configId)
  })
})
