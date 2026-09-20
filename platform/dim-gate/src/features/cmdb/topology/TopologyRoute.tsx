import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, GitBranch, RefreshCw, TriangleAlert } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Relation } from '../../../domain/schemas'
import type {
  CreateRelationInput,
  TopologyClient,
  TopologyDepth,
  TopologyMode,
  TopologyQuery,
  TopologyView,
} from '../../../api/clients/topology'
import { PageHeading } from '../../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../../components/shared/states'
import { Button } from '../../../components/ui/button'
import './topology.css'

type QueryKeyFactory = (family: string, scope?: unknown, filters?: unknown) => readonly unknown[]

export interface TopologyRouteProps {
  client: TopologyClient
  makeQueryKey: QueryKeyFactory
  canWriteRelations?: boolean
}

const relationLabels: Record<Relation['type'], string> = {
  runs_on: '執行於',
  depends_on: '依賴',
  connects_to: '連線至',
}

function readRouteQuery(parameters: URLSearchParams): { query: TopologyQuery | null; error: string | null } {
  const ciId = parameters.get('ciId')?.trim()
  const environmentId = parameters.get('environmentId')?.trim()
  if (ciId && environmentId) return { query: null, error: '一次只能指定一個 CI 或環境根節點。' }
  if (!ciId && !environmentId) return { query: null, error: null }
  const mode = parameters.get('mode') ?? 'dependencies'
  const depth = Number(parameters.get('depth') ?? '1')
  if (mode !== 'dependencies' && mode !== 'impact') return { query: null, error: '拓撲模式必須是 dependencies 或 impact。' }
  if (depth !== 1 && depth !== 2 && depth !== 3) return { query: null, error: '拓撲深度必須介於 1 到 3 hop。' }
  return {
    query: ciId
      ? { ciId, mode, depth: depth as TopologyDepth }
      : { environmentId: environmentId!, mode, depth: depth as TopologyDepth },
    error: null,
  }
}

export function TopologyRoute({ client, makeQueryKey, canWriteRelations = false }: TopologyRouteProps) {
  const [parameters, setParameters] = useSearchParams()
  const route = useMemo(() => readRouteQuery(parameters), [parameters])
  const [rootKind, setRootKind] = useState<'ci' | 'environment'>(parameters.has('environmentId') ? 'environment' : 'ci')
  const [rootId, setRootId] = useState(parameters.get('ciId') ?? parameters.get('environmentId') ?? '')
  const [mode, setMode] = useState<TopologyMode>(parameters.get('mode') === 'impact' ? 'impact' : 'dependencies')
  const initialDepth = Number(parameters.get('depth') ?? '1')
  const [depth, setDepth] = useState<TopologyDepth>(initialDepth === 2 || initialDepth === 3 ? initialDepth : 1)

  useEffect(() => {
    setRootKind(parameters.has('environmentId') ? 'environment' : 'ci')
    setRootId(parameters.get('ciId') ?? parameters.get('environmentId') ?? '')
    setMode(parameters.get('mode') === 'impact' ? 'impact' : 'dependencies')
    const nextDepth = Number(parameters.get('depth') ?? '1')
    setDepth(nextDepth === 2 || nextDepth === 3 ? nextDepth : 1)
  }, [parameters])

  const result = useQuery({
    queryKey: route.query
      ? makeQueryKey('topology', 'ciId' in route.query ? { ciId: route.query.ciId } : { environmentId: route.query.environmentId }, { mode: route.query.mode, depth: route.query.depth })
      : makeQueryKey('topology', null, null),
    queryFn: () => client.getTopology(route.query!),
    enabled: route.query !== null,
    retry: (failureCount, error) => failureCount < 1 && ![401, 403, 404, 422].includes((error as { status?: number }).status ?? 0),
  })

  function submitQuery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const id = rootId.trim()
    if (!id) return
    setParameters({ [rootKind === 'ci' ? 'ciId' : 'environmentId']: id, mode, depth: String(depth) })
  }

  return <>
    <PageHeading eyebrow="OPS · CMDB" title="依賴與影響拓撲" description="從一個可見的 CI 或環境出發，探索最多三層的配置關係。" />
    <form className="topology-query panel" aria-label="拓撲查詢條件" onSubmit={submitQuery}>
      <div className="topology-field">
        <label htmlFor="topology-root-kind">根節點類型</label>
        <select id="topology-root-kind" value={rootKind} onChange={(event) => setRootKind(event.target.value as 'ci' | 'environment')}>
          <option value="ci">CI</option>
          <option value="environment">環境</option>
        </select>
      </div>
      <div className="topology-field topology-root-field">
        <label htmlFor="topology-root-id">Canonical ID</label>
        <input id="topology-root-id" value={rootId} onChange={(event) => setRootId(event.target.value)} required maxLength={160} placeholder={rootKind === 'ci' ? 'ci-idc-redis-01' : 'env-checkout-prod'} />
      </div>
      <fieldset className="topology-mode">
        <legend>探索模式</legend>
        <label><input type="radio" name="topology-mode" value="dependencies" checked={mode === 'dependencies'} onChange={() => setMode('dependencies')} />依賴</label>
        <label><input type="radio" name="topology-mode" value="impact" checked={mode === 'impact'} onChange={() => setMode('impact')} />反向影響</label>
      </fieldset>
      <div className="topology-field">
        <label htmlFor="topology-depth">最大深度</label>
        <select id="topology-depth" value={depth} onChange={(event) => setDepth(Number(event.target.value) as TopologyDepth)}>
          <option value={1}>1 hop</option><option value={2}>2 hops</option><option value={3}>3 hops</option>
        </select>
      </div>
      <Button type="submit">探索拓撲<ArrowRight size={16} aria-hidden="true" /></Button>
    </form>
    <p className="topology-scope-note">結果只包含目前身分可見的配置項與關係；權限外項目不顯示名稱或數量。</p>
    {route.error && <section className="topology-invalid" role="alert"><TriangleAlert size={20} aria-hidden="true" /><p>{route.error}</p></section>}
    {!route.query && !route.error && <TopologyStartState />}
    {route.query && result.isPending && <LoadingState label="正在讀取授權範圍內的拓撲…" />}
    {route.query && result.isError && <TopologyError error={result.error} retry={() => void result.refetch()} />}
    {route.query && result.data && <TopologyResult data={result.data} mode={route.query.mode} refreshing={result.isFetching} refresh={() => void result.refetch()} />}
    {route.query && result.data && canWriteRelations && <RelationControls client={client} data={result.data} refresh={() => result.refetch()} />}
  </>
}

function TopologyStartState() {
  return <section className="topology-empty panel" aria-labelledby="topology-start-title">
    <GitBranch size={28} aria-hidden="true" />
    <div><h2 id="topology-start-title">選擇探索起點</h2><p>輸入目前範圍內的 CI 或環境 canonical ID，再選擇依賴或反向影響模式。</p></div>
  </section>
}

function TopologyError({ error, retry }: { error: unknown; retry: () => void }) {
  const status = (error as { status?: number }).status
  if (status === 403) return <section className="access-state" role="alert"><p className="eyebrow">403 · 拓撲權限</p><h2>目前身分無法讀取拓撲</h2><p>此入口需要對應中心與 <code>ci.read</code> action。請切換至具權限的示範身分。</p></section>
  if (status === 404) return <section className="topology-empty panel" role="status"><GitBranch size={28} aria-hidden="true" /><div><h2>找不到可見的根節點</h2><p>根節點不存在或不在目前授權範圍時都會得到相同結果。請確認 ID 或切換合法 scope。</p></div></section>
  return <ErrorState error={error} onRetry={retry} title="拓撲讀取失敗" />
}

function visibleEdges(data: TopologyView) {
  const visible = new Set(data.nodes.map((node) => node.id))
  return data.edges.filter((edge) => visible.has(edge.sourceCiId) && visible.has(edge.targetCiId))
}

function EntityLink({ id, name }: { id: string; name: string }) {
  return <Link className="topology-entity-link" aria-label={`${name} · ${id}`} to={`/ops/cmdb/${encodeURIComponent(id)}`}><span>{name}</span><code>{id}</code></Link>
}

function TopologyResult({ data, mode, refreshing, refresh }: { data: TopologyView; mode: TopologyMode; refreshing: boolean; refresh: () => void }) {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]))
  const edges = visibleEdges(data)
  if (data.nodes.length === 0) return <section className="topology-empty panel" role="status"><GitBranch size={28} aria-hidden="true" /><div><h2>目前範圍沒有可顯示的節點</h2><p>查詢已成功，但根環境沒有可見 placement，或目前 scope 沒有符合的配置項。</p></div></section>
  return <div className="topology-results">
    <section className="panel topology-graph" aria-labelledby="topology-graph-title">
      <div className="section-heading"><div><h2 id="topology-graph-title">{mode === 'dependencies' ? '依賴圖' : '反向影響圖'}</h2><p>{data.nodes.length} 個可見節點 · {edges.length} 條可見關係 · 已探索 {data.depthReached} hop</p></div><Button variant="ghost" size="sm" disabled={refreshing} onClick={refresh}><RefreshCw size={14} className={refreshing ? 'spin' : ''} aria-hidden="true" />重新整理</Button></div>
      {data.truncated && <div className="topology-truncated" role="status" aria-live="polite"><TriangleAlert size={18} aria-hidden="true" /><p><strong>結果已截斷</strong>僅顯示目前授權範圍內且符合 3 hops、100 nodes、200 edges 上限的結果；未顯示項目不提供數量。</p></div>}
      <ol className="topology-node-list" aria-label="可見拓撲節點">
        {data.nodes.map((node) => <li key={node.id}><EntityLink id={node.id} name={node.name} /><span>{node.kind} · {node.provider}</span></li>)}
      </ol>
      <div className="topology-edge-list" aria-label="可見拓撲連線">
        {edges.length === 0 ? <p className="muted">目前深度內沒有可見關係。</p> : edges.map((edge) => <div key={edge.id} className="topology-edge"><EntityLink id={edge.sourceCiId} name={nodes.get(edge.sourceCiId)!.name} /><span><ArrowRight size={14} aria-hidden="true" />{relationLabels[edge.type]}</span><EntityLink id={edge.targetCiId} name={nodes.get(edge.targetCiId)!.name} /></div>)}
      </div>
    </section>
    <section className="panel topology-table-panel" aria-labelledby="topology-table-title">
      <h2 id="topology-table-title">表格替代視圖</h2>
      <p>不使用圖形也能讀取相同的可見來源、關係與目標。</p>
      <div className="topology-table-scroll"><table><caption className="sr-only">目前拓撲中的可見配置關係</caption><thead><tr><th scope="col">來源 CI</th><th scope="col">關係</th><th scope="col">目標 CI</th><th scope="col">來源／信心</th></tr></thead><tbody>{edges.length === 0 ? <tr><td colSpan={4}>目前深度內沒有可見關係。</td></tr> : edges.map((edge) => <tr key={edge.id}><td><EntityLink id={edge.sourceCiId} name={nodes.get(edge.sourceCiId)!.name} /></td><td>{relationLabels[edge.type]}<code>{edge.type}</code></td><td><EntityLink id={edge.targetCiId} name={nodes.get(edge.targetCiId)!.name} /></td><td>{edge.source === 'manual' ? '手動' : edge.source === 'discovered' ? '探索' : '模板'} · {edge.confidence === 'verified' ? '已確認' : '推定'}</td></tr>)}</tbody></table></div>
    </section>
  </div>
}

function RelationControls({ client, data, refresh }: { client: TopologyClient; data: TopologyView; refresh: () => Promise<unknown> }) {
  const cache = useQueryClient()
  const [sourceCiId, setSourceCiId] = useState(data.nodes[0]?.id ?? '')
  const [targetCiId, setTargetCiId] = useState(data.nodes[1]?.id ?? '')
  const [type, setType] = useState<Relation['type']>('depends_on')
  const [createReason, setCreateReason] = useState('確認拓撲依賴')
  const manualEdges = visibleEdges(data).filter((edge) => edge.source === 'manual')
  const [deleteId, setDeleteId] = useState(manualEdges[0]?.id ?? '')
  const [deleteReason, setDeleteReason] = useState('移除錯誤關係')
  const [localError, setLocalError] = useState('')
  const [notice, setNotice] = useState('')
  const create = useMutation({ mutationFn: (input: CreateRelationInput) => client.createRelation(input) })
  const remove = useMutation({ mutationFn: ({ id, version, reason }: { id: string; version: number; reason: string }) => client.deleteRelation(id, { expectedVersion: version, reason }) })
  const refreshAffected = async () => {
    await cache.invalidateQueries({ predicate: (query) => ['relations', 'topology', 'environment', 'environments', 'application', 'applications', 'audit'].includes(String(query.queryKey[3])) })
  }

  useEffect(() => {
    if (!data.nodes.some((node) => node.id === sourceCiId)) setSourceCiId(data.nodes[0]?.id ?? '')
    if (!data.nodes.some((node) => node.id === targetCiId)) setTargetCiId(data.nodes[1]?.id ?? '')
    if (!manualEdges.some((edge) => edge.id === deleteId)) setDeleteId(manualEdges[0]?.id ?? '')
  }, [data, deleteId, manualEdges, sourceCiId, targetCiId])

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLocalError(''); setNotice('')
    if (sourceCiId === targetCiId) { setLocalError('來源與目標 CI 必須不同。'); return }
    const source = data.nodes.find((node) => node.id === sourceCiId)
    const target = data.nodes.find((node) => node.id === targetCiId)
    if (!source || !target) { setLocalError('請從目前可見節點選擇關係兩端。'); return }
    try {
      await create.mutateAsync({ sourceCiId, targetCiId, sourceExpectedVersion: source.version, targetExpectedVersion: target.version, type, reason: createReason.trim() })
      setNotice('關係已提交並寫入稽核。'); await refreshAffected()
    } catch { /* Mutation error is rendered below without automatic replay. */ }
  }

  async function submitDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLocalError(''); setNotice('')
    const edge = manualEdges.find((candidate) => candidate.id === deleteId)
    if (!edge) { setLocalError('請選擇目前可見的手動關係。'); return }
    try { await remove.mutateAsync({ id: edge.id, version: edge.version, reason: deleteReason.trim() }); setNotice('手動關係已移除並寫入稽核。'); await refreshAffected() } catch { /* Render below. */ }
  }

  return <section className="panel relation-controls" aria-labelledby="relation-controls-title">
    <div><p className="eyebrow">RELATION.WRITE</p><h2 id="relation-controls-title">關係管理</h2><p>版本檢查與 canonical identity 驗證由共用 domain engine 執行；成功後重新讀取授權後的拓撲。</p></div>
    {localError && <p className="field-error" role="alert">{localError}</p>}
    {notice && <p className="command-notice" role="status">{notice}</p>}
    {(create.isError || remove.isError) && <ErrorState error={create.error ?? remove.error} onRetry={() => void refresh()} title="關係未變更" />}
    <form className="relation-form" onSubmit={submitCreate}>
      <h3>建立關係</h3>
      <label>來源 CI<select value={sourceCiId} onChange={(event) => setSourceCiId(event.target.value)}>{data.nodes.map((node) => <option key={node.id} value={node.id}>{node.name} · {node.id}</option>)}</select></label>
      <label>關係<select value={type} onChange={(event) => setType(event.target.value as Relation['type'])}><option value="depends_on">依賴</option><option value="runs_on">執行於</option><option value="connects_to">連線至</option></select></label>
      <label>目標 CI<select value={targetCiId} onChange={(event) => setTargetCiId(event.target.value)}>{data.nodes.map((node) => <option key={node.id} value={node.id}>{node.name} · {node.id}</option>)}</select></label>
      <label>建立原因<input value={createReason} required maxLength={500} onChange={(event) => setCreateReason(event.target.value)} /></label>
      <Button type="submit" disabled={create.isPending || remove.isPending || data.nodes.length < 2}>{create.isPending ? '正在建立…' : '建立關係'}</Button>
    </form>
    <form className="relation-form" onSubmit={submitDelete}>
      <h3>移除手動關係</h3>
      <label>關係<select value={deleteId} disabled={!manualEdges.length} onChange={(event) => setDeleteId(event.target.value)}>{manualEdges.map((edge) => <option key={edge.id} value={edge.id}>{edge.sourceCiId} → {edge.targetCiId} · {edge.type}</option>)}</select></label>
      <label>移除原因<input value={deleteReason} required maxLength={500} onChange={(event) => setDeleteReason(event.target.value)} /></label>
      <Button type="submit" variant="outline" disabled={create.isPending || remove.isPending || !manualEdges.length}>{remove.isPending ? '正在移除…' : '移除關係'}</Button>
    </form>
  </section>
}
