import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import { PageHeading } from '../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import type { PipelineRun, SessionView } from '../../domain/schemas'
import { ReasonActionDialog, TriggerPipelineDialog } from './dialogs'
import { DeliveryAudit, DeliveryDemoControls, DeliveryPager, DeliveryStatus, EnvironmentScope, MissingDelivery, deliveryApi, isNotFound, pipelineLabels, projectAction, releaseLabels, stageLabels, stageStateLabels, timestamp } from './shared'

export function PipelineListPage({ session }: { session: SessionView }) {
  const [params, setParams] = useSearchParams()
  const applicationId = params.get('applicationId') ?? ''
  const environmentId = params.get('environmentId') ?? ''
  const state = params.get('state') ?? ''
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const filters = { applicationId: applicationId || undefined, environmentId: environmentId || undefined, state: Object.hasOwn(pipelineLabels, state) ? state as PipelineRun['state'] : undefined, page, pageSize: 25, sort: 'updatedAt' as const, order: 'desc' as const }
  const list = useQuery({ queryKey: queryKey('pipelines', null, filters), queryFn: () => deliveryApi.listPipelines(filters) })
  const apps = useQuery({ queryKey: queryKey('applications', null, { purpose: 'delivery-filter' }), queryFn: () => api.listApplications({ page: 1, pageSize: 100, sort: 'name', order: 'asc' }) })
  const application = useQuery({ queryKey: queryKey('application', applicationId), queryFn: () => api.getApplication(applicationId), enabled: Boolean(applicationId) })
  const update = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); if (key !== 'page') next.delete('page'); if (key === 'applicationId') next.delete('environmentId'); setParams(next, { replace: true }) }
  return <div className="delivery-page">
    <PageHeading eyebrow="RD · PIPELINES" title="Pipeline 執行紀錄" description="從已就緒的環境發布來源版本；查看每個階段、示範 log 與最終發布結果。" action={session.effectiveActions.includes('pipeline.trigger') ? <TriggerPipelineDialog session={session} applicationId={applicationId} environmentId={environmentId} /> : undefined} />
    <form className="panel delivery-filters" onSubmit={(event) => event.preventDefault()}>
      <label>應用篩選<select value={applicationId} disabled={apps.isPending} onChange={(event) => update('applicationId', event.target.value)}><option value="">全部應用</option>{apps.data?.items.map((app) => <option key={app.id} value={app.id}>{app.name}</option>)}</select></label>
      <label>環境篩選<select value={environmentId} disabled={Boolean(applicationId) && application.isPending} onChange={(event) => update('environmentId', event.target.value)}><option value="">全部環境</option>{environmentId && !application.data?.environments.some((env) => env.id === environmentId) && <option value={environmentId}>{environmentId}</option>}{application.data?.environments.map((env) => <option key={env.id} value={env.id}>{env.name} · {env.stage}</option>)}</select></label>
      <label>執行狀態<select value={filters.state ?? ''} onChange={(event) => update('state', event.target.value)}><option value="">全部狀態</option>{Object.entries(pipelineLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <Button variant="outline" disabled={list.isFetching} onClick={() => void list.refetch()}><RefreshCw size={15} aria-hidden="true" />重新整理</Button>
    </form>
    {(apps.isError || application.isError) && <ErrorState error={apps.error || application.error} title="篩選資料讀取失敗" onRetry={() => { void apps.refetch(); if (applicationId) void application.refetch() }} />}
    {list.isPending ? <LoadingState label="正在讀取目前 scope 的 Pipeline…" /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : <>
      {list.data.items.length === 0 ? <section className="panel empty-state" role="status"><h2>目前沒有符合條件的 Pipeline</h2><p>選擇已就緒的環境觸發第一次發布，或清除篩選查看其他執行紀錄。</p>{params.size > 0 && <Button variant="outline" onClick={() => setParams({}, { replace: true })}>清除篩選</Button>}</section> : <div className="panel table-scroll"><table><caption>目前授權範圍的 Pipeline 執行紀錄</caption><thead><tr><th scope="col">Pipeline / 來源版本</th><th scope="col">應用 / 環境</th><th scope="col">狀態</th><th scope="col">發布</th><th scope="col">更新時間</th></tr></thead><tbody>{list.data.items.map((run) => <tr key={run.id}><th scope="row"><Link to={`/rd/pipelines/${run.id}`}>{run.id}</Link><p><code>{run.revision}</code></p></th><td><code>{run.applicationId}</code><p><code>{run.environmentId}</code></p></td><td><DeliveryStatus state={run.state} label={pipelineLabels[run.state]} /></td><td>{run.releaseId ? <Link to={`/rd/releases/${run.releaseId}`}>{run.releaseId}</Link> : '尚未產生'}</td><td>{timestamp(run.updatedAt)}</td></tr>)}</tbody></table></div>}
      <DeliveryPager page={page} size={25} total={list.data.total} onPage={(next) => update('page', String(next))} />
    </>}
  </div>
}

export function PipelineDetailPage({ session }: { session: SessionView }) {
  const { runId = '' } = useParams()
  const navigate = useNavigate()
  const [selectedStage, setSelectedStage] = useState<PipelineRun['stages'][number]['name']>('build')
  const detail = useQuery({ queryKey: queryKey('pipeline', runId), queryFn: () => deliveryApi.getPipeline(runId), enabled: Boolean(runId) })
  const run = detail.data?.run
  const environmentQuery = useQuery({ queryKey: queryKey('environment', run?.environmentId), queryFn: () => api.getEnvironment(run!.environmentId), enabled: Boolean(run) })
  const appQuery = useQuery({ queryKey: queryKey('application', run?.applicationId), queryFn: () => api.getApplication(run!.applicationId), enabled: Boolean(run) })
  const releaseQuery = useQuery({ queryKey: queryKey('release', run?.releaseId), queryFn: () => deliveryApi.getRelease(run!.releaseId!), enabled: Boolean(run?.releaseId) })
  if (!runId || detail.isError && isNotFound(detail.error)) return <MissingDelivery entity="Pipeline" back="/rd/pipelines" />
  if (detail.isPending) return <LoadingState label="正在讀取 Pipeline 與階段 log…" />
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
  if (!run) return <MissingDelivery entity="Pipeline" back="/rd/pipelines" />
  const environment = environmentQuery.data?.environment
  const projectId = appQuery.data?.application.projectId
  const canCancel = projectAction(session, 'pipeline.cancel', projectId, environment?.stage)
  const canRetry = projectAction(session, 'pipeline.retry', projectId, environment?.stage)
  const deployStarted = run.stages.some((stage) => stage.name === 'deploy' && !['queued', 'skipped'].includes(stage.state))
  const terminal = ['succeeded', 'failed', 'cancelled'].includes(run.state)
  const cancelReason = !canCancel ? '目前身分沒有此環境的取消權限。' : run.triggeredBy !== session.user.id ? '只有這次 Pipeline 的發起人可以取消。' : terminal ? '這次執行已結束。' : deployStarted ? '部署或健康檢查已開始，不能取消。' : undefined
  const retryReason = !canRetry ? '目前身分沒有此環境的重試權限。' : !['failed', 'cancelled'].includes(run.state) ? '只有失敗或已取消的執行可以重試。' : undefined
  const logs = detail.data.logs.filter((log) => log.stage === selectedStage)
  const stage = run.stages.find((item) => item.name === selectedStage)
  return <div className="delivery-page">
    <PageHeading eyebrow="RD · PIPELINE DETAIL" title={`${run.id} · ${pipelineLabels[run.state]}`} description={`來源版本 ${run.revision}；只有發布通過健康檢查，才會更新生效版本。`} action={<Button asChild variant="outline"><Link to={`/rd/pipelines?applicationId=${encodeURIComponent(run.applicationId)}&environmentId=${encodeURIComponent(run.environmentId)}`}><ArrowLeft size={16} aria-hidden="true" />Pipeline 清單</Link></Button>} />
    {environment && <EnvironmentScope environment={environment} />}
    <div className="delivery-grid"><section className="panel"><div className="panel-title"><h2>執行摘要</h2><DeliveryStatus state={run.state} label={pipelineLabels[run.state]} /></div><dl className="detail-list"><div><dt>Pipeline ID</dt><dd><code>{run.id}</code></dd></div><div><dt>來源版本</dt><dd><code>{run.revision}</code></dd></div><div><dt>應用</dt><dd><Link to={`/rd/apps/${run.applicationId}`}>{appQuery.data?.application.name ?? run.applicationId}</Link></dd></div><div><dt>環境</dt><dd><Link to={`/rd/apps/${run.applicationId}/environments/${run.environmentId}`}>{environment?.name ?? run.environmentId}</Link></dd></div><div><dt>發起人</dt><dd><code>{run.triggeredBy}</code></dd></div><div><dt>Correlation</dt><dd><code>{run.correlationId}</code></dd></div><div><dt>重試來源</dt><dd>{run.retryOfRunId ? <Link to={`/rd/pipelines/${run.retryOfRunId}`}>{run.retryOfRunId}</Link> : '首次執行'}</dd></div><div><dt>失敗原因</dt><dd><code>{run.failureCode ?? '無'}</code></dd></div></dl></section>
      <section className="panel"><div className="panel-title"><h2>執行操作</h2></div>{environmentQuery.isPending || appQuery.isPending ? <LoadingState label="正在確認環境與操作權限…" /> : environmentQuery.isError || appQuery.isError ? <ErrorState error={environmentQuery.error || appQuery.error} onRetry={() => { void environmentQuery.refetch(); void appQuery.refetch() }} /> : environment && <><div className="delivery-actions"><ReasonActionDialog key={`cancel-${run.id}`} title="取消 Pipeline" description="只允許發起人在部署開始前取消；尚未執行的階段會略過，原有生效版本不受影響。" environment={environment} version={run.version} destructive disabledReason={cancelReason} command={(version, reason) => deliveryApi.cancelPipeline(run.id, version, reason)} /><ReasonActionDialog key={`retry-${run.id}`} title="重試 Pipeline" description="以相同來源版本建立新的執行紀錄，保留原始失敗、log 與關聯。" environment={environment} version={run.version} disabledReason={retryReason} command={(version, reason) => deliveryApi.retryPipeline(run.id, version, reason)} onSuccess={(receipt) => navigate(`/rd/pipelines/${receipt.entityId}`)} /></div>{run.state === 'awaiting_approval' && <p className="delivery-note">正式環境正在等待另一位 Ops 核准；請進入下方發布詳情查看審批。</p>}</>}</section></div>
    <section className="panel"><div className="panel-title"><h2>五階段執行流程</h2></div><ol className="delivery-stages" aria-label="Pipeline 階段">{run.stages.map((item, index) => <li key={item.name}><button type="button" aria-pressed={selectedStage === item.name} aria-label={`${stageLabels[item.name]} ${item.name} · ${stageStateLabels[item.state]}`} onClick={() => setSelectedStage(item.name)}><strong>{String(index + 1).padStart(2, '0')} · {stageLabels[item.name]}</strong><code>{item.name}</code><DeliveryStatus state={item.state} label={stageStateLabels[item.state]} /></button></li>)}</ol><h3>{stageLabels[selectedStage]}階段 log</h3><div className="delivery-stage-time"><span>開始：{timestamp(stage?.startedAt)}</span><span>完成：{timestamp(stage?.completedAt)}</span></div>{logs.length === 0 ? <p role="status" className="muted">這個階段尚無 log；推進模擬時鐘或選擇其他階段。</p> : <ol className="delivery-logs" aria-label={`${stageLabels[selectedStage]}階段 log`}>{logs.map((log) => <li key={log.id}><time dateTime={log.occurredAt}>{timestamp(log.occurredAt)}</time><span className={log.level === 'error' ? 'delivery-log-error' : 'muted'}>{log.level}</span><code>{log.message}</code></li>)}</ol>}</section>
    <section className="panel"><div className="panel-title"><h2>產物與候選發布</h2></div>{run.artifactDigest ? <><dl className="detail-list"><div><dt>產物 digest</dt><dd><code>{run.artifactDigest}</code></dd></div><div><dt>來源版本</dt><dd><code>{run.revision}</code></dd></div><div><dt>候選發布</dt><dd>{run.releaseId && <Link to={`/rd/releases/${run.releaseId}`}>{run.releaseId}</Link>}{releaseQuery.data && <> · {releaseLabels[releaseQuery.data.release.state]}</>}</dd></div>{releaseQuery.data && <><div><dt>產物檔名</dt><dd><code>{releaseQuery.data.artifact.filename}</code></dd></div><div><dt>建置配方</dt><dd><code>{releaseQuery.data.artifact.recipe}</code></dd></div></>}</dl><p className="delivery-note">示範合成 digest；沒有可下載的實際二進位產物，也不是密碼學證明。</p></> : <p className="muted">封裝尚未成功，沒有產物或發布紀錄。</p>}{releaseQuery.isError && <ErrorState error={releaseQuery.error} onRetry={() => void releaseQuery.refetch()} />}</section>
    {run.definitionId && run.definitionSnapshot && <section className="panel"><h2>交付定義執行快照</h2><p>本次執行固定使用修訂 {run.definitionRevision}；後續定義變更不改寫此快照。</p><dl className="detail-list"><div><dt>Definition ID</dt><dd><Link to={`/rd/apps/${run.applicationId}/delivery?${new URLSearchParams({ environmentId: run.environmentId, revisionId: run.definitionId })}`}>{run.definitionId}</Link></dd></div><div><dt>來源 reference</dt><dd><code>{run.definitionSnapshot.sourceRef}</code></dd></div><div><dt>來源 revision</dt><dd><code>{run.sourceRevision}</code></dd></div><div><dt>Repository reference</dt><dd><code>{run.definitionSnapshot.repositoryRef}</code></dd></div><div><dt>配方／產物 reference</dt><dd><code>{run.definitionSnapshot.recipeRef}</code> / <code>{run.definitionSnapshot.artifactRepositoryRef}</code></dd></div><div><dt>批准策略</dt><dd><code>{run.definitionSnapshot.approvalPolicyRef}</code></dd></div></dl></section>}
    <DeliveryDemoControls key={run.id} session={session} run={run} canInject={canRetry} />
    <DeliveryAudit entityId={run.id} />
  </div>
}
