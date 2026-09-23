import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import { PageHeading } from '../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import type { PlatformRoute, PlatformRouteSpec } from '../../domain/schemas'

const routeNames: Record<PlatformRouteSpec['routeKey'], string> = {
  'inventory.aws': 'AWS 盤點', 'inventory.aliyun': 'Aliyun 盤點', 'inventory.idc': 'IDC 盤點',
  'observation.apm': 'APM 觀測', 'notification.in_app': '站內 Demo 通知',
}

function RouteCard({ route, adapters, committed }: { route: PlatformRoute; adapters: readonly string[]; committed: () => Promise<unknown> }) {
  const [spec, setSpec] = useState(route.spec)
  const [reason, setReason] = useState('Review registered Mock route')
  const [restoreRevision, setRestoreRevision] = useState(route.revisions[0]!.revision)
  const diagnostic = useQuery({ queryKey: queryKey('platform-route-diagnostic', route.id, route.version),
    queryFn: () => api.getPlatformRouteDiagnostic(route.id) })
  const mutation = useMutation({ mutationFn: (action: 'revise' | 'validate' | 'activate' | 'disable' | 'test' | 'restore') => {
    if (action === 'revise') return api.revisePlatformRoute(route.id, route.version, spec, reason)
    if (action === 'restore') return api.restorePlatformRoute(route.id, route.version, restoreRevision, reason)
    return api.platformRouteAction(route.id, action, route.version, reason)
  } })
  const run = async (action: Parameters<typeof mutation.mutateAsync>[0]) => {
    try { await mutation.mutateAsync(action); await committed() } catch { /* Render exact refusal below. */ }
  }
  const active = route.revisions.find(row => row.revision === route.activeRevision)
  return <article className="panel" aria-label={routeNames[route.spec.routeKey]}>
    <div className="panel-title"><h2>{routeNames[route.spec.routeKey]}</h2><span className="tag">{route.status} · draft r{route.revision} · active {route.activeRevision ? `r${route.activeRevision}` : '無'}</span></div>
    <p><code>{route.spec.routeKey}</code> · <code>{route.id}</code></p>
    <p className="muted">固定 Demo adapter；測試不發送外部請求。故障或停用時會顯示已註冊的本機 fallback。</p>
    {active && active.revision !== route.revision && <p>啟用 r{active.revision}：{active.spec.adapterRef}／{active.spec.timeoutMs}ms；草稿 r{route.revision}：{route.spec.adapterRef}／{route.spec.timeoutMs}ms</p>}
    <div className="catalog-spec-grid"><label>Mock adapter<select value={spec.adapterRef} onChange={event => setSpec({ ...spec, adapterRef: event.target.value as PlatformRouteSpec['adapterRef'] })}>
      {adapters.map(ref => <option key={ref} value={ref}>{ref}</option>)}</select></label>
      <label>Timeout（毫秒）<input type="number" min={100} max={5000} step={100} value={spec.timeoutMs} onChange={event => setSpec({ ...spec, timeoutMs: Number(event.target.value) })} /></label></div>
    <label>變更理由<input required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
    <div className="request-actions">
      {route.status !== 'draft' && <Button variant="outline" disabled={mutation.isPending || !reason.trim()} onClick={() => void run('revise')}>建立新版草稿</Button>}
      {route.status === 'draft' && <Button disabled={mutation.isPending || !reason.trim()} onClick={() => void run('validate')}>驗證草稿</Button>}
      {route.status === 'validated' && <Button disabled={mutation.isPending || !reason.trim()} onClick={() => void run('activate')}>啟用路由</Button>}
      {['validated', 'active'].includes(route.status) && <Button variant="outline" disabled={mutation.isPending || !reason.trim()} onClick={() => void run('test')}>執行本機 Mock 診斷</Button>}
      {route.activeRevision !== null && route.status !== 'disabled' && <Button variant="destructive" disabled={mutation.isPending || !reason.trim()} onClick={() => void run('disable')}>停用路由</Button>}
    </div>
    {route.status !== 'draft' && <div className="request-actions"><label>復原版本<select aria-label={`${route.id} 復原版本`} value={restoreRevision} onChange={event => setRestoreRevision(Number(event.target.value))}>
      {route.revisions.map(row => <option key={row.revision} value={row.revision}>r{row.revision} · {row.reason}</option>)}
    </select></label><Button variant="outline" disabled={mutation.isPending || !reason.trim()} onClick={() => void run('restore')}>復原為新版</Button></div>}
    <section><h3>診斷與 fallback</h3><dl className="detail-list">
      <div><dt>最後測試</dt><dd>{route.health.status} · {route.health.code} · {route.health.testedRevision ? `r${route.health.testedRevision}` : '未測試'}</dd></div>
      {diagnostic.isSuccess && <><div><dt>目前解析</dt><dd>{diagnostic.data.status} · {diagnostic.data.code}</dd></div>
        <div><dt>實際本機 adapter</dt><dd><code>{diagnostic.data.adapterRef}</code></dd></div>
        <div><dt>固定 fallback</dt><dd><code>{diagnostic.data.fallbackAdapterRef}</code></dd></div></>}
    </dl>{diagnostic.isError && <ErrorState error={diagnostic.error} onRetry={() => void diagnostic.refetch()} />}</section>
    <section><h3>不可變版本紀錄</h3><ul>{route.revisions.map(row => <li key={row.revision}>r{row.revision} · {row.spec.adapterRef} · {row.spec.timeoutMs}ms · {row.reason}</li>)}</ul></section>
    <Button asChild variant="outline"><Link to={`/admin/audit?entityType=platformRoute&entityId=${encodeURIComponent(route.id)}`}>查看稽核</Link></Button>
    {mutation.isError && <ErrorState error={mutation.error} title="註冊路由未更新" />}
  </article>
}

export function RoutePage() {
  const [page, setPage] = useState(1)
  const routes = useQuery({ queryKey: queryKey('platform-routes', null, page), queryFn: () => api.listPlatformRoutes(page, 25) })
  const registry = useQuery({ queryKey: queryKey('platform-route-registry'), queryFn: () => api.getPlatformRouteRegistry() })
  const capability = useQuery({ queryKey: queryKey('capability-registry'), queryFn: () => api.getCapabilityRegistry() })
  const [routeKey, setRouteKey] = useState<PlatformRouteSpec['routeKey']>('inventory.aws')
  const [adapterRef, setAdapterRef] = useState<PlatformRouteSpec['adapterRef']>('demo-aws-inventory')
  const [timeoutMs, setTimeoutMs] = useState(1000)
  const [reason, setReason] = useState('Create registered Mock route')
  const create = useMutation({ mutationFn: (spec: PlatformRouteSpec) => api.createPlatformRoute(spec, reason) })
  const refresh = async () => { await Promise.all([routes.refetch(), capability.refetch()]) }
  const submit = async (event: FormEvent) => { event.preventDefault(); const entry = registry.data?.find(row => row.routeKey === routeKey)
    if (!entry) return
    try { await create.mutateAsync({ routeKey, capabilityId: entry.capabilityId, integrationId: entry.integrationId, adapterRef, timeoutMs }); await refresh() }
    catch { /* Render exact refusal below. */ }
  }
  if (routes.isPending || registry.isPending || capability.isPending) return <LoadingState label="正在讀取註冊路由…" />
  if (routes.isError) return <ErrorState error={routes.error} onRetry={() => void routes.refetch()} />
  if (registry.isError) return <ErrorState error={registry.error} onRetry={() => void registry.refetch()} />
  if (capability.isError) return <ErrorState error={capability.error} onRetry={() => void capability.refetch()} />
  const selected = registry.data.find(row => row.routeKey === routeKey)!
  const choices = registry.data.filter(row => !routes.data.items.some(item => item.spec.routeKey === row.routeKey))
  return <><PageHeading eyebrow="ADMIN · MOCK ADAPTER ROUTES" title="註冊路由與診斷" description="路由、能力、整合與 adapter 都來自固定清單；診斷只在本機產生安全結果，不連線到外部來源。" />
    <form className="panel admin-form" onSubmit={event => void submit(event)}><div className="panel-title"><h2>建立註冊路由草稿</h2></div>
      <label>固定路由<select value={routeKey} onChange={event => { const next = registry.data.find(row => row.routeKey === event.target.value)!; setRouteKey(next.routeKey); setAdapterRef(next.supportedAdapters[0]!) }}>
        {registry.data.map(entry => <option key={entry.routeKey} value={entry.routeKey}>{routeNames[entry.routeKey]}</option>)}</select></label>
      <p>能力：<code>{selected.capabilityId}</code> · 整合：<code>{selected.integrationId}</code> · schema：<code>{selected.schemaId}</code></p>
      <label>Mock adapter<select value={adapterRef} onChange={event => setAdapterRef(event.target.value as PlatformRouteSpec['adapterRef'])}>
        {selected.supportedAdapters.map(ref => <option key={ref} value={ref}>{ref}</option>)}</select></label>
      <label>Timeout（毫秒）<input type="number" min={100} max={5000} step={100} value={timeoutMs} onChange={event => setTimeoutMs(Number(event.target.value))} /></label>
      <label>理由<input required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <div className="form-actions span-all"><Button type="submit" disabled={create.isPending || !reason.trim() || !choices.some(entry => entry.routeKey === routeKey)}>建立草稿</Button></div>
    </form>
    {create.isError && <ErrorState error={create.error} title="路由未建立" />}
    {routes.data.items.map(route => <RouteCard key={`${route.id}:${route.version}`} route={route}
      adapters={registry.data.find(entry => entry.routeKey === route.spec.routeKey)!.supportedAdapters} committed={refresh} />)}
    <section className="panel"><h2>能力地圖與目前 Mock 診斷</h2><p>固定 capability／route／action／schema 對應；未接入的能力明確標為 later。</p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="唯讀能力地圖"><table><caption>只讀註冊狀態與目前本機 adapter 解析</caption><thead><tr>
        <th>Capability</th><th>Route</th><th>Action</th><th>Schema</th><th>Adapter / health</th><th>狀態</th>
      </tr></thead><tbody>
        {capability.data.features.map(row => <tr key={row.featureKey}><th scope="row"><code>{row.capabilityId}</code></th><td><code>{row.route}</code></td>
          <td><code>{row.action}</code></td><td><code>{row.schemaId}</code></td><td>Demo cohort</td><td>{row.status}</td></tr>)}
        {capability.data.routes.map(row => <tr key={row.routeKey}><th scope="row"><code>{row.capabilityId}</code></th><td><code>{row.routeKey}</code></td>
          <td><code>{row.action}</code></td><td><code>{row.schemaId}</code></td>
          <td><code>{row.diagnostic.adapterRef}</code> · {row.diagnostic.status} · {row.diagnostic.code}</td><td>{row.status}</td></tr>)}
        {capability.data.later.map(row => <tr key={row.capabilityId}><th scope="row">{row.label}</th><td>—</td><td>—</td><td>—</td><td>—</td><td>{row.status}</td></tr>)}
      </tbody></table></div></section>
    <div className="request-actions"><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>上一頁</Button><span>第 {page} 頁，共 {routes.data.total} 筆</span>
      <Button variant="outline" disabled={page * 25 >= routes.data.total} onClick={() => setPage(page + 1)}>下一頁</Button></div>
  </>
}
