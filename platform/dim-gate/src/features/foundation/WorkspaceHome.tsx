import { useQuery } from '@tanstack/react-query'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { ArrowRight, RefreshCw, Shield } from 'lucide-react'
import { api, queryKey } from '../../api/client'
import type { Center, DashboardFilters, DashboardView, SessionView, WorkspaceHomeSection } from '../../domain/schemas'
import { PageHeading } from '../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import { InventorySummary } from '../cmdb'
import { centerDetails } from './center-details'

type Section = WorkspaceHomeSection
const states: Record<string, string> = { unknown: '尚無觀測樣本', unhealthy: '異常', fresh: '資料有效', available: '尚有可用容量', exhausted: '容量已用盡', error: '整合錯誤', stale: '資料已過期', healthy: '健康', critical: '嚴重異常', warning: '需要留意', ready: '可用', draft: '草稿', submitted: '待審批', approved: '待交付', failed: '失敗', pending_approval: '待批准', succeeded: '成功', provisioning: '交付中', open: '待處置', acknowledged: '已認領', investigating: '調查中', degraded: '降級', connected: '模擬連線正常' }
function DataTime({ value }: { value: string }) { return <time dateTime={value}>{value.replace('T', ' ').replace(/\.000Z$/, ' UTC').replace(/Z$/, ' UTC')}</time> }

function WorkSection({ data, dataAsOf, empty }: { data: Section; dataAsOf: string; empty: string }) {
  const location = useLocation()
  return <section className="panel home-section" aria-label={data.title}>
    <div className="panel-title"><h2>{data.title}</h2><span className="tag">{data.total} 項</span></div>
    <p className="home-data-time">資料時間：<DataTime value={dataAsOf} /></p>
    {data.items.length ? <ul className="home-work-list">{data.items.map(item => <li key={`${item.sourceType}:${item.sourceId}`}>
      <div className="home-item-heading"><Link to={item.route} state={{ workspaceReturn: location.pathname + location.search }}>{item.title}<ArrowRight size={14} aria-hidden="true" /></Link><span className={`home-state state-${item.state}`}>{states[item.state] ?? item.state}</span></div>
      <p>{item.detail}</p><div className="home-item-meta"><code>{item.sourceId}</code><span><DataTime value={item.dataAsOf} /></span></div>
    </li>)}</ul> : <p className="home-empty">{empty}</p>}
    {data.total > data.items.length && <p className="muted">顯示最近 {data.items.length} 項，共 {data.total} 項；可縮小首頁範圍。</p>}
  </section>
}

function HomeContent({ data }: { data: DashboardView }) {
  const home = data.workspace
  const section = (value: Section, empty: string) => <WorkSection data={value} dataAsOf={data.dataAsOf} empty={empty} />
  if (home.kind === 'rd') return <div className="home-layout home-rd" role="region" aria-label="rd 工作首頁">
    <div className="home-primary">{section(home.services, '目前範圍沒有服務環境；請確認專案授權或清除篩選。')}</div>
    <div className="home-secondary">{section(home.work, '目前沒有等待處理的申請或發布。')}{section(home.deliveries, '尚無發布紀錄。可從 Pipeline 發布完成第一筆交付。')}</div>
  </div>
  if (home.kind === 'ops') return <div className="home-layout home-ops" role="region" aria-label="ops 工作首頁">
    <div className="home-primary">{section(home.incidents, '目前沒有活動事件；沒有事件不代表已有健康樣本。')}{section(home.failures, '目前沒有失敗交付。')}{section(home.approvals, '目前沒有你可處理的待審項目。')}</div>
    <div className="home-secondary">{section(home.capacity, '目前範圍沒有獲授權資源池。')}{section(home.staleness, '目前沒有過期或未知的資源觀測。')}</div>
  </div>
  return <div className="home-layout home-admin" role="region" aria-label="admin 工作首頁">
    <div className="home-primary">{section(home.drafts, '目前沒有待發布的目錄草稿。')}{section(home.accessChanges, '目前沒有權限變更紀錄。')}</div>
    <div className="home-secondary">{section(home.integrations, '目前沒有可見的整合配置。')}</div>
  </div>
}

export function WorkspaceHome({ center, session }: { center: Center; session: SessionView }) {
  const [params, setParams] = useSearchParams()
  const filters: DashboardFilters = Object.fromEntries(['projectId', 'environmentId', 'provider', 'poolId', 'workOwner'].flatMap(key => params.get(key) ? [[key, params.get(key)!]] : []))
  const dashboard = useQuery({ queryKey: queryKey('dashboard', center, filters), queryFn: () => api.getDashboard(center, filters) })
  const details = centerDetails[center]
  const scope = dashboard.data?.scope
  const inaccessibleScope = scope && ((filters.projectId && !scope.projects.some(project => project.id === filters.projectId)) || (filters.environmentId && !scope.environments.some(environment => environment.id === filters.environmentId)) || (filters.poolId && !scope.pools.some(pool => pool.id === filters.poolId)))
  const setScope = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    if (key === 'projectId') next.delete('environmentId')
    if (key === 'provider') next.delete('poolId')
    next.delete('page')
    setParams(next)
  }
  return <>
    <PageHeading eyebrow={`${details.short} WORKSPACE`} title={details.name} description={details.purpose} action={<Button asChild><Link to={center === 'rd' ? '/rd/catalog' : center === 'ops' ? '/ops/requests' : '/admin/catalog'}>{center === 'rd' ? '申請環境' : center === 'ops' ? '查看審批' : '管理服務目錄'}<ArrowRight size={16} aria-hidden="true" /></Link></Button>} />
    <div className="scope-summary"><Shield size={15} aria-hidden="true" /><span>依目前身分授權範圍顯示</span><strong>{session.user.displayName}</strong><span>{details.responsibility}</span></div>
    <div className="home-scope" aria-label="首頁範圍">
      <label>專案<select aria-label="首頁專案" value={params.get('projectId') ?? ''} disabled={!scope} onChange={event => setScope('projectId', event.target.value)}><option value="">全部已授權專案</option>{scope?.projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
      <label>環境<select aria-label="首頁環境" value={params.get('environmentId') ?? ''} disabled={!scope} onChange={event => setScope('environmentId', event.target.value)}><option value="">全部已授權環境</option>{scope?.environments.map(environment => <option value={environment.id} key={environment.id}>{environment.name} · {environment.id}</option>)}</select></label>
      {center === 'rd' && <label>工作範圍<select aria-label="首頁工作範圍" value={params.get('workOwner') ?? 'all'} disabled={!scope} onChange={event => setScope('workOwner', event.target.value)}><option value="all">授權範圍內的所有工作</option><option value="mine">我發起的工作</option></select></label>}
      {center === 'ops' && <><label>來源<select aria-label="首頁來源" value={params.get('provider') ?? ''} disabled={!scope} onChange={event => setScope('provider', event.target.value)}><option value="">全部來源</option><option value="aws">AWS</option><option value="aliyun">Aliyun</option><option value="onprem">自建機房</option></select></label><label>資源池<select aria-label="首頁資源池" value={params.get('poolId') ?? ''} disabled={!scope} onChange={event => setScope('poolId', event.target.value)}><option value="">全部已授權資源池</option>{scope?.pools.map(pool => <option value={pool.id} key={pool.id}>{pool.name}</option>)}</select></label></>}
      {!!params.size && <Button variant="ghost" onClick={() => setParams({})}>清除篩選</Button>}
      <Button variant="ghost" aria-label="重新整理工作首頁" disabled={dashboard.isFetching} onClick={() => void dashboard.refetch()}><RefreshCw size={15} aria-hidden="true" />重新整理</Button>
    </div>
    {inaccessibleScope && <p className="workspace-notice" role="status">所選條件不在目前可見範圍，沒有符合資料。可清除篩選重新探索。</p>}
    {dashboard.isPending ? <LoadingState /> : dashboard.isError ? <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} /> : <><HomeContent data={dashboard.data} /><div className="home-inventory"><InventorySummary data={dashboard.data} refresh={() => void dashboard.refetch()} refreshing={dashboard.isFetching} /></div></>}
    <aside className="foundation-note"><span className="foundation-marker">Demo</span><div><h2>同一份服務、資源與交付紀錄</h2><p>工作區只改變呈現方式；授權、申請、發布與稽核由平台共同管理。Redis／Kafka 自助、配置灰度、告警設定及平台治理擴充尚待後續增量交付。</p></div></aside>
  </>
}
