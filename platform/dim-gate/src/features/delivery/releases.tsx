import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import { PageHeading } from '../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import type { Release, SessionView } from '../../domain/schemas'
import { ReasonActionDialog, RollbackDialog } from './dialogs'
import { DeliveryAudit, DeliveryDemoControls, DeliveryPager, DeliveryStatus, EnvironmentScope, MissingDelivery, deliveryApi, healthLabels, isNotFound, projectAction, releaseLabels, timestamp } from './shared'

export function ReleaseListPage({ session }: { session: SessionView }) {
  const [params, setParams] = useSearchParams()
  const state = params.get('state') ?? ''
  const environmentId = params.get('environmentId') ?? ''
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const filters = { environmentId: environmentId || undefined, state: Object.hasOwn(releaseLabels, state) ? state as Release['state'] : undefined, page, pageSize: 25, sort: 'updatedAt' as const, order: 'desc' as const }
  const list = useQuery({ queryKey: queryKey('releases', null, filters), queryFn: () => deliveryApi.listReleases(filters) })
  const update = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); if (key !== 'page') next.delete('page'); setParams(next, { replace: true }) }
  return <div className="delivery-page"><PageHeading eyebrow="OPS · RELEASES" title="發布與審批" description="查看目前 scope 的候選發布、健康結果與回滾歷史。正式環境的發布由另一位 Ops 核准。" /><form className="panel delivery-filters" onSubmit={(event) => event.preventDefault()}><label>發布狀態<select value={filters.state ?? ''} onChange={(event) => update('state', event.target.value)}><option value="">全部狀態</option>{Object.entries(releaseLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>環境 ID 篩選<input value={environmentId} maxLength={160} onChange={(event) => update('environmentId', event.target.value)} placeholder="輸入完整環境 ID" /></label><Button variant="outline" disabled={list.isFetching} onClick={() => void list.refetch()}><RefreshCw size={15} aria-hidden="true" />重新整理</Button></form>{list.isPending ? <LoadingState label="正在讀取發布與審批…" /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : <>{list.data.items.length === 0 ? <section className="panel empty-state" role="status"><h2>目前沒有符合條件的發布</h2><p>只顯示 {session.user.displayName} 可讀取的環境；Pipeline 封裝成功後才會產生候選發布。</p>{params.size > 0 && <Button variant="outline" onClick={() => setParams({}, { replace: true })}>清除篩選</Button>}</section> : <div className="panel table-scroll"><table><caption>目前授權範圍的發布紀錄</caption><thead><tr><th scope="col">發布 / 類型</th><th scope="col">應用 / 環境</th><th scope="col">發布狀態</th><th scope="col">健康檢查</th><th scope="col">發起人 / 更新時間</th></tr></thead><tbody>{list.data.items.map((release) => <tr key={release.id}><th scope="row"><Link to={`/ops/releases/${release.id}`}>{release.id}</Link><p>{release.kind === 'rollback' ? '回滾' : '部署'}</p></th><td><code>{release.applicationId}</code><p><code>{release.environmentId}</code></p></td><td><DeliveryStatus state={release.state} label={releaseLabels[release.state]} /></td><td><DeliveryStatus state={release.health} label={healthLabels[release.health]} /></td><td><code>{release.createdBy}</code><p>{timestamp(release.updatedAt)}</p></td></tr>)}</tbody></table></div>}<DeliveryPager page={page} size={25} total={list.data.total} onPage={(next) => update('page', String(next))} /></>}</div>
}

export function ReleaseDetailPage({ session, center = 'rd' }: { session: SessionView; center?: 'rd' | 'ops' }) {
  const { releaseId = '' } = useParams()
  const detail = useQuery({ queryKey: queryKey('release', releaseId), queryFn: () => deliveryApi.getRelease(releaseId), enabled: Boolean(releaseId) })
  const release = detail.data?.release
  const environmentQuery = useQuery({ queryKey: queryKey('environment', release?.environmentId), queryFn: () => api.getEnvironment(release!.environmentId), enabled: Boolean(release) })
  const appQuery = useQuery({ queryKey: queryKey('application', release?.applicationId), queryFn: () => api.getApplication(release!.applicationId), enabled: Boolean(release) })
  const back = center === 'ops' ? '/ops/releases' : '/rd/pipelines'
  if (!releaseId || detail.isError && isNotFound(detail.error)) return <MissingDelivery entity="發布" back={back} />
  if (detail.isPending) return <LoadingState label="正在讀取發布、產物與回滾目標…" />
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
  if (!release) return <MissingDelivery entity="發布" back={back} />
  const { artifact, rollbackTargets } = detail.data
  const environment = environmentQuery.data?.environment
  const active = environmentQuery.data?.activeRelease
  const isActive = environment?.activeReleaseId === release.id
  const projectId = appQuery.data?.application.projectId
  const canApprove = projectAction(session, 'release.approve', projectId, environment?.stage)
  const canReject = projectAction(session, 'release.reject', projectId, environment?.stage)
  const canRollback = projectAction(session, 'release.rollback', projectId, environment?.stage)
  const approvalReason = !canApprove ? '目前身分沒有此環境的核准權限。' : release.createdBy === session.user.id ? '發起人不能核准自己的正式環境發布，請切換另一位授權 Ops。' : undefined
  const rejectReason = !canReject ? '目前身分沒有此環境的拒絕權限。' : release.createdBy === session.user.id ? '發起人不能審批自己的發布。' : undefined
  const rollbackReason = !canRollback ? '目前身分沒有此環境的回滾權限。' : !isActive ? '請從目前生效版本發起回滾。' : environment?.status !== 'ready' ? '環境尚未就緒。' : rollbackTargets.length === 0 ? '沒有同環境、不同產物且仍可用的成功歷史版本。' : undefined
  const releaseLink = (id: string) => `/${center}/releases/${id}`
  return <div className="delivery-page"><PageHeading eyebrow={`${center.toUpperCase()} · RELEASE DETAIL`} title={`${release.id} · ${releaseLabels[release.state]}`} description={`${release.kind === 'rollback' ? '回滾發布' : '候選部署'}；${healthLabels[release.health]}。`} action={<Button asChild variant="outline"><Link to={back}><ArrowLeft size={16} aria-hidden="true" />{center === 'ops' ? '發布清單' : 'Pipeline 清單'}</Link></Button>} />
    {environment && <EnvironmentScope environment={environment} />}
    <section className="panel delivery-current" aria-label="目前生效版本"><div className="panel-title"><h2>目前生效版本</h2></div>{environmentQuery.isPending ? <LoadingState label="正在確認目前生效版本…" /> : environmentQuery.isError ? <ErrorState error={environmentQuery.error} onRetry={() => void environmentQuery.refetch()} /> : environment?.activeReleaseId ? <><p><Link to={releaseLink(environment.activeReleaseId)}>{environment.activeReleaseId}</Link>{isActive && <span className="tag">正在查看此生效版本</span>}</p><p><code>{active?.artifactDigest ?? '產物 metadata 尚未讀取'}</code></p></> : <p className="muted">這個環境尚無生效版本。</p>}<p className="delivery-note">候選發布必須通過健康檢查才會切換；失敗、拒絕或取消會保留原生效版本。</p></section>
    <div className="delivery-grid"><section className="panel"><div className="panel-title"><h2>{release.kind === 'rollback' ? '回滾發布紀錄' : '候選發布紀錄'}</h2><DeliveryStatus state={release.state} label={releaseLabels[release.state]} /></div><dl className="detail-list"><div><dt>Release ID</dt><dd><code>{release.id}</code></dd></div><div><dt>健康檢查</dt><dd><DeliveryStatus state={release.health} label={healthLabels[release.health]} /></dd></div><div><dt>來源版本</dt><dd><code>{artifact.revision}</code></dd></div><div><dt>產物 digest</dt><dd><code>{artifact.digest}</code></dd></div><div><dt>產物檔名</dt><dd><code>{artifact.filename}</code></dd></div><div><dt>建置配方</dt><dd><code>{artifact.recipe}</code></dd></div><div><dt>發起人</dt><dd><code>{release.createdBy}</code></dd></div><div><dt>前一生效版本</dt><dd>{release.previousReleaseId ? <Link to={releaseLink(release.previousReleaseId)}>{release.previousReleaseId}</Link> : '無'}</dd></div><div><dt>回滾目標</dt><dd>{release.targetReleaseId ? <Link to={releaseLink(release.targetReleaseId)}>{release.targetReleaseId}</Link> : '不適用'}</dd></div><div><dt>Pipeline</dt><dd>{release.pipelineRunId ? session.effectiveActions.includes('pipeline.read') ? <Link to={`/rd/pipelines/${release.pipelineRunId}`}>{release.pipelineRunId}</Link> : <code>{release.pipelineRunId}</code> : '獨立回滾操作'}</dd></div><div><dt>Correlation</dt><dd><code>{release.correlationId}</code></dd></div><div><dt>操作理由</dt><dd>{release.reason ?? '未提供'}</dd></div><div><dt>失敗原因</dt><dd><code>{release.failureCode ?? '無'}</code></dd></div><div><dt>開始 / 完成</dt><dd>{timestamp(release.startedAt)} / {timestamp(release.completedAt)}</dd></div></dl><p className="delivery-note">此產物為合成的示範 metadata，沒有可下載的實際二進位檔。</p></section>
    <section className="panel"><div className="panel-title"><h2>審批與回滾</h2></div>{release.approval ? <dl className="detail-list"><div><dt>核准者</dt><dd><code>{release.approval.actorId}</code></dd></div><div><dt>核准時間</dt><dd>{timestamp(release.approval.occurredAt)}</dd></div><div><dt>核准理由</dt><dd>{release.approval.reason}</dd></div></dl> : <p className="muted">尚無核准紀錄。</p>}{environmentQuery.isPending || appQuery.isPending ? <LoadingState label="正在確認環境與操作權限…" /> : environmentQuery.isError || appQuery.isError ? <ErrorState error={environmentQuery.error || appQuery.error} onRetry={() => { void environmentQuery.refetch(); void appQuery.refetch() }} /> : environment && <>{release.state === 'pending_approval' && <div className="delivery-actions"><ReasonActionDialog title="核准發布" description="確認正式環境、來源版本與產物後核准；接著以模擬時鐘推進部署。" environment={environment} version={release.version} disabledReason={approvalReason} command={(version, reason) => deliveryApi.approveRelease(release.id, version, reason)} /><ReasonActionDialog title="拒絕發布" description="請說明拒絕原因；這次候選發布會結束，環境保留原生效版本。" environment={environment} version={release.version} destructive disabledReason={rejectReason} command={(version, reason) => deliveryApi.rejectRelease(release.id, version, reason)} /></div>}<div className="delivery-actions"><RollbackDialog key={release.id} detail={detail.data} environment={environment} center={center} disabledReason={rollbackReason} /></div>{release.kind === 'rollback' && <p className="delivery-note">回滾成功會送出觀測恢復請求；M3 不會自動將 incident 標為已解決。</p>}</>}</section></div>
    <DeliveryDemoControls key={release.id} session={session} release={release} canInject={canRollback} />
    <DeliveryAudit entityId={release.id} />
  </div>
}
