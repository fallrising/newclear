import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import { PageHeading } from '../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import type { SessionView } from '../../domain/schemas'
import type { AlertRule, MonitorPolicy, MonitoringTarget, SLOPolicy } from '../../domain/monitoring-models'
import { ServiceNotice, useServiceCommand } from '../service-delivery'
import { MonitorForm, RuleForm, SloForm } from './forms'
import { ServiceNotificationWorkspace, OpsNotificationWorkspace } from './notification-workspace'
import { canApprove, canWrite, EvaluationEvidence, FormError, metricLabel, missing, MissingAlerting, PolicyAction, PolicyActions, PolicyHistory, ReasonField, status, targetLink, targetText, time } from './shared'
import './alerting.css'

const pageSize = 100
const scoped = (target: MonitoringTarget) => target.kind === 'service' ? { applicationId: target.applicationId, environmentId: target.environmentId, pageSize } : { ciId: target.ciId, pageSize }
const matches = (left: MonitoringTarget, right: MonitoringTarget) => left.kind === right.kind && (left.kind === 'service' && right.kind === 'service' ? left.applicationId === right.applicationId && left.environmentId === right.environmentId : left.kind === 'infrastructure' && right.kind === 'infrastructure' && left.ciId === right.ciId)
const showError = (error: unknown, refetch: () => void) => error ? <ErrorState error={error} onRetry={refetch} /> : null

function ServicePage({ kind, session }: { kind: 'monitoring' | 'alerts'; session: SessionView }) {
  const { appId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const environmentId = params.get('environmentId') ?? ''
  const app = useQuery({ queryKey: queryKey('application', appId), queryFn: () => api.getApplication(appId), enabled: Boolean(appId) })
  if (!appId || missing(app.error)) return <MissingAlerting />
  if (app.isPending) return <LoadingState label="正在確認服務與目前授權環境…" />
  if (app.isError) return <ErrorState error={app.error} onRetry={() => void app.refetch()} />
  const environment = app.data.environments.find(item => item.id === environmentId)
  if (environmentId && !environment) return <MissingAlerting back={`/rd/apps/${encodeURIComponent(appId)}`} />
  const target: MonitoringTarget | undefined = environment ? { kind: 'service', applicationId: appId, environmentId: environment.id } : undefined
  const changeEnvironment = (value: string) => { const next = new URLSearchParams(); if (value) next.set('environmentId', value); setParams(next) }
  const suffix = environmentId ? `?${new URLSearchParams({ environmentId })}` : ''
  return <div className="alert-page"><PageHeading eyebrow="RD · MONITORING · DEMO" title={`${app.data.application.name} · ${kind === 'monitoring' ? '監控設定' : '告警規則'}`} description="此工作區使用固定 Mock 來源與目前授權的服務環境；規則狀態、真實樣本時效及事件分開顯示。" action={<Button asChild variant="outline"><Link to={`/rd/apps/${encodeURIComponent(appId)}`}>服務詳情</Link></Button>} />
    <section className="panel alert-scope"><label>服務環境<select value={environmentId} onChange={event => changeEnvironment(event.target.value)}><option value="">選擇授權環境</option>{app.data.environments.map(item => <option key={item.id} value={item.id}>{item.name} · {item.stage}</option>)}</select></label>{environment && <p><code>{environment.id}</code> · {environment.stage} · v{environment.version}</p>}</section>
    <nav className="alert-tabs" aria-label="服務監控與告警"><Button asChild variant={kind === 'monitoring' ? 'default' : 'outline'}><Link to={`/rd/apps/${encodeURIComponent(appId)}/monitoring${suffix}`} aria-current={kind === 'monitoring' ? 'page' : undefined}>監控與 SLO</Link></Button><Button asChild variant={kind === 'alerts' ? 'default' : 'outline'}><Link to={`/rd/apps/${encodeURIComponent(appId)}/alerts${suffix}`} aria-current={kind === 'alerts' ? 'page' : undefined}>規則與通知</Link></Button><Button asChild variant="outline"><Link to={`/rd/observability?${new URLSearchParams({ applicationId: appId, environmentId })}`}>RED／Trace／Log</Link></Button></nav>
    {!target ? <section className="panel"><h2>先選擇服務環境</h2><p>只有目前授權的環境可用；未配置規則不等於監控健康。</p></section> : kind === 'monitoring' ? <ServiceMonitoring key={`${appId}:${environmentId}:${session.identityEpoch}`} target={target} session={session} projectId={app.data.application.projectId} stage={environment!.stage} /> : <ServiceAlerts key={`${appId}:${environmentId}:${session.identityEpoch}`} target={target} session={session} projectId={app.data.application.projectId} stage={environment!.stage} />}
  </div>
}
export function MonitoringPage({ session }: { session: SessionView }) { return <ServicePage kind="monitoring" session={session} /> }
export function ServiceAlertsPage({ session }: { session: SessionView }) { return <ServicePage kind="alerts" session={session} /> }

function ServiceMonitoring({ target, session, projectId, stage }: { target: MonitoringTarget; session: SessionView; projectId: string; stage: string }) {
  const query = scoped(target)
  const monitors = useQuery({ queryKey: queryKey('monitor-policies', null, query), queryFn: () => api.listMonitorPolicies(query) })
  return <><MonitorSection target={target} session={session} projectId={projectId} stage={stage} monitors={monitors.data?.items ?? []} loading={monitors.isPending} error={monitors.error} retry={() => void monitors.refetch()} />{monitors.data && <SloSection target={target} session={session} projectId={projectId} stage={stage} monitors={monitors.data.items} />}</>
}

function ServiceAlerts({ target, session, projectId, stage }: { target: MonitoringTarget; session: SessionView; projectId: string; stage: string }) {
  const query = scoped(target)
  const monitors = useQuery({ queryKey: queryKey('monitor-policies', null, query), queryFn: () => api.listMonitorPolicies(query) })
  return monitors.isPending ? <LoadingState label="正在讀取此環境監控設定…" /> : monitors.isError ? <ErrorState error={monitors.error} onRetry={() => void monitors.refetch()} /> : <>
    <RuleSection target={target} session={session} projectId={projectId} stage={stage} monitors={monitors.data.items} />
    {target.kind === 'service' && <ServiceNotificationWorkspace environmentId={target.environmentId} session={session} />}
  </>
}

function MonitorSection({ target, session, projectId, stage, poolId, monitors, loading, error, retry }: { target: MonitoringTarget; session: SessionView; projectId?: string; stage?: string; poolId?: string; monitors: MonitorPolicy[]; loading: boolean; error: unknown; retry: () => void }) {
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const [revising, setRevising] = useState(false)
  const selectedId = params.get('monitorId') ?? monitors[0]?.id
  const detail = useQuery({ queryKey: queryKey('monitor-policy', selectedId), queryFn: () => api.getMonitorPolicy(selectedId!), enabled: Boolean(selectedId) })
  const select = (id: string) => { const next = new URLSearchParams(params); next.set('monitorId', id); setParams(next); setCreating(false); setRevising(false) }
  const writer = canWrite(session, target, projectId, stage, poolId)
  return <><section className="panel"><div className="panel-title"><h2>監控設定</h2>{writer && <Button disabled={creating} onClick={() => { setCreating(true); setRevising(false) }}>新增監控設定</Button>}</div><p className="muted">此列表只含目前可見的服務環境或 CI。啟用採集設定並不代表已有新鮮樣本。</p>{loading ? <LoadingState label="正在讀取監控設定…" /> : error ? showError(error, retry) : monitors.length ? <label>檢視監控 revision<select value={selectedId ?? ''} onChange={event => select(event.target.value)}>{selectedId && !monitors.some(item => item.id === selectedId) && <option value={selectedId}>深連結 {selectedId}</option>}{monitors.map(item => <option key={item.id} value={item.id}>rev {item.revision} · {status(item)} · {item.id}</option>)}</select></label> : <ServiceNotice>目前沒有監控設定；健康狀態 unknown。</ServiceNotice>}</section>
    {creating ? <MonitorForm target={target} onDone={select} onCancel={() => setCreating(false)} /> : selectedId && detail.isPending ? <LoadingState label="正在讀取監控 revision…" /> : selectedId && (missing(detail.error) || detail.data && !matches(detail.data.spec.target, target)) ? <MissingAlerting /> : selectedId && detail.isError ? <ErrorState error={detail.error} onRetry={() => void detail.refetch()} /> : detail.data && revising ? <MonitorForm key={`${detail.data.id}:${detail.data.revision}`} target={target} original={detail.data} onDone={select} onCancel={() => setRevising(false)} /> : detail.data && <section className="panel"><h2>監控 revision {detail.data.revision}</h2><p><code>{detail.data.id}</code> · {status(detail.data)} · v{detail.data.version}</p><dl className="detail-list"><div><dt>固定來源</dt><dd>{detail.data.spec.source}</dd></div><div><dt>指標</dt><dd>{detail.data.spec.metrics.map(item => metricLabel[item]).join('、')}</dd></div><div><dt>採樣間隔／新鮮度</dt><dd>{detail.data.spec.sampleIntervalSeconds} 秒／{detail.data.spec.freshnessSeconds} 秒</dd></div><div><dt>設定</dt><dd>{detail.data.spec.enabled ? 'enabled' : 'disabled'} · 生效 rev {detail.data.activeRevision ?? '無'}</dd></div><div><dt>更新時間</dt><dd>{time(detail.data.updatedAt)}</dd></div></dl><PolicyActions kind="monitorPolicy" policy={detail.data} target={target} session={session} projectId={projectId} stage={stage} poolId={poolId} onRevise={() => setRevising(true)} /><PolicyHistory policy={detail.data} /></section>}
  </>
}

function SloSection({ target, session, projectId, stage, monitors }: { target: MonitoringTarget; session: SessionView; projectId: string; stage: string; monitors: MonitorPolicy[] }) {
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const [revising, setRevising] = useState(false)
  const query = scoped(target)
  const slos = useQuery({ queryKey: queryKey('slo-policies', null, query), queryFn: () => api.listSloPolicies(query) })
  const selectedId = params.get('sloId') ?? slos.data?.items[0]?.id
  const detail = useQuery({ queryKey: queryKey('slo-policy', selectedId), queryFn: () => api.getSloPolicy(selectedId!), enabled: Boolean(selectedId) })
  const select = (id: string) => { const next = new URLSearchParams(params); next.set('sloId', id); setParams(next); setCreating(false); setRevising(false) }
  const writer = canWrite(session, target, projectId, stage)
  const monitor = monitors.find(item => item.id === detail.data?.spec.monitorPolicyId)
  return <><section className="panel"><div className="panel-title"><h2>服務 SLO 目標</h2>{writer && <Button onClick={() => { setCreating(true); setRevising(false) }}>新增 SLO</Button>}</div>{slos.isPending ? <LoadingState label="正在讀取 SLO 目標…" /> : slos.isError ? <ErrorState error={slos.error} onRetry={() => void slos.refetch()} /> : slos.data.items.length ? <label>檢視 SLO<select value={selectedId ?? ''} onChange={event => select(event.target.value)}>{selectedId && !slos.data.items.some(item => item.id === selectedId) && <option value={selectedId}>深連結 {selectedId}</option>}{slos.data.items.map(item => <option key={item.id} value={item.id}>rev {item.revision} · {status(item)} · {item.id}</option>)}</select></label> : <p>尚未設定 SLO；此處不會計算出虛構達標率。</p>}</section>
    {creating ? <SloForm monitors={monitors} onDone={select} onCancel={() => setCreating(false)} /> : selectedId && detail.isPending ? <LoadingState label="正在讀取 SLO revision…" /> : selectedId && (missing(detail.error) || detail.data && (!monitor || !matches(monitor.spec.target, target))) ? <MissingAlerting /> : selectedId && detail.isError ? <ErrorState error={detail.error} onRetry={() => void detail.refetch()} /> : detail.data && revising ? <SloForm original={detail.data} monitors={monitors} onDone={select} onCancel={() => setRevising(false)} /> : detail.data && <section className="panel"><h2>SLO revision {detail.data.revision}</h2><p><code>{detail.data.id}</code> · {status(detail.data)} · 生效 rev {detail.data.activeRevision ?? '無'}</p><dl className="detail-list"><div><dt>監控設定</dt><dd><code>{detail.data.spec.monitorPolicyId}</code></dd></div><div><dt>指標／目標</dt><dd>{detail.data.spec.indicator} · {detail.data.spec.targetFraction} {detail.data.spec.unit}</dd></div><div><dt>窗口／延遲門檻</dt><dd>{detail.data.spec.windowSeconds} 秒 · {detail.data.spec.thresholdMs ?? '不適用'} ms</dd></div></dl><PolicyActions kind="sloPolicy" policy={detail.data} target={target} session={session} projectId={projectId} stage={stage} onRevise={() => setRevising(true)} /><PolicyHistory policy={detail.data} /></section>}
  </>
}

function RuleSection({ target, session, projectId, stage, poolId, monitors }: { target: MonitoringTarget; session: SessionView; projectId?: string; stage?: string; poolId?: string; monitors: MonitorPolicy[] }) {
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const [revising, setRevising] = useState(false)
  const query = scoped(target)
  const rules = useQuery({ queryKey: queryKey('alert-rules', null, query), queryFn: () => api.listAlertRules(query) })
  const selectedId = params.get('ruleId') ?? rules.data?.items[0]?.id
  const detail = useQuery({ queryKey: queryKey('alert-rule', selectedId), queryFn: () => api.getAlertRule(selectedId!), enabled: Boolean(selectedId) })
  const select = (id: string) => { const next = new URLSearchParams(params); next.set('ruleId', id); setParams(next); setCreating(false); setRevising(false) }
  const monitor = monitors.find(item => item.id === detail.data?.spec.monitorPolicyId)
  const writer = canWrite(session, target, projectId, stage, poolId)
  return <><section className="panel"><div className="panel-title"><h2>告警規則</h2>{writer && <Button onClick={() => { setCreating(true); setRevising(false) }}>新增告警規則</Button>}</div><p className="muted">規則引用同一份監控設定；新 revision 的評估與事件保留獨立 lineage。</p>{rules.isPending ? <LoadingState label="正在讀取告警規則…" /> : rules.isError ? <ErrorState error={rules.error} onRetry={() => void rules.refetch()} /> : rules.data.items.length ? <label>檢視告警規則<select value={selectedId ?? ''} onChange={event => select(event.target.value)}>{selectedId && !rules.data.items.some(item => item.id === selectedId) && <option value={selectedId}>深連結 {selectedId}</option>}{rules.data.items.map(item => <option key={item.id} value={item.id}>rev {item.revision} · {status(item)} · {item.id}</option>)}</select></label> : <ServiceNotice>尚無告警規則；沒有事件不代表已有健康樣本。</ServiceNotice>}</section>
    {creating ? <RuleForm monitors={monitors} onDone={select} onCancel={() => setCreating(false)} /> : selectedId && detail.isPending ? <LoadingState label="正在讀取告警規則 revision…" /> : selectedId && (missing(detail.error) || detail.data && (!monitor || !matches(monitor.spec.target, target))) ? <MissingAlerting /> : selectedId && detail.isError ? <ErrorState error={detail.error} onRetry={() => void detail.refetch()} /> : detail.data && revising ? <RuleForm original={detail.data} monitors={monitors} onDone={select} onCancel={() => setRevising(false)} /> : detail.data && <><RuleDetail rule={detail.data} monitor={monitor!} session={session} projectId={projectId} stage={stage} poolId={poolId} onRevise={() => setRevising(true)} /><RuleEvidence rule={detail.data} session={session} target={target} projectId={projectId} stage={stage} poolId={poolId} /></>}
  </>
}

function RuleDetail({ rule, monitor, session, projectId, stage, poolId, onRevise, readOnly = false }: { rule: AlertRule; monitor: MonitorPolicy; session: SessionView; projectId?: string; stage?: string; poolId?: string; onRevise?: () => void; readOnly?: boolean }) {
  const spec = readOnly && rule.activeRevision != null ? rule.revisions.find(item => item.revision === rule.activeRevision)?.spec ?? rule.spec : rule.spec
  return <section className="panel"><h2>{readOnly ? '生效規則' : '規則'} revision {readOnly ? rule.activeRevision ?? '無' : rule.revision}</h2><p><code>{rule.id}</code> · 目前設定 {status(rule)} · 最新 rev {rule.revision} · 生效 rev {rule.activeRevision ?? '無'}</p><dl className="detail-list"><div><dt>監控設定／目標</dt><dd><code>{spec.monitorPolicyId}</code> · {targetText(monitor.spec.target)}</dd></div><div><dt>指標／窗口</dt><dd>{metricLabel[spec.metric]} · {spec.aggregation} · {spec.windowSeconds} 秒</dd></div><div><dt>門檻</dt><dd>{spec.comparator} {spec.threshold} {spec.unit} · {spec.requiredConsecutiveSamples} 筆連續已知樣本</dd></div><div><dt>通知</dt><dd>{spec.channelRef} · {spec.enabled ? 'enabled' : 'disabled'} · {spec.severity}</dd></div><div><dt>最後更新</dt><dd>{time(rule.updatedAt)}</dd></div></dl>{!readOnly && onRevise && <PolicyActions kind="alertRule" policy={rule} target={monitor.spec.target} session={session} projectId={projectId} stage={stage} poolId={poolId} onRevise={onRevise} />}{readOnly && <Link to={monitor.spec.target.kind === 'infrastructure' ? `/ops/alerting?${new URLSearchParams({ tab: 'settings', ciId: monitor.spec.target.ciId, ruleId: rule.id })}` : targetLink(monitor.spec.target)}>前往有權限的設定頁</Link>}<PolicyHistory policy={rule} /></section>
}

function RuleEvidence({ rule, session, target, projectId, stage, poolId }: { rule: AlertRule; session: SessionView; target: MonitoringTarget; projectId?: string; stage?: string; poolId?: string }) {
  const filters = { ruleId: rule.id, pageSize }
  const evaluations = useQuery({ queryKey: queryKey('alert-evaluations', rule.id, filters), queryFn: () => api.listAlertEvaluations(filters) })
  const deliveries = useQuery({ queryKey: queryKey('notification-deliveries', rule.id, filters), queryFn: () => api.listNotificationDeliveries(filters) })
  const silences = useQuery({ queryKey: queryKey('silences', rule.id, filters), queryFn: () => api.listSilences(filters) })
  const dashboard = useQuery({ queryKey: queryKey('dashboard', session.centers[0]), queryFn: () => api.getDashboard(session.centers[0]) })
  const now = dashboard.data?.dataAsOf
  const writer = canWrite(session, target, projectId, stage, poolId)
  return <><section className="panel"><h2>固定樣本與模擬時鐘</h2><p className="muted">只推進示範樣本與 Mock 通知；不連線真 collector、真通道或外部工作系統。</p><p>目前設定 revision {rule.revision}；實際評估依生效 revision {rule.activeRevision ?? '無'}。歷史評估按各自的 rule revision 保留。</p>{now ? <p>目前模擬時間：{time(now)}</p> : dashboard.isError ? <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} /> : <LoadingState label="正在讀取模擬時間…" />}{writer && rule.activeRevision != null && <ScenarioControls ruleId={rule.id} />}{writer && rule.activeRevision != null && now && <SilenceForm ruleId={rule.id} now={now} />}</section>
    {evaluations.isError && <ErrorState error={evaluations.error} title="評估紀錄讀取失敗" onRetry={() => void evaluations.refetch()} />}{deliveries.isError && <ErrorState error={deliveries.error} title="通知紀錄讀取失敗" onRetry={() => void deliveries.refetch()} />}{silences.isError && <ErrorState error={silences.error} title="Silence 紀錄讀取失敗" onRetry={() => void silences.refetch()} />}{evaluations.isPending || deliveries.isPending || silences.isPending || !now ? <LoadingState label="正在讀取規則評估、Silence 與通知投遞…" /> : evaluations.data && deliveries.data && silences.data && <EvaluationEvidence evaluations={evaluations.data.items} deliveries={deliveries.data.items} silences={silences.data.items} now={now} />}</>
}

function ScenarioControls({ ruleId }: { ruleId: string }) {
  const [notice, setNotice] = useState('')
  const scenario = useServiceCommand(async () => { await Promise.all([api.listAlertEvaluations({ ruleId }), api.listNotificationDeliveries({ ruleId }), api.listIncidents({ page: 1, pageSize: 100 })]) }, ['alerting-command'])
  const advance = useServiceCommand(async () => { await Promise.all([api.listAlertEvaluations({ ruleId }), api.listNotificationDeliveries({ ruleId }), api.listIncidents({ page: 1, pageSize: 100 })]) }, ['alerting-command'])
  const select = async (key: 'alert-breach' | 'alert-recovery' | 'alert-unknown' | 'alert-delivery-failure') => { try { await scenario.mutateAsync(() => api.setScenario(key, { ruleId })); scenario.reset(); setNotice(`${key} 已產生固定樣本與評估；待處理通知可由模擬時鐘派送。`) } catch { /* Keep the committed receipt if readback failed. */ } }
  const tick = async () => { try { await advance.mutateAsync(() => api.advanceClock(60)); advance.reset(); setNotice('已推進 60 秒；請檢視通知投遞結果與 Silence 剩餘時間。') } catch { /* Keep the committed receipt if readback failed. */ } }
  return <div><div className="alert-actions"><Button variant="outline" disabled={scenario.isPending || advance.isPending} onClick={() => void select('alert-breach')}>模擬超過門檻</Button><Button variant="outline" disabled={scenario.isPending || advance.isPending} onClick={() => void select('alert-unknown')}>模擬未知樣本</Button><Button variant="outline" disabled={scenario.isPending || advance.isPending} onClick={() => void select('alert-recovery')}>模擬恢復樣本</Button><Button variant="outline" disabled={scenario.isPending || advance.isPending} onClick={() => void select('alert-delivery-failure')}>模擬下次投遞失敗</Button><Button disabled={scenario.isPending || advance.isPending} onClick={() => void tick()}>下一筆樣本 · 前進 60 秒</Button></div>{notice && <p role="status">{notice}</p>}{scenario.error && <FormError error={scenario.error} title="情境未設定" />}{advance.error && <FormError error={advance.error} title="模擬時間未完成" />}</div>
}

function SilenceForm({ ruleId, now }: { ruleId: string; now: string }) {
  const [reason, setReason] = useState('')
  const [duration, setDuration] = useState(1)
  const command = useServiceCommand(async receipt => { await api.getSilence(receipt.entityId) }, ['alerting-command'])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const startAt = now, expiresAt = new Date(Date.parse(now) + duration * 60000).toISOString()
    try { await command.mutateAsync(() => api.createSilence({ ruleId, startAt, expiresAt, reason: reason.trim() })); command.reset(); setReason('') } catch { /* Keep reason and expected clock until explicit retry. */ }
  }
  return <form className="alert-silence" onSubmit={event => void submit(event)}><h3>暫停 Mock 通知</h3><p className="muted">Silence 綁定此規則與精確環境／CI，最多 24 小時；事件和證據照常保留。</p><label>抑制分鐘<select value={duration} disabled={command.isPending || command.committed} onChange={event => setDuration(Number(event.target.value))}><option value={1}>1 分鐘 · 示範到期</option><option value={5}>5 分鐘</option><option value={30}>30 分鐘</option><option value={60}>1 小時</option><option value={360}>6 小時</option><option value={1440}>24 小時</option></select></label><ReasonField value={reason} onChange={setReason} />{command.error && <FormError error={command.error} title="Silence 未建立或讀回失敗" />}<Button type="submit" disabled={!reason.trim() || command.isPending}>{command.isPending ? '正在建立並讀回…' : command.committed ? '重新讀取 Silence' : '建立 Silence'}</Button></form>
}

export function OpsAlertingPage({ session }: { session: SessionView }) {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'runtime' ? 'runtime' : 'settings'
  const ciId = params.get('ciId') ?? ''
  const cis = useQuery({ queryKey: queryKey('cis', null, { pageSize }), queryFn: () => api.listCis({ pageSize }) })
  const ci = useQuery({ queryKey: queryKey('ci', ciId), queryFn: () => api.getCi(ciId), enabled: Boolean(ciId) })
  const target: MonitoringTarget | undefined = ci.data ? { kind: 'infrastructure', ciId: ci.data.id } : undefined
  const choose = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); if (key === 'ciId') { next.delete('monitorId'); next.delete('ruleId') } setParams(next) }
  return <div className="alert-page"><PageHeading eyebrow="OPS · ALERT CONTROL · DEMO" title="告警控制" description="分開管理物理 CI 規則與生產服務審批，並查看來源時間評估、事件、Silence 與 Mock 通知結果。" /><nav className="alert-tabs" aria-label="告警控制分頁"><Button variant={tab === 'settings' ? 'default' : 'outline'} onClick={() => choose('tab', 'settings')} aria-current={tab === 'settings' ? 'page' : undefined}>設定與審批</Button><Button variant={tab === 'runtime' ? 'default' : 'outline'} onClick={() => choose('tab', 'runtime')} aria-current={tab === 'runtime' ? 'page' : undefined}>運行與證據</Button><Button asChild variant="outline"><Link to="/ops/incidents">事件中心</Link></Button></nav>
    {tab === 'settings' ? <><PendingApprovals session={session} /><section className="panel alert-scope"><h2>物理 CI 規則</h2>{cis.isPending ? <LoadingState label="正在讀取可見 CI…" /> : cis.isError ? <ErrorState error={cis.error} onRetry={() => void cis.refetch()} /> : <label>選擇 CI<select value={ciId} onChange={event => choose('ciId', event.target.value)}><option value="">選擇可見物理 CI</option>{cis.data.items.map(item => <option key={item.id} value={item.id}>{item.name} · {item.poolId}</option>)}</select></label>}{missing(ci.error) && <MissingAlerting back="/ops/alerting" />}{ci.isError && !missing(ci.error) && <ErrorState error={ci.error} onRetry={() => void ci.refetch()} />}{ci.data && <p><Link to={`/ops/cmdb/${encodeURIComponent(ci.data.id)}`}>{ci.data.name}</Link> · pool <code>{ci.data.poolId}</code> · {ci.data.observedAt ? `最後 CI 觀測 ${time(ci.data.observedAt)}` : 'CI 觀測 unknown'}</p>}</section>{target && ci.data && <InfrastructureControls key={`${ciId}:${session.identityEpoch}`} target={target} session={session} poolId={ci.data.poolId} />}</> : <RuntimeOverview session={session} />}
  </div>
}

function InfrastructureControls({ target, session, poolId }: { target: MonitoringTarget; session: SessionView; poolId: string }) {
  const query = scoped(target)
  const monitors = useQuery({ queryKey: queryKey('monitor-policies', null, query), queryFn: () => api.listMonitorPolicies(query) })
  return <><MonitorSection target={target} session={session} poolId={poolId} monitors={monitors.data?.items ?? []} loading={monitors.isPending} error={monitors.error} retry={() => void monitors.refetch()} />{monitors.data && <RuleSection target={target} session={session} poolId={poolId} monitors={monitors.data.items} />}</>
}

function PendingApprovals({ session }: { session: SessionView }) {
  const query = { status: 'submitted' as const, pageSize }
  const monitors = useQuery({ queryKey: queryKey('monitor-policies', 'pending', query), queryFn: () => api.listMonitorPolicies(query) })
  const rules = useQuery({ queryKey: queryKey('alert-rules', 'pending', query), queryFn: () => api.listAlertRules(query) })
  const slos = useQuery({ queryKey: queryKey('slo-policies', 'pending', query), queryFn: () => api.listSloPolicies(query) })
  const visibleMonitors = useQuery({ queryKey: queryKey('monitor-policies', 'ops-visible', { pageSize }), queryFn: () => api.listMonitorPolicies({ pageSize }) })
  const pending: { kind: 'monitorPolicy' | 'alertRule' | 'sloPolicy'; policy: MonitorPolicy | AlertRule | SLOPolicy; target: MonitoringTarget }[] = []
  for (const policy of monitors.data?.items ?? []) pending.push({ kind: 'monitorPolicy', policy, target: policy.spec.target })
  for (const policy of rules.data?.items ?? []) { const monitor = visibleMonitors.data?.items.find(item => item.id === policy.spec.monitorPolicyId); if (monitor) pending.push({ kind: 'alertRule', policy, target: monitor.spec.target }) }
  for (const policy of slos.data?.items ?? []) { const monitor = visibleMonitors.data?.items.find(item => item.id === policy.spec.monitorPolicyId); if (monitor) pending.push({ kind: 'sloPolicy', policy, target: monitor.spec.target }) }
  return <section className="panel"><h2>待獨立審批的生產服務規則</h2><p className="muted">Ops 只能決策有 project／prod 授權、且不是自己提交的服務 revision；無權直接修改 RD 門檻。</p>{[monitors, rules, slos, visibleMonitors].some(item => item.isPending) ? <LoadingState label="正在讀取目前授權的待審規則…" /> : [monitors, rules, slos, visibleMonitors].some(item => item.isError) ? <ErrorState error={monitors.error || rules.error || slos.error || visibleMonitors.error} onRetry={() => { void monitors.refetch(); void rules.refetch(); void slos.refetch(); void visibleMonitors.refetch() }} /> : pending.length ? <div className="alert-records">{pending.filter(item => item.target.kind === 'service').map(item => <PendingItem key={`${item.kind}:${item.policy.id}`} {...item} session={session} />)}</div> : <p>目前沒有可見的待審規則。</p>}</section>
}

function PendingItem({ kind, policy, target, session }: { kind: 'monitorPolicy' | 'alertRule' | 'sloPolicy'; policy: MonitorPolicy | AlertRule | SLOPolicy; target: MonitoringTarget; session: SessionView }) {
  const app = useQuery({ queryKey: queryKey('application', target.kind === 'service' ? target.applicationId : ''), queryFn: () => api.getApplication(target.kind === 'service' ? target.applicationId : ''), enabled: target.kind === 'service' })
  if (target.kind !== 'service') return null
  if (app.isPending) return <LoadingState label="正在核對待審服務範圍…" />
  if (app.isError) return null
  const env = app.data.environments.find(item => item.id === target.environmentId)
  if (!env) return null
  const allowed = canApprove(session, policy, target, app.data.application.projectId, env.stage)
  return <article><h3>{kind === 'monitorPolicy' ? '監控設定' : kind === 'alertRule' ? '告警規則' : 'SLO 目標'} · rev {policy.revision}</h3><p><code>{policy.id}</code> · <Link to={targetLink(target)}>{targetText(target)}</Link> · {env.stage} · 提交者 {policy.requesterId}</p>{allowed ? <div className="alert-actions"><PolicyAction kind={kind} policy={policy} action="approve" /><PolicyAction kind={kind} policy={policy} action="reject" /></div> : <p className="muted">目前身分不能審批此 revision；需要不同的 Ops 審批人及 project／prod 授權。</p>}</article>
}

function RuntimeOverview({ session }: { session: SessionView }) {
  const [params, setParams] = useSearchParams()
  const rules = useQuery({ queryKey: queryKey('alert-rules', 'runtime', { pageSize }), queryFn: () => api.listAlertRules({ pageSize }) })
  const monitors = useQuery({ queryKey: queryKey('monitor-policies', 'runtime', { pageSize }), queryFn: () => api.listMonitorPolicies({ pageSize }) })
  const ruleId = params.get('ruleId') ?? rules.data?.items[0]?.id
  const rule = rules.data?.items.find(item => item.id === ruleId)
  const monitor = monitors.data?.items.find(item => item.id === rule?.spec.monitorPolicyId)
  const incidents = useQuery({ queryKey: queryKey('incidents', 'alert-runtime', { pageSize }), queryFn: () => api.listIncidents({ page: 1, pageSize }) })
  return <><section className="panel"><h2>規則運行狀態</h2><p className="muted">範圍僅含目前 Ops 可讀的規則；生效設定、樣本時效、事件與投遞各有獨立狀態。</p>{rules.isPending || monitors.isPending ? <LoadingState label="正在讀取可見規則…" /> : rules.isError || monitors.isError ? <ErrorState error={rules.error || monitors.error} onRetry={() => { void rules.refetch(); void monitors.refetch() }} /> : rules.data.items.length ? <label>檢視規則<select value={ruleId ?? ''} onChange={event => { const next = new URLSearchParams(params); next.set('ruleId', event.target.value); setParams(next) }}>{rules.data.items.map(item => <option value={item.id} key={item.id}>rev {item.revision} · {status(item)} · {item.id}</option>)}</select></label> : <ServiceNotice>目前沒有可見告警規則；這不表示環境健康。</ServiceNotice>}</section>{rule && monitor && <><RuleDetail rule={rule} monitor={monitor} session={session} readOnly /><RuleEvidence rule={rule} session={session} target={monitor.spec.target} /></>}
    <section className="panel"><h2>可見事件</h2>{incidents.isPending ? <LoadingState label="正在讀取事件中心…" /> : incidents.isError ? <ErrorState error={incidents.error} onRetry={() => void incidents.refetch()} /> : incidents.data.items.length ? <ul className="alert-records">{incidents.data.items.map(item => <li key={item.id}><Link to={`/ops/incidents/${encodeURIComponent(item.id)}`}>{item.id}</Link> · {item.state} · {item.severity} · {time(item.updatedAt)}</li>)}</ul> : <p>目前沒有可見事件；未必已有健康樣本。</p>}</section>
    <OpsNotificationWorkspace session={session} /></>
}
