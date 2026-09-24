import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useIsMutating } from '@tanstack/react-query'
import { api } from '../../api/client'
import { demoClockMutationKey } from '../../api/query-definitions'
import { Button } from '../../components/ui/button'
import type { CreatePipelineDefinitionInput, CreateServiceConfigInput, CreateTrafficPolicyInput, DeliveryOptions, SessionView } from '../../domain/schemas'
import { useServiceCommand } from './commands'
import { getServiceDetail, type ServiceDetail } from './model'
import { ActiveState, ConfigurationDiff, DecisionHistory, ExecutionEvidence, NetworkReferences, ServiceAudit, SourceHistory, SourceMetadata, SourceSpec } from './evidence'
import { ConfigurationComparison } from './ConfigurationComparison'
import { ConfigurationEditor, DefinitionEditor, TrafficEditor } from './editors'
import { ServiceActions } from './ServiceActions'
import { ServiceDemoControls } from './ServiceDemoControls'
import { ServiceNotice } from './ui'
import { sessionFeatureAvailable } from '../../domain/feature-policy'

export function ServiceDetailView({ detail, options, session, center }: { detail: ServiceDetail; options: DeliveryOptions; session: SessionView; center: 'rd' | 'ops' }) {
  const [editing, setEditing] = useState(false)
  const source = detail.source
  const featureKey = source.sourceType === 'pipelineDefinition' ? 'rd.delivery' : source.sourceType === 'trafficPolicy' ? 'rd.traffic' : undefined
  const readOnly = center === 'rd' && !!featureKey && !sessionFeatureAvailable(session, featureKey, options.application.projectId)
  const clockPending = useIsMutating({ mutationKey: demoClockMutationKey }) > 0
  const command = useServiceCommand(async receipt => {
    await getServiceDetail(source.sourceType, receipt.entityId)
    await api.listAudit({ correlationId: receipt.correlationId, pageSize: 100 })
  })
  const patch = async (input: CreatePipelineDefinitionInput | CreateServiceConfigInput | CreateTrafficPolicyInput) => {
    try {
      await command.mutateAsync(() => {
        if (source.sourceType === 'pipelineDefinition' && 'name' in input) return api.patchPipelineDefinition(source.id, { name: input.name, reason: input.reason, spec: input.spec, expectedVersion: source.version })
        if (source.sourceType === 'serviceConfig' && 'environmentVersion' in input && 'entries' in input.spec) return api.patchServiceConfig(source.id, { environmentVersion: input.environmentVersion, reason: input.reason, spec: input.spec, expectedVersion: source.version })
        if (source.sourceType === 'trafficPolicy' && 'environmentVersion' in input && 'targets' in input.spec) return api.patchTrafficPolicy(source.id, { environmentVersion: input.environmentVersion, reason: input.reason, spec: input.spec, expectedVersion: source.version })
        throw new Error('版本類型與編輯器不一致。')
      })
      setEditing(false)
    } catch { /* Keep the typed draft and refusal visible. */ }
  }
  const editorProps = { options, pending: command.isPending || clockPending, committed: command.committed, error: command.error, onSave: (input: CreatePipelineDefinitionInput | CreateServiceConfigInput | CreateTrafficPolicyInput) => void patch(input) }
  const canInject = center === 'rd' && !readOnly && source.requesterId === session.user.id && session.assignments.some(grant => grant.role === 'rd' && grant.scopeType === 'project' && grant.scopeId === options.application.projectId && (!grant.stages || grant.stages.includes(options.environment.stage)))
  return <>
    <SourceMetadata detail={detail} />
    {readOnly && <ServiceNotice>功能灰度目前不允許新指令；已建立的版本與執行紀錄仍可依目前授權閱讀。</ServiceNotice>}
    {editing && !readOnly ? <><div className="service-actions"><Button variant="outline" disabled={command.isPending || clockPending} onClick={() => setEditing(false)}>返回版本詳情</Button></div>{source.sourceType === 'pipelineDefinition' ? <DefinitionEditor {...editorProps} source={source} /> : source.sourceType === 'serviceConfig' ? <ConfigurationEditor {...editorProps} source={source} /> : <TrafficEditor {...editorProps} source={source} />}</> : <ServiceActions detail={detail} options={options} center={center} onEdit={() => { command.reset(); setEditing(true) }} readOnly={readOnly} />}
    <div className="service-columns"><SourceSpec source={source} center={center} /><ActiveState detail={detail} center={center} /></div>
    {'diff' in detail && <><ConfigurationDiff diff={detail.diff} /><ConfigurationComparison options={options} active={detail.active} /></>}
    {'runs' in detail && <section className="panel"><h2>依定義建立的執行紀錄</h2>{detail.runs.length === 0 ? <p>尚無執行紀錄；儲存、驗證或啟用不會自動建立 run。</p> : <ol className="service-evidence">{detail.runs.map(run => <li key={run.id}><Link to={`/rd/pipelines/${run.id}`}><code>{run.id}</code></Link><p>定義 revision {run.definitionRevision} · 來源 {run.sourceRevision} · {run.state}</p><p>目標 <code>{run.environmentId}</code>{run.artifactDigest && <> · 產物 <code>{run.artifactDigest}</code></>}</p></li>)}</ol>}</section>}
    {'executions' in detail && <ExecutionEvidence executions={detail.executions} center={center} />}
    {source.sourceType === 'trafficPolicy' && <NetworkReferences options={options} />}
    <ServiceDemoControls detail={detail} session={session} canInject={canInject} />
    <div className="service-columns"><SourceHistory detail={detail} center={center} environmentId={options.environment.id} /><DecisionHistory source={source} /></div>
    <ServiceAudit correlationId={source.correlationId} />
  </>
}
