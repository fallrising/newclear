import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Boxes, Search, Shield } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, queryKey } from '../../../api/client'
import type { ApplicationClient } from '../../../api/clients/application'
import { PageHeading } from '../../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../../components/shared/states'
import { Button } from '../../../components/ui/button'
import type { Environment, Placement } from '../../../domain/schemas'

const defaultClient = api as typeof api & ApplicationClient

const stageLabel: Record<Environment['stage'], string> = { dev: '開發', staging: '預備', prod: '正式' }
const environmentStatusLabel: Record<Environment['status'], string> = {
  provisioning: '建立中', ready: '就緒', failed: '失敗', retired: '已退役',
}

function isNotFound(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { status?: number }).status === 404
}

function MissingEntity({ entity, backTo, backLabel }: { entity: string; backTo: string; backLabel: string }) {
  return <section className="access-state" role="status">
    <p className="eyebrow">404 · 找不到資料</p>
    <h1>找不到這個{entity}</h1>
    <p>資料可能不存在，或不在目前身分的授權範圍。為保護其他專案，不會顯示更多識別資訊。</p>
    <Button asChild variant="outline"><Link to={backTo}><ArrowLeft size={16} aria-hidden="true" />{backLabel}</Link></Button>
  </section>
}

function EmptyApplications({ filtered, clear }: { filtered: boolean; clear: () => void }) {
  return <section className="panel" role="status">
    <div className="panel-title"><Boxes size={20} aria-hidden="true" /><h2>{filtered ? '沒有符合條件的應用' : '目前範圍沒有應用'}</h2></div>
    <p className="muted">{filtered ? '請調整名稱或 ID 關鍵字。搜尋只會比對目前身分可見的應用。' : '目前授權專案尚無可見應用；切換示範身分會重新評估 scope。'}</p>
    {filtered && <Button variant="outline" onClick={clear}>清除篩選</Button>}
  </section>
}

export function ApplicationListRoute({ client = defaultClient }: { client?: ApplicationClient }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryText = searchParams.get('q')?.trim() ?? ''
  const [draft, setDraft] = useState(queryText)
  const filters = { q: queryText || undefined, page: 1, pageSize: 25, sort: 'name' as const, order: 'asc' as const }
  const applications = useQuery({
    queryKey: queryKey('applications', null, filters),
    queryFn: () => client.listApplications(filters),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = draft.trim()
    setSearchParams(next ? { q: next } : {}, { replace: true })
  }
  const clear = () => { setDraft(''); setSearchParams({}, { replace: true }) }
  return <>
    <PageHeading eyebrow="RD · APPLICATIONS" title="應用與環境" description="從獲授權的應用進入環境，沿用同一組 CI 身分查看部署位置。" />
    <div className="scope-summary"><Shield size={15} aria-hidden="true" /><span>清單先依目前專案 scope 過濾，再計算總數</span></div>
    <form className="panel" role="search" onSubmit={submit}>
      <label htmlFor="application-search">搜尋應用名稱或 ID</label>
      <div className="search-controls"><input id="application-search" name="q" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} /><Button type="submit"><Search size={16} aria-hidden="true" />搜尋</Button>{queryText && <Button type="button" variant="outline" onClick={clear}>清除</Button>}</div>
    </form>
    {applications.isPending ? <LoadingState label="正在讀取目前 scope 的應用…" /> : applications.isError ? (
      <ErrorState error={applications.error} onRetry={() => void applications.refetch()} />
    ) : applications.data.items.length === 0 ? <EmptyApplications filtered={Boolean(queryText)} clear={clear} /> : (
      <section className="panel" aria-labelledby="application-list-heading">
        <div className="panel-title"><Boxes size={20} aria-hidden="true" /><h2 id="application-list-heading">可見應用</h2><span className="tag">{applications.data.total} 個</span></div>
        <div className="table-scroll"><table><caption className="sr-only">目前身分可見的應用清單</caption><thead><tr><th scope="col">應用</th><th scope="col">層級</th><th scope="col">Project ID</th><th scope="col">Owner team</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead><tbody>{applications.data.items.map((application) => <tr key={application.id}><th scope="row"><Link to={`/rd/apps/${application.id}`}>{application.name}</Link><small><code>{application.id}</code></small></th><td>{application.tier === 'critical' ? '關鍵' : '標準'}</td><td><code>{application.projectId}</code></td><td><code>{application.ownerTeamId}</code></td><td><Button asChild variant="ghost" size="sm"><Link to={`/rd/apps/${application.id}`}>查看詳情<ArrowRight size={14} aria-hidden="true" /></Link></Button></td></tr>)}</tbody></table></div>
      </section>
    )}
  </>
}

export function ApplicationDetailRoute({ client = defaultClient }: { client?: ApplicationClient }) {
  const { appId = '' } = useParams()
  const detail = useQuery({
    queryKey: queryKey('application', appId, null),
    queryFn: () => client.getApplication(appId),
    enabled: Boolean(appId),
  })
  if (!appId || detail.isError && isNotFound(detail.error)) return <MissingEntity entity="應用" backTo="/rd/apps" backLabel="回到應用清單" />
  if (detail.isPending) return <LoadingState label="正在讀取應用與環境…" />
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
  const { application, environments } = detail.data
  return <>
    <PageHeading eyebrow="RD · APPLICATION DETAIL" title={application.name} description={application.description} action={<Button asChild variant="outline"><Link to="/rd/apps"><ArrowLeft size={16} aria-hidden="true" />應用清單</Link></Button>} />
    <section className="panel" aria-labelledby="application-facts-heading"><div className="panel-title"><h2 id="application-facts-heading">應用資料</h2><span className="tag">{application.tier === 'critical' ? '關鍵服務' : '標準服務'}</span></div><dl className="session-facts"><div><dt>Application ID</dt><dd><code>{application.id}</code></dd></div><div><dt>Project ID</dt><dd><code>{application.projectId}</code></dd></div><div><dt>Owner team</dt><dd><code>{application.ownerTeamId}</code></dd></div><div><dt>環境數</dt><dd>{environments.length}</dd></div></dl>{application.repositoryUrl && <p><a href={application.repositoryUrl} target="_blank" rel="noreferrer">開啟程式庫<span className="sr-only">（另開新視窗）</span></a></p>}</section>
    <section className="panel" aria-labelledby="environment-list-heading"><div className="panel-title"><h2 id="environment-list-heading">環境</h2><span className="tag">{environments.length} 個</span></div>{environments.length === 0 ? <p className="muted" role="status">這個應用目前沒有你可見的環境。</p> : <div className="table-scroll"><table><caption className="sr-only">{application.name} 的可見環境</caption><thead><tr><th scope="col">環境</th><th scope="col">階段</th><th scope="col">狀態</th><th scope="col">Active release</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead><tbody>{environments.map((environment) => <tr key={environment.id}><th scope="row"><Link to={`/rd/apps/${application.id}/environments/${environment.id}`}>{environment.name}</Link><small><code>{environment.id}</code></small></th><td>{stageLabel[environment.stage]}</td><td>{environmentStatusLabel[environment.status]}</td><td>{environment.activeReleaseId ? <code>{environment.activeReleaseId}</code> : '尚無 active release'}</td><td><Button asChild variant="ghost" size="sm"><Link to={`/rd/apps/${application.id}/environments/${environment.id}`}>查看配置項<ArrowRight size={14} aria-hidden="true" /></Link></Button></td></tr>)}</tbody></table></div>}</section>
  </>
}

type PlacementProjection = { ciId: string; roles: Set<Placement['role']> }

function distinctPlacements(placements: Placement[]) {
  const byCi = new Map<string, PlacementProjection>()
  for (const placement of placements) {
    const current = byCi.get(placement.ciId) ?? { ciId: placement.ciId, roles: new Set<Placement['role']>() }
    current.roles.add(placement.role)
    byCi.set(placement.ciId, current)
  }
  return [...byCi.values()].toSorted((left, right) => left.ciId.localeCompare(right.ciId))
}

export function EnvironmentDetailRoute({ client = defaultClient }: { client?: ApplicationClient }) {
  const { appId = '', environmentId = '' } = useParams()
  const detail = useQuery({
    queryKey: queryKey('environment', environmentId, null),
    queryFn: () => client.getEnvironment(environmentId),
    enabled: Boolean(appId && environmentId),
  })
  if (!appId || !environmentId || detail.isError && isNotFound(detail.error)) return <MissingEntity entity="環境" backTo="/rd/apps" backLabel="回到應用清單" />
  if (detail.isPending) return <LoadingState label="正在讀取環境 placement…" />
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
  if (detail.data.environment.applicationId !== appId) return <MissingEntity entity="環境" backTo={`/rd/apps/${appId}`} backLabel="回到應用詳情" />
  const { environment, activeRelease } = detail.data
  const placements = distinctPlacements(detail.data.placements)
  return <>
    <PageHeading eyebrow="RD · ENVIRONMENT" title={`${environment.name} 環境`} description="Placement 與 Ops Center 共用 canonical CI ID；跨中心下鑽不建立另一份資產。" action={<Button asChild variant="outline"><Link to={`/rd/apps/${appId}`}><ArrowLeft size={16} aria-hidden="true" />應用詳情</Link></Button>} />
    <section className="panel" aria-labelledby="environment-facts-heading"><div className="panel-title"><h2 id="environment-facts-heading">環境摘要</h2><span className="tag">{stageLabel[environment.stage]}</span></div><dl className="session-facts"><div><dt>Environment ID</dt><dd><code>{environment.id}</code></dd></div><div><dt>狀態</dt><dd>{environmentStatusLabel[environment.status]}</dd></div><div><dt>相異 CI</dt><dd>{placements.length}</dd></div><div><dt>Active release</dt><dd>{activeRelease ? <code>{activeRelease.id}</code> : '尚無 active release'}</dd></div></dl></section>
    <section className="panel" aria-labelledby="placement-heading"><div className="panel-title"><h2 id="placement-heading">配置項 placement</h2><span className="tag">{placements.length} 個 canonical CI</span></div>{placements.length === 0 ? <p className="muted" role="status">此環境目前有 0 個可見配置項。0 代表已成功讀取的空結果，不是未知狀態。</p> : <div className="table-scroll"><table><caption className="sr-only">此環境可見的 canonical CI placement</caption><thead><tr><th scope="col">CI ID</th><th scope="col">角色</th><th scope="col">跨中心下鑽</th></tr></thead><tbody>{placements.map((placement) => <tr key={placement.ciId}><th scope="row"><code>{placement.ciId}</code></th><td>{[...placement.roles].map((role) => role === 'workload' ? '工作負載' : '相依服務').join('、')}</td><td><Button asChild variant="outline" size="sm"><Link to={`/ops/cmdb/${placement.ciId}`}>在 Ops 查看<ArrowRight size={14} aria-hidden="true" /></Link></Button></td></tr>)}</tbody></table></div>}<p className="muted">若目前身分沒有 Ops Center/action，跨中心入口會顯示 403；有權限但 scope 外則回 404。</p></section>
  </>
}
