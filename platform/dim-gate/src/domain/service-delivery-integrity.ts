import type { Snapshot, ServiceSource, TrafficDistribution, TrafficExecution, TrafficPolicy } from './schemas'
import { serviceSources, executionLocks, serviceProduction } from './service-delivery-shared'
import { serviceValidationErrors } from './service-delivery-validation'
const equal = (a: unknown,b: unknown) => JSON.stringify(a)===JSON.stringify(b)
export function serviceDeliveryIntegrityErrors(s: Snapshot): string[] {
  const errors: string[] = [], rows=serviceSources(s), e=s.entities
  const now=Date.parse('2026-09-20T09:00:00Z')+s.logicalClock*1000
  const error=(message:string)=>errors.push(`service delivery: ${message}`)
  const group=(row:ServiceSource)=>`${row.sourceType}:${row.sourceType==='pipelineDefinition'?row.familyId:row.environmentId}`
  const groups=new Map<string,ServiceSource[]>()
  for(const row of rows) groups.set(group(row),[...(groups.get(group(row))??[]),row])
  if(new Set(rows.map(r=>r.id)).size!==rows.length)error('duplicate source identity')
  const distribution=(value:TrafficDistribution,environmentId:string)=>{
    const releases=value.weights.map(w=>e.releases.find(r=>r.id===w.releaseId&&r.environmentId===environmentId&&r.state==='succeeded'&&r.health==='healthy'))
    if(releases.some(r=>!r)||new Set(value.weights.map(w=>w.releaseId)).size!==value.weights.length||value.weights.length&&value.weights.reduce((a,b)=>a+b.weight,0)!==100)error('invalid distribution targets')
    if(value.origin==='unknown'&&(value.weights.length||value.policyId||value.executionId||value.checkpointId||value.verifiedAt))error('invalid unknown distribution')
    if(value.origin==='activeReleaseFallback'&&(value.weights.length!==1||value.weights[0].weight!==100||value.policyId||value.executionId||value.checkpointId||value.verifiedAt))error('invalid unmeasured fallback')
    if(value.origin==='checkpoint') {
      const execution=e.serviceExecutions.find(x=>x.id===value.executionId&&x.sourceId===value.policyId&&x.environmentId===environmentId)
      const cp=execution?.kind==='traffic'?execution.checkpoints.find(c=>c.id===value.checkpointId):undefined
      if(!cp||!equal(cp.weights,value.weights)||cp.verifiedAt!==value.verifiedAt)error('invalid checkpoint distribution')
    }
  }
  for(const history of groups.values()) {
    history.sort((a,b)=>a.revision-b.revision)
    if(history.some((r,i)=>r.revision!==i+1)||history.filter(r=>r.state==='active').length>1)error('invalid revision sequence or multiple active revisions')
    for(const row of history) {
      const app=e.applications.find(a=>a.id===row.applicationId&&a.orgId===row.orgId)
      if(!app||!e.users.some(u=>u.id===row.requesterId&&u.orgId===row.orgId))error('invalid source scope or requester')
      if(new Set(row.affectedEnvironmentIds).size!==row.affectedEnvironmentIds.length||row.affectedEnvironmentIds.some(id=>!e.environments.some(env=>env.id===id&&env.applicationId===row.applicationId&&env.orgId===row.orgId)))error('invalid affected environments')
      const previous=rows.find(r=>r.id===row.previousRevisionId)
      if(row.revision>1&&(!previous||group(previous)!==group(row)||previous.revision!==row.revision-1)||row.revision===1&&row.previousRevisionId)error('invalid previous revision')
      if(row.baseActiveRevisionId&&!history.some(r=>r.id===row.baseActiveRevisionId&&r.revision<row.revision&&['active','superseded'].includes(r.state)))error('invalid base active revision')
      if(row.restoredFromId&&(row.sourceType!=='serviceConfig'||!history.some(r=>r.id===row.restoredFromId&&r.revision<row.revision)))error('invalid restore provenance')
      if(row.sourceType==='pipelineDefinition') {
        const baseline=rows.find(r=>r.id===row.baseActiveRevisionId)
        const required=[...new Set([...row.spec.targetEnvironmentIds,...(baseline?.sourceType==='pipelineDefinition'?baseline.spec.targetEnvironmentIds:[])])].sort()
        if(!equal(required,[...row.affectedEnvironmentIds].sort()))error('incomplete definition impact')
        if(history.some(r=>r.applicationId!==row.applicationId||r.orgId!==row.orgId))error('definition family scope mismatch')
      } else {
        const env=e.environments.find(env=>env.id===row.environmentId)
        if(!env||env.applicationId!==row.applicationId||env.orgId!==row.orgId||!equal(row.affectedEnvironmentIds,[row.environmentId])||row.targetEnvironmentVersion>env.version)error('invalid source environment version')
        if(row.sourceType==='trafficPolicy')distribution(row.baseEffectiveTraffic,row.environmentId)
      }
      const frozen=!['draft','validated','cancelled'].includes(row.state)
      if(frozen&&!row.specSnapshot||row.specSnapshot&&!equal(row.spec,row.specSnapshot))error('missing or changed frozen spec')
      if(row.validationResult&&(row.validationResult.valid!==!row.validationResult.errors.length))error('inconsistent validation result')
      if(!['draft','cancelled'].includes(row.state)&&(!row.validationResult?.valid||serviceValidationErrors(s,row).length))error('invalid validated source')
      if(row.decisions.some(d=>d.actorId===row.requesterId||!e.users.some(u=>u.id===d.actorId&&u.orgId===row.orgId)||new Set(d.grantIds).size!==d.grantIds.length))error('invalid source decision')
      if(row.state==='rejected'&&row.decisions.at(-1)?.decision!=='rejected')error('missing rejection decision')
      if(serviceProduction(s,row)&&['approved','applying','rolling_out','active','superseded','failed'].includes(row.state)&&row.decisions.at(-1)?.decision!=='approved')error('missing production decision')
      if(row.sourceType!=='pipelineDefinition') {
        const executions=e.serviceExecutions.filter(x=>x.sourceId===row.id)
        if(executions.length>1||row.latestExecutionId!==executions[0]?.id)error('invalid execution history')
        if(['applying','rolling_out','active','superseded','failed'].includes(row.state)&&!executions.length)error('missing execution')
        const execution=executions[0]
        if(execution&&(row.state==='failed'?execution.state!=='failed':['active','superseded'].includes(row.state)?execution.state!=='succeeded':!['applying','rolling_out'].includes(row.state)||!['queued','running'].includes(execution.state)))error('execution source state mismatch')
      }
    }
  }
  for(const run of e.pipelines)if(run.definitionId) {
    const source=e.pipelineDefinitions.find(r=>r.id===run.definitionId),snapshot=run.definitionSnapshot
    if(!source||!source.specSnapshot||source.applicationId!==run.applicationId||source.orgId!==run.orgId||source.revision!==run.definitionRevision||!snapshot||snapshot.environmentId!==run.environmentId||run.sourceRevision!==run.revision||!source.spec.targetEnvironmentIds.includes(run.environmentId))error('invalid definition run source')
    if(source?.specSnapshot&&snapshot) {
      const {targetEnvironmentIds:_targets,...spec}=source.specSnapshot;void _targets
      const {environmentId:_env,sourceRef,...recorded}=snapshot;void _env
      if(!equal(spec,recorded)||!(snapshot.refPattern==='main'?sourceRef==='main':/^release\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(sourceRef)))error('definition run snapshot changed')
    }
    const retry=e.pipelines.find(r=>r.id===run.retryOfRunId)
    if(retry&&(!equal(retry.definitionSnapshot,snapshot)||retry.definitionId!==run.definitionId||retry.definitionRevision!==run.definitionRevision||retry.sourceRevision!==run.sourceRevision))error('retry definition snapshot changed')
  }
  for(const execution of e.serviceExecutions) {
    const source=rows.find(r=>r.id===execution.sourceId),tasks=s.scheduler.tasks.filter(t=>t.operationId===execution.id)
    if(!source||source.sourceType==='pipelineDefinition'||source.orgId!==execution.orgId||source.applicationId!==execution.applicationId||source.environmentId!==execution.environmentId||source.correlationId!==execution.correlationId||(execution.kind==='config')!==(source.sourceType==='serviceConfig'))error('invalid execution source')
    const active=['queued','running'].includes(execution.state),stepIndex=execution.stepResults.findIndex(v=>v.state==='running')
    if(!execution.startedAt||Date.parse(execution.startedAt)>now||execution.completedAt&&(Date.parse(execution.completedAt)>now||Date.parse(execution.completedAt)<Date.parse(execution.startedAt)))error('invalid execution start')
    if(execution.stepResults.some((step,i)=>execution.kind==='config'?'name' in step&&step.name!==['validate','render','activate'][i]:'weight' in step&&step.weight!==[10,50,100][i]))error('invalid execution step order')
    if(active) {
      if(tasks.length!==1||execution.completedAt||execution.failureCode||stepIndex<0||execution.state!=='running')error('missing or ghost execution task')
      const task=tasks[0]
      if(task&&(task.stepIndex!==stepIndex||task.dueTick<=s.logicalClock||task.dueTick>s.logicalClock+(execution.kind==='traffic'?30:1)))error('invalid execution scheduler position')
      if(execution.stepResults.some((step,i)=>step.state!==(i<stepIndex?'succeeded':i===stepIndex?'running':'queued')))error('invalid active execution steps')
    } else {
      if(tasks.length||!execution.completedAt||stepIndex>=0)error('terminal execution has task or missing completion')
      if(execution.state==='succeeded'&&execution.stepResults.some(step=>step.state!=='succeeded'))error('incomplete execution success')
      if(execution.state==='failed') {
        const failed=execution.stepResults.findIndex(step=>step.state==='failed')
        if(!execution.failureCode||failed<0||execution.stepResults.some((step,i)=>step.state!==(i<failed?'succeeded':i===failed?'failed':'skipped')))error('invalid terminal failure step order')
        if(execution.kind==='config'&&(failed!==1||execution.failureCode!=='SIMULATED_CONFIG_FAILURE'))error('invalid config failure evidence')
        if(execution.kind==='traffic'&&!['TRAFFIC_HEALTH_FAILED','TRAFFIC_HEALTH_TIMEOUT'].includes(execution.failureCode??''))error('invalid traffic failure code')
      }
    }
    if(execution.stepResults.some(step=>['running','succeeded','failed'].includes(step.state)&&!step.startedAt||['succeeded','failed'].includes(step.state)&&!step.completedAt))error('invalid step timestamps')
    for(const [i,step] of execution.stepResults.entries()) {
      const start=step.startedAt?Date.parse(step.startedAt):undefined,end=step.completedAt?Date.parse(step.completedAt):undefined
      if(start!==undefined&&(start>now||start<Date.parse(execution.startedAt!))||end!==undefined&&(end>now||start===undefined||end<start)
        ||['queued','skipped'].includes(step.state)&&(step.startedAt||step.completedAt)
        ||i===0&&step.startedAt!==execution.startedAt||i>0&&step.startedAt&&step.startedAt!==execution.stepResults[i-1].completedAt)error('inconsistent step time ordering')
      if(execution.kind==='config'&&end!==undefined&&end-start! !== 1000)error('invalid config step duration')
    }
    const completed=execution.stepResults.filter(step=>step.completedAt).at(-1)
    if(!active&&execution.completedAt!==completed?.completedAt)error('inconsistent terminal timestamp')
    if(active&&execution.kind==='config'&&tasks[0]&&tasks[0].dueTick!==(Date.parse(execution.stepResults[stepIndex]?.startedAt??'')-Date.parse('2026-09-20T09:00:00Z'))/1000+1)error('invalid config step due time')
    if(execution.kind==='traffic'&&source?.sourceType==='trafficPolicy') {
      distribution(execution.priorDistribution,execution.environmentId)
      validateTraffic(execution,source,s,error)
      if(active&&tasks[0]) {
        const step=execution.stepResults[stepIndex],last=execution.samples.filter(v=>v.step===step?.weight).at(-1)
        const due=(Date.parse(last?.to??step?.startedAt??'')-Date.parse('2026-09-20T09:00:00Z'))/1000+30
        if(tasks[0].dueTick!==due)error('invalid traffic cadence')
      }
    }
  }
  for(const env of e.environments)if(executionLocks(s,env.id).length>1)error('conflicting environment execution locks')
  for(const [key,value] of Object.entries(s.scenarioFlags))if(/^(config-failure|traffic-abnormal|traffic-missing):/.test(key)) {
    const [kind,id]=key.split(':'),execution=e.serviceExecutions.find(x=>x.id===id)
    if(value!==true||!execution||!['queued','running'].includes(execution.state)||(kind==='config-failure')!==(execution.kind==='config'))error('invalid targeted execution scenario')
  }
  return errors
}
function validateTraffic(execution:TrafficExecution,source:TrafficPolicy,s:Snapshot,error:(message:string)=>void) {
  const spec=source.specSnapshot
  if(!spec){error('missing traffic execution spec');return}
  const seen=new Set<string>()
  for(const [i,sample] of execution.samples.entries()) {
    const step=execution.stepResults.find(step=>step.weight===sample.step),previous=execution.samples[i-1],lastInStep=execution.samples.slice(0,i).filter(v=>v.step===sample.step).at(-1)
    if(sample.id!==`sample-${execution.id}-${i+1}`||seen.has(sample.id)||sample.executionId!==execution.id||sample.policyId!==source.id||sample.candidateReleaseId!==spec.targets[1].releaseId||Date.parse(sample.to)-Date.parse(sample.from)!==30_000
      ||!step?.startedAt||Date.parse(sample.from)<Date.parse(step.startedAt)||Date.parse(sample.to)>Date.parse('2026-09-20T09:00:00Z')+s.logicalClock*1000
      ||previous&&Date.parse(previous.to)>Date.parse(sample.from)||sample.from!==(lastInStep?.to??step?.startedAt))error('invalid traffic sample reference or interval')
    if((sample.p95LatencyMs===null)!==(sample.errorRate===null)||sample.p95LatencyMs!==null&&![[120,0.002],[900,0.08]].some(v=>v[0]===sample.p95LatencyMs&&v[1]===sample.errorRate))error('invalid deterministic traffic probe')
    const abnormal=sample.p95LatencyMs!==null&&sample.errorRate!==null&&(sample.p95LatencyMs>spec.thresholds.p95LatencyMs||sample.errorRate>spec.thresholds.errorRate)
    if(abnormal&&(i!==execution.samples.length-1||execution.state!=='failed'||execution.failureCode!=='TRAFFIC_HEALTH_FAILED'||step?.state!=='failed'))error('traffic continued after an abnormal sample')
    seen.add(sample.id)
  }
  for(const [i,cp] of execution.checkpoints.entries()) {
    const samples=cp.sampleIds.map(id=>execution.samples.find(v=>v.id===id)),step=execution.stepResults[i]
    if(cp.id!==`checkpoint-${execution.id}-${cp.step}`||cp.step!==[10,50,100][i]||step.state!=='succeeded'||cp.sampleIds.length!==spec.healthWindowSeconds/30||new Set(cp.sampleIds).size!==cp.sampleIds.length
      ||samples.some(v=>!v||v.step!==cp.step||v.p95LatencyMs===null||v.errorRate===null||v.p95LatencyMs>spec.thresholds.p95LatencyMs||v.errorRate>spec.thresholds.errorRate)
      ||samples.some((v,index)=>index>0&&samples[index-1]?.to!==v?.from)||samples[0]?.from!==cp.windowStart||samples.at(-1)?.to!==cp.verifiedAt
      ||Date.parse(cp.verifiedAt)-Date.parse(cp.windowStart)!==spec.healthWindowSeconds*1000||step.completedAt!==cp.verifiedAt
      ||!equal(cp.weights,[{releaseId:spec.targets[0].releaseId,weight:100-cp.step},{releaseId:spec.targets[1].releaseId,weight:cp.step}]))error('invalid traffic checkpoint proof')
  }
  if(execution.checkpoints.length!==execution.stepResults.filter(step=>step.state==='succeeded').length)error('missing checkpoint for succeeded traffic step')
  const terminalSample=execution.samples.at(-1)
  if(['succeeded','failed'].includes(execution.state)&&terminalSample?.to!==execution.completedAt)error('invalid terminal traffic sample time')
  const failed=execution.stepResults.find(step=>step.state==='failed'),last=execution.samples.at(-1)
  if(failed&&(!last||last.step!==failed.weight||execution.failureCode==='TRAFFIC_HEALTH_FAILED'&&!(last.p95LatencyMs!==null&&last.errorRate!==null&&(last.p95LatencyMs>spec.thresholds.p95LatencyMs||last.errorRate>spec.thresholds.errorRate))
    ||execution.failureCode==='TRAFFIC_HEALTH_TIMEOUT'&&Date.parse(failed.completedAt!)-Date.parse(failed.startedAt!)!==spec.timeoutSeconds*1000))error('invalid traffic failure evidence')
}
