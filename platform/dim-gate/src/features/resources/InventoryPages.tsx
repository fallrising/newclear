import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import { PageHeading } from '../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../../components/ui/dialog'
import type { ResourceInventory, ResourceObject, SessionView } from '../../domain/schemas'
import { dateLabel, isMissing, kindLabel, MissingResource, ObjectSpec, purposeLabel, QuotaView, resourcePath, providerLabel } from './shared'

type InventoryKind = keyof typeof kindLabel
function ResizeControl({ inventory, object }: { inventory: ResourceInventory; object: ResourceObject }) {
  const impact = inventory.objectImpacts.find(item => item.resourceObjectId === object.id)
  const [open, setOpen] = useState(false)
  const [quota, setQuota] = useState(object.kind === 'cache_allocation' ? object.spec.quotaMiB : 0)
  const [reason, setReason] = useState('')
  const navigate = useNavigate()
  const catalog = useQuery({ queryKey: queryKey('catalog', null, { pageSize: 100 }), queryFn: () => api.listCatalog({ pageSize: 100 }), enabled: open })
  const available = catalog.data?.items.filter(item => item.status === 'published' && item.template.resourceKind === 'redis' && item.template.allowedParentCiIds.includes(inventory.ci.id)) ?? []
  const [catalogId, setCatalogId] = useState('')
  const selected = available.find(item => item.id === catalogId) ?? available[0]
  const template = selected?.template.resourceKind === 'redis' ? selected.template : undefined
  const create = useMutation({ mutationFn: () => api.createChange({ kind: 'resource.resize', catalogItemId: selected!.id, catalogRevision: selected!.revision, reason: reason.trim(), targetCiId: inventory.ci.id, targetCiVersion: inventory.ci.version, resourceObjectId: object.id, resourceObjectVersion: object.version, quotaMiB: quota }) })
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!selected) return; try { const receipt = await create.mutateAsync(); setOpen(false); navigate(`/ops/changes/${receipt.entityId}`) } catch { /* Exact refusal is rendered. */ } }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="outline" size="sm" disabled={!impact?.canResize}>提出共享配額維護</Button></DialogTrigger><DialogContent><DialogTitle>Redis allocation 配額維護</DialogTitle><DialogDescription>建立同一張資源變更草稿。需另一位具完整 scope 的 Ops 審批；不改實體 Redis instance。</DialogDescription>
    <form className="resource-form" onSubmit={event => void submit(event)}><p className="span-all"><code>{object.id}</code> · 目前版本 {object.version} · <ObjectSpec object={object} /></p>
      <label>資源模板<select value={selected?.id ?? ''} onChange={event => setCatalogId(event.target.value)} required><option value="">選擇已發布模板</option>{available.map(item => <option key={item.id} value={item.id}>{item.name} · rev {item.revision}</option>)}</select></label>
      <label>期望配額 MiB<input type="number" required min={template?.limits.minQuotaMiB ?? 1} max={template?.limits.maxQuotaMiB} value={quota} onChange={event => setQuota(Number(event.target.value))} /></label>
      <label className="span-all">維護理由<textarea required rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <section className="span-all resource-proposal"><h3>共享影響</h3>{impact?.consumers.map(item => <p key={item.environmentId}>{item.applicationName} / {item.environmentName} · {item.stage}</p>)}<p>此清單依目前授權投影；系統在提交及批准時重新核對。</p></section>
      {catalog.isPending && <LoadingState label="正在讀取已發布模板…" />}{catalog.isError && <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />}{create.isError && <ErrorState error={create.error} title="維護草稿未建立" />}
      <div className="form-actions span-all"><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={create.isPending}>取消</Button><Button type="submit" disabled={create.isPending || !selected || !reason.trim()}>{create.isPending ? '正在建立…' : '建立維護草稿'}</Button></div>
    </form>
  </DialogContent></Dialog>
}

export function InventoryListPage({ kind }: { kind: InventoryKind }) {
  const [params, setParams] = useSearchParams()
  const provider = params.get('provider') as 'aws' | 'aliyun' | 'onprem' | null
  const poolId = params.get('poolId') || undefined
  const page = Math.max(1, Number(params.get('page')) || 1)
  const filters = { kind, page, pageSize: 25, ...(provider ? { provider } : {}), poolId, q: params.get('q') || undefined }
  const inventory = useQuery({ queryKey: queryKey('resource-inventory', kind, filters), queryFn: () => api.listResourceInventory(filters) })
  const pools = useQuery({ queryKey: queryKey('pools', null, { provider }), queryFn: () => api.listPools(provider ? { provider } : {}) })
  const update = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key,value); else next.delete(key); if (key !== 'page') next.delete('page'); if (key === 'provider') next.delete('poolId'); setParams(next) }
  return <><PageHeading eyebrow="OPS · RESOURCE INVENTORY" title={kindLabel[kind]} description={kind === 'cluster' ? 'Kubernetes 唯讀摘要與服務關聯；不提供 kubectl、exec、scale 或叢集控制。' : '同一份 CMDB 身分、明確子資源、配額與服務綁定。物理容量與租用配額分開計算。'} />
    <form className="panel resource-filters" onSubmit={event => event.preventDefault()}><label>Provider<select value={provider ?? ''} onChange={e => update('provider',e.target.value)}><option value="">全部可見 provider</option>{Object.entries(providerLabel).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>資源池<select value={poolId ?? ''} onChange={e => update('poolId',e.target.value)}><option value="">全部授權資源池</option>{pools.data?.map(pool => <option key={pool.id} value={pool.id}>{pool.name}</option>)}</select></label><label>搜尋名稱或 ID<input type="search" value={filters.q ?? ''} onChange={e => update('q',e.target.value)} /></label><Button variant="outline" onClick={() => void inventory.refetch()} disabled={inventory.isFetching}><RefreshCw size={16} aria-hidden="true" />重新整理</Button></form>
    {pools.isError && <ErrorState error={pools.error} title="資源池選項讀取失敗" onRetry={() => void pools.refetch()} />}
    {inventory.isPending ? <LoadingState label="正在讀取共用資源清單…" /> : inventory.isError ? <ErrorState error={inventory.error} onRetry={() => void inventory.refetch()} /> : inventory.data.items.length === 0 ? <section className="panel empty-state" role="status"><h2>目前範圍沒有可用的專業資源</h2><p>只列出已支援並有讀取權的能力，未提供的 provider 不會轉成假成功。</p></section> : <section className="panel"><div className="table-scroll"><table><caption>{kindLabel[kind]} · 共 {inventory.data.total} 個物理 CI</caption><thead><tr><th scope="col">資源</th><th scope="col">Provider / pool</th><th scope="col">觀測</th><th scope="col">服務影響</th></tr></thead><tbody>{inventory.data.items.map(item => <tr key={item.ci.id}><th scope="row"><Link to={resourcePath(kind,item.ci.id)}>{item.ci.name}</Link><small><code>{item.ci.id}</code></small></th><td>{providerLabel[item.ci.provider]}<small><code>{item.ci.poolId}</code></small></td><td>{item.ci.health}<small>{dateLabel(item.ci.observedAt)}</small></td><td>{item.impactIncomplete ? '影響範圍未完整授權' : `${item.consumers.length} 個可見服務環境`}{item.readOnly && <small>唯讀能力</small>}</td></tr>)}</tbody></table></div><div className="resource-pagination"><Button variant="outline" disabled={page === 1} onClick={() => update('page',String(page - 1))}>上一頁</Button><span>第 {page} 頁</span><Button variant="outline" disabled={page * 25 >= inventory.data.total} onClick={() => update('page',String(page + 1))}>下一頁</Button></div></section>}
  </>
}

export function InventoryDetailPage({ kind, session }: { kind: InventoryKind; session: SessionView }) {
  const { ciId = '' } = useParams()
  const inventory = useQuery({ queryKey: queryKey('resource-inventory',ciId), queryFn: () => api.getResourceInventory(ciId), enabled: Boolean(ciId) })
  const ci = useQuery({ queryKey: queryKey('ci',ciId), queryFn: () => api.getCi(ciId), enabled: Boolean(ciId) })
  const back = `/ops/${kind === 'cache' ? 'caches' : kind === 'queue' ? 'messaging' : 'clusters'}`
  if (!ciId || isMissing(inventory.error) || isMissing(ci.error)) return <MissingResource back={back} />
  if (inventory.isPending || ci.isPending) return <LoadingState label="正在讀取資源與授權關聯…" />
  if (inventory.isError || ci.isError) return <ErrorState error={inventory.error || ci.error} onRetry={() => { void inventory.refetch(); void ci.refetch() }} />
  const data = inventory.data
  if (data.ci.kind !== kind) return <MissingResource back={back} />
  const attributes = ci.data.attributes
  const stale = data.ci.observedAt && Date.parse(data.dataAsOf) - Date.parse(data.ci.observedAt) > 86_400_000
  const canManage = session.effectiveActions.includes('resource.manage') && session.centers.includes('ops')
  return <>
    <PageHeading eyebrow={`OPS · ${kind.toUpperCase()} DETAIL`} title={data.ci.name} description={`${kindLabel[kind]} · ${data.readOnly ? '唯讀能力' : '有界 Mock 申請、審批與執行'}`} action={<Button asChild variant="outline"><Link to={back}><ArrowLeft size={16} aria-hidden="true" />資源清單</Link></Button>} />
    <section className="panel"><div className="panel-title"><h2>同一份資源身分</h2><span className="tag">{stale ? 'stale · 樣本過期' : data.ci.observedAt ? '有觀測樣本' : 'unknown · 尚無樣本'}</span></div><dl className="detail-list"><div><dt>CI ID</dt><dd><Link to={`/ops/cmdb/${ciId}`}>{ciId}<ArrowRight size={14} aria-hidden="true" /></Link></dd></div><div><dt>Provider / pool</dt><dd>{providerLabel[data.ci.provider]} · <code>{data.ci.poolId}</code></dd></div><div><dt>引擎 / 版本</dt><dd>{String(attributes.engine ?? attributes.orchestrator ?? '未知')} · {String(attributes.versionLabel ?? '未知')}</dd></div><div><dt>安全 endpoint label</dt><dd>{typeof attributes.endpointLabel === 'string' ? attributes.endpointLabel : '未提供'}</dd></div><div><dt>最近觀測</dt><dd>{dateLabel(data.ci.observedAt)}</dd></div><div><dt>投影時間</dt><dd>{dateLabel(data.dataAsOf)}</dd></div></dl><QuotaView capacity={data.capacity} /></section>
    {data.impactIncomplete && <section className="panel" role="status"><h2>影響範圍未完整授權</h2><p>只顯示目前可讀的服務，整體容量與影響仍受遮蔽。每個 allocation 的維護另依其全部使用方授權核對；沒有完整操作權限的項目需交由合格 Ops 處理。</p></section>}
    <section className="panel"><h2>可見子資源與綁定</h2>{data.objects.length === 0 && <p className="muted">目前沒有可讀的子資源。可見物理 CI 不會自動授予 object 存取權。</p>}{data.objects.map(object => <article className="resource-object" id={object.id} key={object.id}><h3>{object.name}</h3><p><code>{object.id}</code> · {object.kind} · v{object.version} · {object.lifecycle}</p><ObjectSpec object={object} /><p className="muted">觀測：{dateLabel(object.observedAt)}</p>
      {object.kind === 'kubernetes_namespace' && <><h4>Workload 唯讀樣本</h4><div className="table-scroll" tabIndex={0} role="region" aria-label="工作負載唯讀樣本，可水平捲動"><table><caption>{object.namespace ?? object.name} 的授權 workload</caption><thead><tr><th>工作負載</th><th>Replicas</th><th>Requests</th><th>Limits</th></tr></thead><tbody>{object.spec.workloads.map(workload => <tr key={workload.name}><th scope="row">{workload.name} · {workload.kind}</th><td>{workload.replicas}</td><td>{workload.requests.cpuMilli} mCPU / {workload.requests.memoryMiB} MiB</td><td>{workload.limits.cpuMilli} mCPU / {workload.limits.memoryMiB} MiB</td></tr>)}</tbody></table></div><h4>Node 唯讀樣本</h4>{object.spec.nodes.map(node => <p key={node.name}>{node.name} · allocatable {node.allocatable.cpuMilli} mCPU / {node.allocatable.memoryMiB} MiB · requested {node.requested.cpuMilli} mCPU / {node.requested.memoryMiB} MiB</p>)}</>}
      {data.bindings.filter(binding => binding.resourceObjectId === object.id).map(binding => <dl className="detail-list" key={binding.id}><div><dt>Binding</dt><dd><code>{binding.id}</code> · {binding.state}</dd></div><div><dt>服務／環境</dt><dd><Link to={`/rd/apps/${binding.applicationId}/resources?environmentId=${encodeURIComponent(binding.environmentId)}`}>{binding.applicationId} / {binding.environmentId}</Link></dd></div><div><dt>用途／profile</dt><dd>{purposeLabel[binding.purpose]} · <code>{binding.accessProfileRef}</code></dd></div><div><dt>Placement／來源</dt><dd><code>{binding.placementId}</code> · {binding.requestRef.sourceType === 'change' ? <Link to={`/ops/changes/${binding.requestRef.sourceId}`}>{binding.requestRef.sourceId}</Link> : binding.requestRef.sourceId}</dd></div></dl>)}
      {canManage && object.kind === 'cache_allocation' && <ResizeControl inventory={data} object={object} />}
    </article>)}</section>
    <section className="panel"><h2>可見服務影響</h2>{data.consumers.length ? data.consumers.map(consumer => <p key={consumer.environmentId}><Link to={`/rd/apps/${consumer.applicationId}/resources?environmentId=${encodeURIComponent(consumer.environmentId)}`}>{consumer.applicationName} / {consumer.environmentName}</Link> · {consumer.stage}</p>) : <p className="muted">目前沒有可讀的 consumers。</p>}{data.legacyAssociations.length > 0 && <p>另有可見的 legacy Placement 關聯；它們不代表已授予 Binding。</p>}</section>
  </>
}
