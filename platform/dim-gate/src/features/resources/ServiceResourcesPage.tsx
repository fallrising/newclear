import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Boxes } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import { PageHeading } from '../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import type { SessionView } from '../../domain/schemas'
import { dateLabel, isMissing, MissingResource, ObjectSpec, objectKindLabel, purposeLabel, resourcePath, stageLabel } from './shared'

export function ServiceResourcesPage({ session }: { session: SessionView }) {
  const { appId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const environmentId = params.get('environmentId') ?? ''
  const app = useQuery({ queryKey: queryKey('application', appId), queryFn: () => api.getApplication(appId), enabled: Boolean(appId) })
  const resources = useQuery({ queryKey: queryKey('service-resources', appId, { environmentId }), queryFn: () => api.getServiceResources(appId, environmentId), enabled: Boolean(appId && environmentId) })
  const catalogs = useQuery({ queryKey: queryKey('catalog', null, { pageSize: 100 }), queryFn: () => api.listCatalog({ pageSize: 100 }) })
  if (!appId || isMissing(app.error) || isMissing(resources.error)) return <MissingResource />
  if (app.isPending) return <LoadingState label="正在讀取服務與環境…" />
  if (app.isError) return <ErrorState error={app.error} onRetry={() => void app.refetch()} />
  const env = app.data.environments.find(item => item.id === environmentId)
  if (environmentId && !env) return <MissingResource back={`/rd/apps/${appId}`} />
  const available = catalogs.data?.items.filter(item => item.status === 'published' && item.template.resourceKind !== 'compute' && item.allowedProjectIds.includes(app.data.application.projectId) && (!env || item.template.allowedStages.includes(env.stage))) ?? []
  const canCreate = session.effectiveActions.includes('change.create') && session.assignments.some(grant => grant.role === 'rd' && grant.scopeType === 'project' && grant.scopeId === app.data.application.projectId && (!grant.stages || env && grant.stages.includes(env.stage)))
  const wizard = (catalogId: string, extra: Record<string,string> = {}) => `/rd/catalog/${catalogId}/resource-request?${new URLSearchParams({ applicationId: appId, environmentId, ...extra })}`
  return <>
    <PageHeading eyebrow="RD · SERVICE RESOURCES" title={`${app.data.application.name} · 資源`} description="查看此服務環境的明確綁定、子資源與來源；共享物理資源沿用同一個 CI ID。" action={<Button asChild variant="outline"><Link to={`/rd/apps/${appId}`}><ArrowLeft size={16} aria-hidden="true" />服務詳情</Link></Button>} />
    <section className="panel resource-filters"><label>服務環境<select value={environmentId} onChange={event => { const next = new URLSearchParams(params); if (event.target.value) next.set('environmentId',event.target.value); else next.delete('environmentId'); setParams(next) }}><option value="">選擇環境</option>{app.data.environments.map(item => <option key={item.id} value={item.id}>{item.name} · {stageLabel[item.stage]}</option>)}</select></label>{env && <p><code>{env.id}</code> · {env.status} · Project <code>{app.data.application.projectId}</code></p>}</section>
    {catalogs.isError && <ErrorState error={catalogs.error} title="無法讀取資源模板" onRetry={() => void catalogs.refetch()} />}
    {env && canCreate && <section className="panel"><h2>提出資源需求</h2><p className="muted">建立草稿、確認後送審。核准與執行是不同步驟。</p><div className="resource-action-row">{available.map(item => <Button key={item.id} asChild variant="outline"><Link to={wizard(item.id)}>申請 {item.name}<ArrowRight size={16} aria-hidden="true" /></Link></Button>)}</div>{!catalogs.isPending && available.length === 0 && <p>此環境沒有可申請的已發布模板。</p>}</section>}
    {!environmentId ? <section className="panel empty-state"><h2>先選擇服務環境</h2><p>資源綁定以明確的 application/environment scope 查詢。</p></section> : resources.isPending ? <LoadingState label="正在讀取服務資源…" /> : resources.isError ? <ErrorState error={resources.error} onRetry={() => void resources.refetch()} /> : resources.data.resources.length === 0 ? <section className="panel empty-state" role="status"><h2>此環境尚無可見資源關聯</h2><p>申請經審批及執行成功後，才會出現生效的 Binding。</p></section> : <>
      <p className="muted">資料時間：{dateLabel(resources.data.dataAsOf)} · 僅顯示此環境的授權投影</p>
      <div className="resource-grid">{resources.data.resources.map(resource => <article className="panel resource-card" key={resource.ci.id}>
        <div className="panel-title"><Boxes size={18} aria-hidden="true" /><h2>{resource.ci.name}</h2><span className="tag">{resource.ci.kind}</span></div><Link to={resourcePath(resource.ci.kind, resource.ci.id)}><code>{resource.ci.id}</code> · 專業唯讀視圖</Link><p className="muted">觀測：{dateLabel(resource.ci.observedAt)} · {resource.ci.health}</p>
        {resource.objects.map(object => <div className="resource-object" key={object.id}><h3>{object.name}</h3><p>{objectKindLabel[object.kind]} · <code>{object.id}</code> · v{object.version}</p><ObjectSpec object={object} /><p className="muted">物件觀測：{dateLabel(object.observedAt)}</p>
          {resource.bindings.filter(binding => binding.resourceObjectId === object.id).map(binding => <dl className="detail-list" key={binding.id}><div><dt>Binding ID</dt><dd><code>{binding.id}</code> · {binding.state}</dd></div><div><dt>用途／安全 profile</dt><dd>{purposeLabel[binding.purpose]} · <code>{binding.accessProfileRef}</code></dd></div><div><dt>Placement</dt><dd><code>{binding.placementId}</code></dd></div><div><dt>來源</dt><dd>{binding.requestRef.sourceType === 'change' ? <Link to={`/rd/changes/${binding.requestRef.sourceId}`}>{binding.requestRef.sourceId}</Link> : <code>{binding.requestRef.sourceType}:{binding.requestRef.sourceId}</code>}</dd></div></dl>)}
          {object.kind === 'cache_allocation' && canCreate && available.filter(item => item.template.resourceKind === 'redis' && item.template.allowedParentCiIds.includes(resource.ci.id)).map(item => <Button key={item.id} asChild size="sm" variant="outline"><Link to={wizard(item.id, { mode: 'resize', ciId: resource.ci.id, objectId: object.id })}>調整自己的 Redis 配額</Link></Button>)}
        </div>)}
        {resource.legacyAssociations.length > 0 && <section className="resource-object"><h3>既有唯讀關聯</h3><p className="muted">Placement 表示配置關聯，不代表已取得子資源或存取權。</p>{resource.legacyAssociations.map(link => <p key={link.placementId}><code>{link.placementId}</code></p>)}</section>}
      </article>)}</div>
    </>}
  </>
}
