import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import type { WorkItemQuery } from '../../api/clients/resources'
import { PageHeading } from '../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import type { SessionView } from '../../domain/schemas'
import { dateLabel, WorkSummary } from './shared'

const sourceLabel = { request: '環境申請', release: '業務發布', change: '資源變更' } as const
export function WorkItemsPage({ center, session }: { center: 'rd' | 'ops'; session: SessionView }) {
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const source = params.get('source') as WorkItemQuery['source']
  const owner = (params.get('owner') ?? 'mine') as WorkItemQuery['owner']
  const view = (params.get('view') ?? 'pending') as WorkItemQuery['view']
  const phase = params.get('phase') as WorkItemQuery['phase']
  const state = (params.get('state') || undefined) as WorkItemQuery['state']
  const applicationId = params.get('applicationId') || undefined
  const environmentId = params.get('environmentId') || undefined
  const filters: WorkItemQuery = { center, page, pageSize: 25, sort: 'updatedAt', order: 'desc', ...(source ? { source } : {}),
    ...(center === 'rd' ? { owner } : { view }), ...(phase ? { phase } : {}), ...(state ? { state } : {}), applicationId, environmentId }
  const work = useQuery({ queryKey: queryKey('work-items', center, filters), queryFn: () => api.listWorkItems(filters) })
  const apps = useQuery({ queryKey: queryKey('applications', null, { pageSize: 100 }), queryFn: () => api.listApplications({ pageSize: 100 }) })
  const selectedApp = useQuery({ queryKey: queryKey('application', applicationId), queryFn: () => api.getApplication(applicationId!), enabled: Boolean(applicationId) })
  const setFilter = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); next.delete('page'); if (key === 'applicationId') next.delete('environmentId'); setParams(next) }
  const setPage = (value: number) => { const next = new URLSearchParams(params); next.set('page', String(value)); setParams(next) }
  return <>
    <PageHeading eyebrow={`${center.toUpperCase()} · WORK ITEMS`} title={center === 'rd' ? '環境申請' : '交付審批'} description="環境申請、業務發布及資源變更共用工作清單；每列保留原始來源 ID、狀態、決策與執行歷史。" action={center === 'rd' ? <Button asChild><Link to="/rd/catalog">新增申請<ArrowRight size={16} aria-hidden="true" /></Link></Button> : undefined} />
    <form className="panel resource-filters" onSubmit={event => event.preventDefault()}>
      <label>來源類型<select value={source ?? ''} onChange={e => setFilter('source', e.target.value)}><option value="">全部來源</option>{Object.entries(sourceLabel).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {center === 'rd' ? <label>工作範圍<select value={owner} onChange={e => setFilter('owner', e.target.value)}><option value="mine">我發起的工作</option><option value="team">團隊可見工作</option></select></label> : <label>處理範圍<select value={view} onChange={e => setFilter('view', e.target.value)}><option value="pending">待我處理</option><option value="all">全部可見</option></select></label>}
      <label>處理階段<select value={phase ?? ''} onChange={e => setFilter('phase', e.target.value)}><option value="">全部階段</option><option value="pending">待審</option><option value="decided">已決策</option><option value="execution">待執行／執行中</option><option value="failed">失敗</option><option value="completed">已完成</option></select></label>
      <label>狀態<select value={state ?? ''} onChange={e => setFilter('state', e.target.value)}><option value="">全部狀態</option>{Object.entries({ draft: '草稿', submitted: '待審核', approved: '已核准', rejected: '已拒絕', cancelled: '已撤回', provisioning: '環境交付中', fulfilled: '環境已完成', pending_approval: '發布待審', queued: '發布待執行', deploying: '發布部署中', verifying: '發布驗證中', executing: '資源執行中', succeeded: '成功', failed: '失敗' }).map(([value,label]) => <option key={value} value={value}>{label} · {value}</option>)}</select></label>
      <label>服務<select value={applicationId ?? ''} onChange={e => setFilter('applicationId', e.target.value)}><option value="">全部可見服務</option>{apps.data?.items.map(app => <option key={app.id} value={app.id}>{app.name}</option>)}</select></label>
      <label>環境<select value={environmentId ?? ''} disabled={!applicationId} onChange={e => setFilter('environmentId', e.target.value)}><option value="">全部可見環境</option>{selectedApp.data?.environments.map(env => <option key={env.id} value={env.id}>{env.name} · {env.stage}</option>)}</select></label>
      <Button variant="outline" onClick={() => void work.refetch()} disabled={work.isFetching}><RefreshCw size={16} aria-hidden="true" />重新整理</Button>
    </form>
    {(apps.error || selectedApp.error) && <ErrorState error={apps.error || selectedApp.error} title="無法讀取篩選選項" onRetry={() => { void apps.refetch(); if (applicationId) void selectedApp.refetch() }} />}
    {work.isPending ? <LoadingState label="正在讀取授權範圍內的工作單…" /> : work.isError ? <ErrorState error={work.error} onRetry={() => void work.refetch()} /> : work.data.items.length === 0 ? <section className="panel empty-state" role="status"><h2>目前沒有符合條件的工作單</h2><p>只計算 {session.user.displayName} 目前被授權且符合篩選的資料。</p></section> : <section className="panel"><div className="table-scroll" tabIndex={0} role="region" aria-label="工作單與審批差異，可水平捲動"><table className="resource-work-items-table"><caption>共 {work.data.total} 筆工作單；第 {page} 頁</caption><thead><tr><th scope="col">來源／編號</th><th scope="col">需求與差異</th><th scope="col">服務與目標</th><th scope="col">申請／批准</th><th scope="col">狀態</th><th scope="col">時間</th></tr></thead><tbody>{work.data.items.map(item => <tr key={`${item.sourceType}:${item.sourceId}`}><th scope="row"><span className="tag">{sourceLabel[item.sourceType]}</span><Link to={item.route}>{item.sourceId}</Link></th><td><WorkSummary summary={item.summary} /></td><td>{item.targetRefs.map(ref => <small key={`${ref.entityType}:${ref.entityId}`}><code>{ref.entityId}</code></small>)}</td><td>{item.requester.displayName}<small>{item.approver ? `決策：${item.approver.displayName}` : '尚無批准者'}</small></td><td>{item.stateLabel}<small><code>{item.rawState}</code> · {item.actionRequired ? '可處理' : '追蹤中'}</small></td><td>{dateLabel(item.updatedAt)}<small>來源經過 {Math.max(0, Math.floor((Date.parse(item.dataAsOf) - Date.parse(item.createdAt)) / 1000))} 秒；示範邏輯時鐘</small></td></tr>)}</tbody></table></div>
      <div className="resource-pagination"><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}><ArrowLeft size={16} aria-hidden="true" />上一頁</Button><span>第 {page} 頁</span><Button variant="outline" disabled={page * 25 >= work.data.total} onClick={() => setPage(page + 1)}>下一頁<ArrowRight size={16} aria-hidden="true" /></Button></div>
    </section>}
  </>
}
