import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import { PageHeading } from '../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import { createChangeInputSchema, type ChangeInput, type ChangeRequest } from '../../domain/schemas'
import { isMissing, MissingResource, ObjectSpec, purposeLabel, stageLabel } from './shared'

type ChangeFormProps = { catalogId: string; original?: ChangeRequest; copyFrom?: ChangeRequest; center?: 'rd' | 'ops'; onSaved?: () => Promise<unknown> }
export function ChangeForm({ catalogId, original, copyFrom, center = 'rd', onSaved }: ChangeFormProps) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const spec = original?.spec ?? copyFrom?.spec
  const maintenance = spec?.kind === 'resource.resize' && !spec.applicationId
  const [form, setForm] = useState({
    applicationId: spec?.applicationId ?? params.get('applicationId') ?? '', environmentId: spec?.environmentId ?? params.get('environmentId') ?? '',
    ciId: spec?.targetCiId ?? params.get('ciId') ?? '', objectId: spec && 'resourceObjectId' in spec ? spec.resourceObjectId ?? '' : params.get('objectId') ?? '',
    mode: spec ? spec.kind === 'resource.resize' ? 'resize' : spec.kind === 'kafka.topic.create' ? 'topic' : spec.mode : params.get('mode') ?? '',
    reason: spec?.reason ?? '', quotaMiB: spec && 'quotaMiB' in spec ? spec.quotaMiB : undefined,
    topicName: spec?.kind === 'kafka.topic.create' ? spec.topicName : '', namespace: spec?.kind === 'kafka.topic.create' ? spec.namespace ?? '' : '',
    partitions: spec?.kind === 'kafka.topic.create' ? spec.partitions : undefined,
    retentionHours: spec?.kind === 'kafka.topic.create' ? spec.retentionHours : undefined,
    throughputKiBPerSecond: spec?.kind === 'kafka.topic.create' ? spec.throughputKiBPerSecond : undefined,
    purpose: spec && 'purpose' in spec ? spec.purpose : '', profile: spec && 'accessProfileRef' in spec ? spec.accessProfileRef : '',
  })
  const catalog = useQuery({ queryKey: queryKey('catalog-item',catalogId), queryFn: () => api.getCatalog(catalogId), enabled: Boolean(catalogId) })
  const apps = useQuery({ queryKey: queryKey('applications',null,{ pageSize:100 }), queryFn: () => api.listApplications({ pageSize:100 }) })
  const app = useQuery({ queryKey: queryKey('application',form.applicationId), queryFn: () => api.getApplication(form.applicationId), enabled: Boolean(form.applicationId) })
  const parents = useQuery({ queryKey: queryKey('resource-inventory',null,{ pageSize:100 }), queryFn: () => api.listResourceInventory({ pageSize:100 }) })
  const template = catalog.data?.template.resourceKind !== 'compute' ? catalog.data?.template : undefined
  const allowedParents = parents.data?.items.filter(item => template?.allowedParentCiIds.includes(item.ci.id)) ?? []
  const parent = form.ciId ? allowedParents.find(item => item.ci.id === form.ciId) : allowedParents[0]
  const objects = useQuery({ queryKey: queryKey('resource-objects',parent?.ci.id,{ pageSize:100 }), queryFn: () => api.listResourceObjects({ ciId:parent!.ci.id, pageSize:100 }), enabled: Boolean(parent) })
  const env = app.data?.environments.find(item => item.id === form.environmentId)
  const mode = form.mode || (template?.resourceKind === 'kafka' ? 'topic' : 'create')
  const targetObjects = objects.data?.items.filter(item => item.kind === (template?.resourceKind === 'redis' ? 'cache_allocation' : 'kafka_topic')) ?? []
  const object = targetObjects.find(item => item.id === form.objectId)
  const profiles = template?.accessProfiles ?? []
  const purposes = [...new Set(profiles.flatMap(profile => profile.purposes))]
  const purpose = purposes.includes(form.purpose as typeof purposes[number]) ? form.purpose as typeof purposes[number] : purposes[0]
  const compatibleProfiles = profiles.filter(profile => profile.purposes.includes(purpose))
  const profile = compatibleProfiles.find(item => item.id === form.profile) ?? compatibleProfiles[0]
  const quota = form.quotaMiB ?? (mode === 'resize' && object?.kind === 'cache_allocation' ? object.spec.quotaMiB : template?.resourceKind === 'redis' ? template.defaults.quotaMiB : 1)
  const partitions = form.partitions ?? (template?.resourceKind === 'kafka' ? template.defaults.partitions : 1)
  const retentionHours = form.retentionHours ?? (template?.resourceKind === 'kafka' ? template.defaults.retentionHours : 1)
  const throughput = form.throughputKiBPerSecond ?? (template?.resourceKind === 'kafka' ? template.defaults.throughputKiBPerSecond : 1)
  const mutation = useMutation({ mutationFn: async () => {
    if (!catalog.data || !parent || !maintenance && !env) throw new Error('請選擇合法模板、資源與服務環境。')
    const common = { catalogItemId: catalog.data.id, catalogRevision: catalog.data.revision, reason: form.reason.trim(), targetCiId: parent.ci.id, targetCiVersion: parent.ci.version, ...(maintenance ? {} : { applicationId: form.applicationId, environmentId: env!.id, environmentVersion: env!.version }) }
    let input: ChangeInput
    if (mode === 'resize') input = { ...common, kind:'resource.resize', resourceObjectId:object!.id, resourceObjectVersion:object!.version, quotaMiB:quota }
    else if (mode === 'topic') input = { ...common, applicationId: form.applicationId, environmentId: env!.id, environmentVersion: env!.version, kind:'kafka.topic.create', topicName:form.topicName.trim(), ...(form.namespace.trim() ? { namespace:form.namespace.trim() } : {}), partitions, retentionHours, throughputKiBPerSecond:throughput, purpose, accessProfileRef:profile!.id }
    else input = { ...common, applicationId: form.applicationId, environmentId: env!.id, environmentVersion: env!.version, kind:'resource.bind', mode:mode === 'existing' ? 'existing' : 'create', purpose, accessProfileRef:profile!.id,
      ...(mode === 'existing' ? { resourceObjectId:object!.id, resourceObjectVersion:object!.version } : { quotaMiB:quota }) }
    const checked = createChangeInputSchema.parse(input)
    return original ? api.patchChange(original.id, { ...checked, expectedVersion:original.version }) : api.createChange(checked)
  } })
  const submit = async (event:FormEvent) => { event.preventDefault(); try { const receipt=await mutation.mutateAsync(); if (onSaved) await onSaved(); else navigate(`/${center}/changes/${receipt.entityId}`) } catch { /* Exact error below; no automatic command retry. */ } }
  if (isMissing(catalog.error) || isMissing(app.error)) return <MissingResource back="/rd/catalog" />
  if (catalog.isPending || apps.isPending || parents.isPending) return <LoadingState label="正在準備授權模板與資源…" />
  if (catalog.isError || apps.isError || parents.isError) return <ErrorState error={catalog.error || apps.error || parents.error} onRetry={() => { void catalog.refetch(); void apps.refetch(); void parents.refetch() }} />
  if (!template) return <section className="panel"><h2>此入口僅處理 Redis／Kafka 資源</h2><Button asChild variant="outline"><Link to={`/rd/catalog/${catalogId}/request`}>前往既有環境申請</Link></Button></section>
  const eligibleApps=apps.data.items.filter(item=>catalog.data.allowedProjectIds.includes(item.projectId))
  const eligibleEnv=maintenance || Boolean(env && template.allowedStages.includes(env.stage) && env.status==='ready')
  const needsObject=mode==='existing' || mode==='resize'
  const allowedModes=template.resourceKind==='redis' ? [['create','建立 Redis allocation 並綁定'],['existing','綁定已有 allocation'],['resize','調整 allocation 配額']] : [['topic','建立 Kafka topic 並綁定'],['existing','綁定已有 topic']]
  return <form className="panel resource-form" onSubmit={event=>void submit(event)}>
    <div className="span-all"><h2>{original ? '編輯同一份草稿' : '建立資源變更草稿'}</h2><p>{catalog.data.name} · revision {catalog.data.revision} · {catalog.data.status} · Demo</p>{original && spec?.catalogRevision!==catalog.data.revision && <p role="status">模板版本已變更。儲存本次草稿將明確採用上方新 revision，已提交歷史不會被改寫。</p>}</div>
    <label>需求類型<select value={mode} onChange={event=>setForm({...form,mode:event.target.value,objectId:'',quotaMiB:undefined})}>{allowedModes.filter(([value])=>!original && !maintenance || ((original ?? copyFrom)!.kind==='resource.resize' ? value==='resize' : (original ?? copyFrom)!.kind==='kafka.topic.create' ? value==='topic' : ['create','existing'].includes(value))).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    {!maintenance && <label>服務<select required value={form.applicationId} onChange={event=>setForm({...form,applicationId:event.target.value,environmentId:''})}><option value="">選擇授權服務</option>{eligibleApps.map(item=><option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></label>}
    {!maintenance && <label>服務環境<select required value={form.environmentId} onChange={event=>setForm({...form,environmentId:event.target.value})} disabled={!form.applicationId || app.isPending}><option value="">選擇就緒環境</option>{app.data?.environments.filter(item=>template.allowedStages.includes(item.stage)).map(item=><option key={item.id} value={item.id} disabled={item.status!=='ready'}>{item.name} · {stageLabel[item.stage]} · {item.status}</option>)}</select></label>}
    <label>{template.resourceKind==='redis'?'Redis instance':'Kafka cluster'}<select required value={parent?.ci.id??''} onChange={event=>setForm({...form,ciId:event.target.value,objectId:''})}><option value="">選擇模板允許的資源</option>{allowedParents.map(item=><option key={item.ci.id} value={item.ci.id}>{item.ci.name} · {item.ci.id}</option>)}</select></label>
    {needsObject && <label className="span-all">已有子資源<select required value={form.objectId} onChange={event=>setForm({...form,objectId:event.target.value,quotaMiB:undefined})}><option value="">選擇明確授權的 object</option>{targetObjects.map(item=><option key={item.id} value={item.id}>{item.name} · {item.id} · v{item.version}</option>)}</select></label>}
    {template.resourceKind==='redis' && mode!=='existing' && <label>期望配額 MiB<input required type="number" min={template.limits.minQuotaMiB} max={template.limits.maxQuotaMiB} value={quota} onChange={event=>setForm({...form,quotaMiB:Number(event.target.value)})} /></label>}
    {template.resourceKind==='kafka' && mode==='topic' && <><label>Topic 名稱<input required maxLength={80} pattern="[a-zA-Z0-9][a-zA-Z0-9._-]*" value={form.topicName} onChange={event=>setForm({...form,topicName:event.target.value})} /></label><label>Namespace（選填）<input maxLength={120} value={form.namespace} onChange={event=>setForm({...form,namespace:event.target.value})} /></label><label>Partitions<input required type="number" min={template.limits.minPartitions} max={template.limits.maxPartitions} value={partitions} onChange={event=>setForm({...form,partitions:Number(event.target.value)})} /></label><label>保留時數<input required type="number" min={template.limits.minRetentionHours} max={template.limits.maxRetentionHours} value={retentionHours} onChange={event=>setForm({...form,retentionHours:Number(event.target.value)})} /></label><label>Throughput KiB/s<input required type="number" min={template.limits.minThroughputKiBPerSecond} max={template.limits.maxThroughputKiBPerSecond} value={throughput} onChange={event=>setForm({...form,throughputKiBPerSecond:Number(event.target.value)})} /></label></>}
    {mode!=='resize' && <><label>綁定用途<select value={purpose??''} onChange={event=>setForm({...form,purpose:event.target.value,profile:''})}>{purposes.map(value=><option key={value} value={value}>{purposeLabel[value]}</option>)}</select></label><label>安全存取 profile<select required value={profile?.id??''} onChange={event=>setForm({...form,profile:event.target.value})}>{compatibleProfiles.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label></>}
    <label className="span-all">申請理由<textarea required maxLength={500} rows={3} value={form.reason} onChange={event=>setForm({...form,reason:event.target.value})} /></label>
    <section className="review-summary span-all resource-proposal" aria-label="資源變更摘要"><h3>建立前確認</h3><p>{maintenance ? 'Ops 共享維護' : form.applicationId||'尚未選擇服務'} / {maintenance ? '全部受影響環境' : env?.name??'尚未選擇環境'} · {env?.stage??'未知'} → {parent?.ci.name??'尚未選擇資源'}</p>{object && <p>目前：<ObjectSpec object={object} /> · v{object.version}</p>}<p>期望：{mode==='existing'?'新增此環境的綁定，不改 object 配額':template.resourceKind==='redis'?`${quota} MiB`:`${partitions} partitions / ${retentionHours} 小時 / ${throughput} KiB/s`}</p><p>需要另一位 Ops 審批與明確執行；批准不代表 ready。提交時重驗版本、授權、共享影響與配額。</p>{parent?.impactIncomplete && <p>此物理資源有未完整授權的服務影響；共享 resize 須交由有完整 scope 的人員核對。</p>}</section>
    {app.isError && <ErrorState error={app.error} onRetry={()=>void app.refetch()} />}{objects.isError && <ErrorState error={objects.error} onRetry={()=>void objects.refetch()} />}{mutation.isError && <div className="span-all"><ErrorState error={mutation.error} title="草稿尚未儲存" /></div>}
    <div className="form-actions span-all"><Button type="submit" disabled={mutation.isPending || catalog.data.status!=='published' || !eligibleEnv || !parent || needsObject&&!object || !form.reason.trim() || mode!=='resize'&&!profile}>{mutation.isPending?'正在儲存…':original?'儲存草稿變更':'建立資源草稿'}</Button></div>
  </form>
}

export function ChangeWizardPage() {
  const { itemId='' }=useParams()
  return <><PageHeading eyebrow="RD · RESOURCE REQUEST" title="資源申請" description="在合法服務環境建立 Redis／Kafka 需求，保留明確版本、來源與審批歷史。" action={<Button asChild variant="outline"><Link to="/rd/catalog"><ArrowLeft size={16} aria-hidden="true" />服務目錄</Link></Button>} /><ChangeForm key={itemId} catalogId={itemId} /></>
}
