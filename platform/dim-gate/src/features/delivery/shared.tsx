import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Clock3 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import type { DeliveryClient } from '../../api/clients/delivery'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import type { CommandReceipt, Environment, PipelineRun, Release, SessionView } from '../../domain/schemas'
import './delivery.css'

// The application composition is owned by the integration task.
export const deliveryApi = api as typeof api & DeliveryClient
type Scenario = 'build-failure' | 'health-failure' | 'rollback-failure'
const demoApi = api as typeof api & { setScenario: (key: Scenario, target: { runId?: string; releaseId?: string }) => Promise<CommandReceipt> }
export const pipelineLabels: Record<PipelineRun['state'], string> = { queued: '等待執行', running: '執行中', awaiting_approval: '等待正式環境核准', succeeded: '成功', failed: '失敗', cancelled: '已取消' }
export const releaseLabels: Record<Release['state'], string> = { pending_approval: '待核准', queued: '等待部署', deploying: '部署中', verifying: '健康檢查中', succeeded: '成功', failed: '失敗', rejected: '已拒絕', cancelled: '已取消' }
export const healthLabels: Record<Release['health'], string> = { pending: '尚未完成健康檢查', healthy: '健康檢查通過', unhealthy: '健康檢查失敗' }
export const stageLabels = { build: '建置', test: '測試', package: '封裝', deploy: '部署', verify: '健康檢查' } as const
export const stageStateLabels = { queued: '等待執行', running: '執行中', succeeded: '成功', failed: '失敗', cancelled: '已取消', skipped: '已略過' } as const
export const environmentStageLabels = { dev: '開發', staging: '預備', prod: '正式' } as const
export const timestamp = (value?: string) => value ? new Date(value).toLocaleString('zh-TW') : '尚未發生'
export const isNotFound = (error: unknown) => typeof error === 'object' && error !== null && (error as { status?: number }).status === 404

export function projectAction(session: SessionView, action: string, projectId?: string, stage?: Environment['stage']) {
  const role = ['release.approve', 'release.reject'].includes(action) ? 'ops' : 'rd'
  return Boolean(projectId && stage && session.effectiveActions.includes(action) && session.assignments.some((grant) =>
    grant.role === role && grant.scopeType === 'project' && grant.scopeId === projectId && (!grant.stages || grant.stages.includes(stage))))
}

export function useDeliveryRefresh() {
  const cache = useQueryClient()
  return () => cache.invalidateQueries({ predicate: (query) => ['pipeline', 'pipelines', 'release', 'releases', 'environment', 'environments', 'application', 'applications', 'audit', 'guide'].includes(String(query.queryKey[3])) })
}

export function MissingDelivery({ entity, back }: { entity: string; back: string }) {
  return <section className="access-state" role="status"><p className="eyebrow">404 · 找不到資料</p><h1>找不到這個{entity}</h1><p>資料不存在，或不在目前身分的授權範圍。</p><Button asChild variant="outline"><Link to={back}><ArrowLeft size={16} aria-hidden="true" />返回清單</Link></Button></section>
}

export function DeliveryStatus({ state, label }: { state: string; label: string }) {
  return <span className={`delivery-status delivery-status-${state}`}>{label}</span>
}

export function EnvironmentScope({ environment }: { environment: Environment }) {
  return <p className="delivery-scope"><span className={`delivery-status ${environment.stage === 'prod' ? 'delivery-status-pending_approval' : ''}`}>{environmentStageLabels[environment.stage]} · {environment.stage}</span><span>{environment.name}</span><code>{environment.id}</code></p>
}

export function DeliveryPager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (page: number) => void }) {
  return <nav className="delivery-pager" aria-label="清單分頁"><span>共 {total} 筆 · 第 {page} 頁</span><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一頁</Button><Button variant="outline" size="sm" disabled={page * size >= total} onClick={() => onPage(page + 1)}>下一頁</Button></nav>
}

export function DeliveryAudit({ entityId }: { entityId: string }) {
  const filters = { entityId, page: 1, pageSize: 100, sort: 'occurredAt' as const, order: 'asc' as const }
  const audit = useQuery({ queryKey: queryKey('audit', entityId, filters), queryFn: () => api.listAudit(filters) })
  return <section className="panel"><div className="panel-title"><h2>操作與稽核歷史</h2></div>{audit.isPending ? <LoadingState label="正在讀取這筆操作的稽核…" /> : audit.isError ? <ErrorState error={audit.error} onRetry={() => void audit.refetch()} /> : audit.data.items.length === 0 ? <p className="muted">目前沒有可見的稽核紀錄。</p> : <ol className="delivery-audit">{audit.data.items.map((entry) => <li key={entry.id}><time dateTime={entry.occurredAt}>{timestamp(entry.occurredAt)}</time><strong>{entry.action}</strong><span>執行者 <code>{entry.actorId}</code> · {entry.outcome}</span><p>{entry.diffSummary.join('；')}</p>{entry.reason && <p>理由：{entry.reason}</p>}<code>{entry.correlationId}</code></li>)}</ol>}{audit.data && audit.data.total > audit.data.items.length && <p className="muted">顯示最早 {audit.data.items.length} 筆，共 {audit.data.total} 筆紀錄。</p>}</section>
}

export function DeliveryDemoControls({ session, run, release, canInject }: { session: SessionView; run?: PipelineRun; release?: Release; canInject: boolean }) {
  const [ticks, setTicks] = useState(1)
  const [notice, setNotice] = useState('')
  const [injected, setInjected] = useState<Scenario[]>([])
  const refresh = useDeliveryRefresh()
  const command = useMutation({ mutationFn: async (kind: 'clock' | Scenario) => {
    if (kind === 'clock') return api.advanceClock(ticks)
    return demoApi.setScenario(kind, kind === 'rollback-failure' ? { releaseId: release!.id } : { runId: run!.id })
  } })
  const execute = async (kind: 'clock' | Scenario) => {
    setNotice('')
    try {
      await command.mutateAsync(kind)
      if (kind !== 'clock') setInjected((current) => [...current, kind])
      setNotice(kind === 'clock' ? `模擬時鐘已前進 ${ticks} 個 tick。` : `已設定單次 ${kind} 模擬故障；只影響目前操作。`)
      await refresh()
    } catch { /* Keep the transport error visible; commands are never automatically retried. */ }
  }
  const runActive = run && !['succeeded', 'failed', 'cancelled'].includes(run.state)
  const releaseActive = release && !['succeeded', 'failed', 'cancelled', 'rejected'].includes(release.state)
  const buildOpen = runActive && run.stages.some((stage) => stage.name === 'build' && ['queued', 'running'].includes(stage.state))
  return <section className="panel delivery-demo" aria-label="配送模擬控制"><div className="panel-title"><Clock3 size={18} aria-hidden="true" /><h2>模擬控制</h2><span className="tag">目前 tick {session.logicalClock}</span></div><p className="muted">時鐘由此手動推進；不會執行真實建置或部署。時鐘會推進這個示範 session 中所有已排程的作業。</p><div className="delivery-actions"><label>模擬前進幅度<select value={ticks} onChange={(event) => setTicks(Number(event.target.value))}><option value={1}>1 tick · 逐步查看</option><option value={3}>3 ticks</option><option value={6}>6 ticks · 完整發布</option></select></label><Button variant="outline" disabled={command.isPending} onClick={() => void execute('clock')}>{command.isPending ? '處理中…' : '前進模擬時鐘'}</Button></div>{canInject && <div className="delivery-actions">{buildOpen && <Button variant="outline" disabled={command.isPending || injected.includes('build-failure')} onClick={() => void execute('build-failure')}>模擬建置失敗</Button>}{runActive && <Button variant="outline" disabled={command.isPending || injected.includes('health-failure')} onClick={() => void execute('health-failure')}>模擬健康檢查失敗</Button>}{release?.kind === 'rollback' && releaseActive && <Button variant="outline" disabled={command.isPending || injected.includes('rollback-failure')} onClick={() => void execute('rollback-failure')}>模擬回滾失敗</Button>}</div>}{notice && <p className="command-notice" role="status"><CheckCircle2 size={16} aria-hidden="true" />{notice}</p>}{command.isError && <ErrorState error={command.error} title="模擬操作未完成" />}</section>
}
