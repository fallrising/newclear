import { useState } from 'react'
import { useIsMutating, useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { api, queryKey } from '../../api/client'
import { demoClockMutationKey } from '../../api/query-definitions'
import { PageHeading } from '../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import type { CreatePipelineDefinitionInput, CreateServiceConfigInput, CreateTrafficPolicyInput, DeliveryOptions, SessionView } from '../../domain/schemas'
import { ConfigurationEditor, DefinitionEditor, TrafficEditor } from './editors'
import { useServiceCommand } from './commands'
import { getServiceDetail, isMissing, listServiceSources, sectionPath, sectionTitle, sourcePath, stateLabel, timeLabel, type ServiceKind } from './model'
import { MissingServiceChange, ServiceNotice } from './ui'
import { ServiceDetailView } from './ServiceDetailView'

const families = { pipelineDefinition: ['pipeline-definitions', 'pipeline-definition'], serviceConfig: ['service-configs', 'service-config'], trafficPolicy: ['traffic-policies', 'traffic-policy'] } as const
const isKind = (value: string): value is ServiceKind => value === 'pipelineDefinition' || value === 'serviceConfig' || value === 'trafficPolicy'
function canWrite(session: SessionView, kind: ServiceKind, options: DeliveryOptions) {
  return session.effectiveActions.includes(`${kind}.write`) && session.assignments.some(grant => grant.role === 'rd' && grant.scopeType === 'project' && grant.scopeId === options.application.projectId && (!grant.stages || grant.stages.includes(options.environment.stage)))
}

function CreateSource({ kind, options, onCreated, onCancel }: { kind: ServiceKind; options: DeliveryOptions; onCreated: (id: string) => void; onCancel: () => void }) {
  const clockPending = useIsMutating({ mutationKey: demoClockMutationKey }) > 0
  const command = useServiceCommand(async receipt => {
    await getServiceDetail(kind, receipt.entityId)
    await api.listAudit({ correlationId: receipt.correlationId, pageSize: 100 })
  })
  const save = async (input: CreatePipelineDefinitionInput | CreateServiceConfigInput | CreateTrafficPolicyInput) => {
    try {
      const receipt = await command.mutateAsync(() => {
        if (kind === 'pipelineDefinition' && 'name' in input) return api.createPipelineDefinition(input)
        if (kind === 'serviceConfig' && 'environmentVersion' in input && 'entries' in input.spec) return api.createServiceConfig({ ...input, spec: input.spec })
        if (kind === 'trafficPolicy' && 'environmentVersion' in input && 'targets' in input.spec) return api.createTrafficPolicy({ ...input, spec: input.spec })
        throw new Error('來源類型與編輯器不一致。')
      })
      onCreated(receipt.entityId)
    } catch { /* Preserve typed input and any accepted receipt until the user retries readback. */ }
  }
  const props = { options, pending: command.isPending || clockPending, committed: command.committed, error: command.error, onSave: (input: CreatePipelineDefinitionInput | CreateServiceConfigInput | CreateTrafficPolicyInput) => void save(input) }
  return <><div className="service-actions"><Button variant="outline" disabled={props.pending} onClick={onCancel}>返回版本清單</Button></div>{kind === 'pipelineDefinition' ? <DefinitionEditor {...props} /> : kind === 'serviceConfig' ? <ConfigurationEditor {...props} /> : <TrafficEditor {...props} />}</>
}

function SelectedSource({ kind, sourceId, options, session }: { kind: ServiceKind; sourceId: string; options: DeliveryOptions; session: SessionView }) {
  const detail = useQuery({ queryKey: queryKey(families[kind][1], sourceId), queryFn: () => getServiceDetail(kind, sourceId) })
  if (isMissing(detail.error)) return <MissingServiceChange back={`/rd/apps/${options.application.id}/${sectionPath[kind]}?environmentId=${options.environment.id}`} />
  if (detail.isPending) return <LoadingState label="正在讀取版本、可用操作與生效內容…" />
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
  const source = detail.data.source
  if (source.sourceType !== kind || source.applicationId !== options.application.id || ('environmentId' in source ? source.environmentId !== options.environment.id : !source.affectedEnvironmentIds.includes(options.environment.id))) return <MissingServiceChange />
  return <ServiceDetailView key={source.id} detail={detail.data} options={options} session={session} center="rd" />
}

function ScopedServicePage({ kind, session, options }: { kind: ServiceKind; session: SessionView; options: DeliveryOptions }) {
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const [page, setPage] = useState(1)
  const filters = { applicationId: options.application.id, environmentId: options.environment.id, page }
  const sources = useQuery({ queryKey: queryKey(families[kind][0], options.application.id, filters), queryFn: () => listServiceSources(kind, options.application.id, options.environment.id, page) })
  const servicePending = useIsMutating({ mutationKey: ['service-delivery-command'] }) > 0
  const clockPending = useIsMutating({ mutationKey: demoClockMutationKey }) > 0
  const pending = servicePending || clockPending
  const requestedRevision = params.get('revisionId')
  const selectedId = requestedRevision ?? sources.data?.items[0]?.id
  const select = (id: string) => { const next = new URLSearchParams(params); next.set('revisionId', id); setParams(next); setCreating(false) }
  return <>
    <section className="panel"><div className="panel-title"><h2>{sectionTitle[kind]}版本</h2>{canWrite(session, kind, options) && <Button disabled={pending || creating} onClick={() => setCreating(true)}>新增{sectionTitle[kind]}</Button>}</div><p className="muted">只顯示目前服務與環境的授權版本。歷史版本有自己的 ID，重新整理會保留目前選擇。</p>
      {sources.isPending ? <LoadingState label="正在讀取版本清單…" /> : sources.isError ? <ErrorState error={sources.error} onRetry={() => void sources.refetch()} /> : <>{sources.data.items.length === 0 ? <p>此範圍尚無{sectionTitle[kind]}。</p> : <label>檢視版本<select disabled={pending} value={selectedId ?? ''} onChange={event => select(event.target.value)}>{requestedRevision && !sources.data.items.some(source => source.id === requestedRevision) && <option value={requestedRevision}>深連結版本 · {requestedRevision}</option>}{sources.data.items.map(source => <option value={source.id} key={source.id}>revision {source.revision} · {stateLabel[source.state]} · {'name' in source ? source.name : source.reason} · {source.id}</option>)}</select></label>}<nav className="service-actions" aria-label="版本清單分頁"><span>共 {sources.data.total} 筆 · 第 {page} 頁</span><Button variant="outline" size="sm" disabled={pending || page <= 1} onClick={() => setPage(current => current - 1)}>上一頁</Button><Button variant="outline" size="sm" disabled={pending || page * 25 >= sources.data.total} onClick={() => setPage(current => current + 1)}>下一頁</Button></nav></>}
    </section>
    {creating ? <CreateSource kind={kind} options={options} onCreated={select} onCancel={() => setCreating(false)} /> : selectedId ? <SelectedSource kind={kind} sourceId={selectedId} options={options} session={session} /> : !sources.isPending && !sources.isError && <ServiceNotice>尚無可讀版本，不代表已完成配置或具有流量資料。</ServiceNotice>}
  </>
}

function RdServicePage({ kind, session }: { kind: ServiceKind; session: SessionView }) {
  const { appId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const environmentId = params.get('environmentId') ?? ''
  const app = useQuery({ queryKey: queryKey('application', appId), queryFn: () => api.getApplication(appId), enabled: Boolean(appId) })
  const options = useQuery({ queryKey: queryKey('delivery-options', appId, { environmentId }), queryFn: () => api.getDeliveryOptions(appId, environmentId), enabled: Boolean(appId && environmentId) })
  const commandPending = useIsMutating({ mutationKey: ['service-delivery-command'] }) > 0
  const clockPending = useIsMutating({ mutationKey: demoClockMutationKey }) > 0
  if (!appId || isMissing(app.error) || isMissing(options.error)) return <MissingServiceChange />
  if (app.isPending) return <LoadingState label="正在讀取服務與授權環境…" />
  if (app.isError) return <ErrorState error={app.error} onRetry={() => void app.refetch()} />
  if (environmentId && !app.data.environments.some(environment => environment.id === environmentId)) return <MissingServiceChange back={`/rd/apps/${appId}`} />
  return <div className="service-delivery"><PageHeading eyebrow="RD · SERVICE DELIVERY" title={`${app.data.application.name} · ${sectionTitle[kind]}`} description={kind === 'pipelineDefinition' ? '定義可重複使用的交付規則，透過凍結的定義版本建立執行。' : kind === 'serviceConfig' ? '以明確型別管理服務設定，核對差異、審批及生效歷史。' : '選擇同環境的合格發布版本，按健康證據逐步驗證有效流量。'} action={<Button asChild variant="outline"><Link to={`/rd/apps/${appId}`}><ArrowLeft size={16} aria-hidden="true" />服務詳情</Link></Button>} />
    <section className="panel service-context"><label>服務環境<select value={environmentId} disabled={commandPending || clockPending} onChange={event => { const next = new URLSearchParams(params); next.delete('revisionId'); if (event.target.value) next.set('environmentId', event.target.value); else next.delete('environmentId'); setParams(next) }}><option value="">選擇環境</option>{app.data.environments.map(environment => <option key={environment.id} value={environment.id}>{environment.name} · {environment.stage} · {environment.status}</option>)}</select></label>{options.data && <p><code>{options.data.environment.id}</code> · v{options.data.environment.version} · 資料時間 {timeLabel(options.data.dataAsOf)}</p>}</section>
    <nav className="service-actions" aria-label="服務交付分頁">{(['pipelineDefinition', 'serviceConfig', 'trafficPolicy'] as const).map(item => <Button key={item} asChild variant={item === kind ? 'default' : 'outline'}><Link to={`/rd/apps/${appId}/${sectionPath[item]}${environmentId ? `?environmentId=${encodeURIComponent(environmentId)}` : ''}`} aria-current={item === kind ? 'page' : undefined}>{sectionTitle[item]}</Link></Button>)}</nav>
    {!environmentId ? <section className="panel"><h2>先選擇服務環境</h2><p>環境是讀取範圍與變更版本檢查的一部分。選單只列出目前授權可讀的環境。</p></section> : options.isPending ? <LoadingState label="正在讀取此服務的已登記參照與環境版本…" /> : options.isError ? <ErrorState error={options.error} onRetry={() => void options.refetch()} /> : <ScopedServicePage key={`${appId}:${environmentId}:${kind}`} kind={kind} options={options.data} session={session} />}
  </div>
}

export function DeliveryPage({ session }: { session: SessionView }) { return <RdServicePage kind="pipelineDefinition" session={session} /> }
export function ConfigurationPage({ session }: { session: SessionView }) { return <RdServicePage kind="serviceConfig" session={session} /> }
export function TrafficPage({ session }: { session: SessionView }) { return <RdServicePage kind="trafficPolicy" session={session} /> }

export function ServiceChangePage({ session }: { session: SessionView }) {
  const { sourceType = '', sourceId = '' } = useParams()
  if (!isKind(sourceType) || !sourceId) return <MissingServiceChange back="/ops/requests" />
  return <OpsSource key={`${sourceType}:${sourceId}`} kind={sourceType} sourceId={sourceId} session={session} />
}
function OpsSource({ kind, sourceId, session }: { kind: ServiceKind; sourceId: string; session: SessionView }) {
  const detail = useQuery({ queryKey: queryKey(families[kind][1], sourceId), queryFn: () => getServiceDetail(kind, sourceId) })
  const source = detail.data?.source
  const environmentId = source ? 'environmentId' in source ? source.environmentId : source.affectedEnvironmentIds[0] : ''
  const options = useQuery({ queryKey: queryKey('delivery-options', source?.applicationId, { environmentId }), queryFn: () => api.getDeliveryOptions(source!.applicationId, environmentId), enabled: Boolean(source && environmentId) })
  if (isMissing(detail.error) || isMissing(options.error)) return <MissingServiceChange back="/ops/requests" />
  if (detail.isPending) return <LoadingState label="正在讀取同一來源的變更內容…" />
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
  if (options.isPending) return <LoadingState label="正在核對變更範圍…" />
  if (options.isError) return <ErrorState error={options.error} onRetry={() => void options.refetch()} />
  return <div className="service-delivery"><PageHeading eyebrow="OPS · SERVICE CHANGE" title={`${options.data.application.name} · ${sectionTitle[kind]}審批`} description="讀取申請者的同一份版本、驗證與證據。核准只記錄決策，由申請者明確啟動後續執行。" action={<Button asChild variant="outline"><Link to="/ops/requests"><ArrowLeft size={16} aria-hidden="true" />工作單</Link></Button>} /><p><Link to={sourcePath(detail.data.source, 'rd', options.data.environment.id)}>同一來源的 RD 視圖</Link> · {options.data.environment.name} · {options.data.environment.stage}</p><ServiceDetailView detail={detail.data} options={options.data} session={session} center="ops" /></div>
}
