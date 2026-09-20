import { useMemo, useState } from 'react'
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CheckCircle2, FilterX, RefreshCw } from 'lucide-react'
import { api, queryKey } from '../../../api/client'
import type { CiListFilters } from '../../../api/clients/cmdb'
import type { CIView, Provider, SessionView } from '../../../domain/schemas'
import { PageHeading } from '../../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../../components/shared/states'
import { Button } from '../../../components/ui/button'
import { CiOnboardingDialog } from './CiOnboardingDialog'
import { freshnessOf, freshnessText, healthLabels, kindLabels, providerLabels, type Freshness } from './ci-view'

const providers: Provider[] = ['aws', 'aliyun', 'onprem']

function NumericCapacity({ ci }: { ci: CIView }) {
  const cpu = typeof ci.attributes.cpu === 'number' ? ci.attributes.cpu : null
  const memory = typeof ci.attributes.memoryMiB === 'number' ? ci.attributes.memoryMiB : null
  return <span>{cpu === null ? '未知' : `${cpu} vCPU`} · {memory === null ? '未知' : `${memory} MiB`}</span>
}

export function CmdbListPage({ session }: { session: SessionView }) {
  const [provider, setProvider] = useState<Provider | ''>('')
  const [freshness, setFreshness] = useState<Freshness | ''>('')
  const [health, setHealth] = useState<CIView['health'] | ''>('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const filters = useMemo<CiListFilters>(() => ({
    ...(provider ? { provider } : {}), ...(freshness ? { freshness } : {}), ...(health ? { health } : {}),
    ...(q.trim() ? { q: q.trim() } : {}), page, pageSize: 25, sort: 'name', order: 'asc',
  }), [provider, freshness, health, q, page])
  const inventory = useQuery({
    queryKey: queryKey('cis', 'ops-visible', filters), queryFn: () => api.listCis(filters), placeholderData: keepPreviousData,
  })
  const counts = useQueries({ queries: [undefined, ...providers].map((source) => {
    const countFilters = { ...(source ? { provider: source } : {}), page: 1, pageSize: 1 } as CiListFilters
    return { queryKey: queryKey('cis', 'ops-visible', { ...countFilters, purpose: 'provider-count' }), queryFn: () => api.listCis(countFilters) }
  }) })
  const clearFilters = () => { setProvider(''); setFreshness(''); setHealth(''); setQ(''); setPage(1) }
  const canCreate = session.effectiveActions.includes('ci.create')
  const anyFilter = Boolean(provider || freshness || health || q.trim())
  return <section className="cmdb-page" aria-label="配置項資源清單">
    <PageHeading eyebrow="OPS CENTER · CMDB" title="配置項資源清單" description="同一組 canonical CI 供 RD、Ops、拓撲與容量投影使用；所有統計只包含目前 scope。" action={canCreate ? <CiOnboardingDialog onCommitted={setCreatedId} /> : undefined} />
    {createdId && <div className="success-state" role="status"><CheckCircle2 size={18} aria-hidden="true" />CI 已提交並寫入示範狀態：<Link to={`/ops/cmdb/${createdId}`}>{createdId}</Link></div>}
    <section className="panel ci-counts" aria-label="Provider 可見數量">
      <h2>可見配置項</h2>
      {counts.some((entry) => entry.isPending) ? <LoadingState label="正在計算 provider 數量…" /> : counts.some((entry) => entry.isError)
        ? <p role="alert">目前無法取得 provider 統計；未以 0 代替未知數量。</p>
        : <dl className="stats-strip">
          <div><dt>全部</dt><dd>{counts[0].data!.total}<span>筆</span></dd></div>
          {providers.map((source, index) => <div key={source}><dt>{providerLabels[source]}</dt><dd>{counts[index + 1].data!.total}<span>筆</span></dd></div>)}
        </dl>}
    </section>
    <form className="panel filter-bar" aria-label="篩選配置項" onSubmit={(event) => event.preventDefault()}>
      <label>搜尋<input type="search" value={q} onChange={(event) => { setQ(event.target.value); setPage(1) }} placeholder="名稱或 CI ID" /></label>
      <label>Provider<select value={provider} onChange={(event) => { setProvider(event.target.value as Provider | ''); setPage(1) }}><option value="">全部來源</option>{providers.map((source) => <option key={source} value={source}>{providerLabels[source]}</option>)}</select></label>
      <label>資料新鮮度<select value={freshness} onChange={(event) => { setFreshness(event.target.value as Freshness | ''); setPage(1) }}><option value="">全部狀態</option><option value="fresh">最新</option><option value="stale">過期</option><option value="unknown">未知／未觀測</option></select></label>
      <label>健康度<select value={health} onChange={(event) => { setHealth(event.target.value as CIView['health'] | ''); setPage(1) }}><option value="">全部健康度</option>{Object.entries(healthLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <Button variant="ghost" onClick={clearFilters} disabled={!anyFilter}><FilterX size={15} aria-hidden="true" />清除篩選</Button>
      <Button variant="outline" onClick={() => void inventory.refetch()} disabled={inventory.isFetching}><RefreshCw size={15} className={inventory.isFetching ? 'spin' : ''} aria-hidden="true" />重新整理</Button>
    </form>
    {inventory.isPending ? <LoadingState label="正在讀取目前 scope 的配置項…" /> : inventory.isError
      ? <ErrorState error={inventory.error} onRetry={() => void inventory.refetch()} title="配置項讀取失敗" />
      : inventory.data.items.length === 0
        ? <section className="panel empty-state" role="status"><h2>目前 scope 沒有符合條件的配置項</h2><p>{anyFilter ? '清除篩選以查看其他可見資源。' : '目前身分的 pool 或 project scope 沒有可見 CI。'}</p>{anyFilter && <Button variant="outline" onClick={clearFilters}>清除篩選</Button>}</section>
        : <div className="panel table-scroll"><table className="ci-table"><caption>目前 scope 的配置項；共 {inventory.data.total} 筆</caption><thead><tr><th scope="col">名稱</th><th scope="col">Kind</th><th scope="col">Provider</th><th scope="col">Location</th><th scope="col">健康度</th><th scope="col">新鮮度</th><th scope="col">容量</th><th scope="col">來源</th></tr></thead><tbody>{inventory.data.items.map((ci) => {
          const freshnessState = freshnessOf(ci, session.logicalClock)
          return <tr key={ci.id}><th scope="row"><Link to={`/ops/cmdb/${ci.id}`}>{ci.name}</Link><code>{ci.id}</code></th><td>{kindLabels[ci.kind]}</td><td>{providerLabels[ci.provider]}</td><td><code>{ci.locationId}</code></td><td><span className={`status status-${ci.health}`}>{healthLabels[ci.health]}</span></td><td><span className={`status freshness-${freshnessState}`}>{freshnessText(ci, session.logicalClock)}</span></td><td><NumericCapacity ci={ci} /></td><td>{ci.source === 'manual' ? '手動' : ci.source === 'discovered' ? '探索' : '交付'}</td></tr>
        })}</tbody></table><nav className="pagination" aria-label="配置項分頁"><Button variant="outline" disabled={inventory.data.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一頁</Button><span>第 {inventory.data.page} 頁，共 {Math.max(1, Math.ceil(inventory.data.total / inventory.data.pageSize))} 頁</span><Button variant="outline" disabled={inventory.data.page * inventory.data.pageSize >= inventory.data.total} onClick={() => setPage((value) => value + 1)}>下一頁</Button></nav></div>}
  </section>
}
