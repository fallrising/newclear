import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { ErrorState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import type { CommandReceipt, SessionView } from '../../domain/schemas'
import type { AlertEvaluation, AlertRule, MonitorPolicy, MonitoringTarget, NotificationDelivery, Silence, SLOPolicy } from '../../domain/monitoring-models'
import { sessionFeatureAvailable } from '../../domain/feature-policy'
import { ServiceConfirmation, ServiceNotice, ServiceTable, useServiceCommand } from '../service-delivery'

export type Policy = MonitorPolicy | AlertRule | SLOPolicy
export type PolicyKind = 'monitorPolicy' | 'alertRule' | 'sloPolicy'
export const label: Record<PolicyKind, string> = { monitorPolicy: '監控設定', alertRule: '告警規則', sloPolicy: 'SLO 目標' }
export const metricLabel: Record<string, string> = { rate: '請求率', errorRate: '錯誤率', p95Latency: 'p95 延遲', cpuUtilization: 'CPU 使用率', memoryUtilization: '記憶體使用率' }
const statusLabel: Record<Policy['status'], string> = { draft: '草稿', validated: '已驗證', submitted: '待獨立審批', approved: '已核准待啟用', rejected: '已拒絕', active: '已生效' }
export function time(value?: string | null) { return value ? new Date(value).toLocaleString('zh-TW', { timeZone: 'UTC', hour12: false }) + ' UTC' : '尚無樣本' }
export function missing(error: unknown) { return !!error && typeof error === 'object' && 'status' in error && error.status === 404 }
export function MissingAlerting({ back = '/rd/apps' }: { back?: string }) { return <section className="access-state" role="status"><p className="eyebrow">404 · 找不到資料</p><h1>找不到此監控範圍</h1><p>資料可能不存在，或不在目前身分可讀的授權範圍。</p><Button asChild variant="outline"><Link to={back}>返回清單</Link></Button></section> }

export function canWrite(session: SessionView, target: MonitoringTarget, projectId?: string, stage?: string, poolId?: string) {
  const featureKey = target.kind === 'service' ? 'rd.monitoring' : 'ops.alerting'
  if (!sessionFeatureAvailable(session, featureKey, target.kind === 'service' ? projectId : undefined)) return false
  if (target.kind === 'service') return session.assignments.some(grant => grant.role === 'rd' && grant.scopeType === 'project' && grant.scopeId === projectId && (!grant.stages || Boolean(stage && grant.stages.includes(stage as 'dev' | 'staging' | 'prod'))))
  return session.assignments.some(grant => grant.role === 'ops' && grant.scopeType === 'pool' && grant.scopeId === poolId)
}
export function canApprove(session: SessionView, policy: Policy, target: MonitoringTarget, projectId?: string, stage?: string) {
  return target.kind === 'service' && stage === 'prod' && policy.requesterId !== session.user.id && session.assignments.some(grant => grant.role === 'ops' && grant.scopeType === 'project' && grant.scopeId === projectId && (!grant.stages || grant.stages.includes('prod')))
}
export function status(policy: Policy) { return statusLabel[policy.status] }
export function targetLink(target: MonitoringTarget) { return target.kind === 'service' ? `/rd/apps/${encodeURIComponent(target.applicationId)}/alerts?environmentId=${encodeURIComponent(target.environmentId)}` : `/ops/cmdb/${encodeURIComponent(target.ciId)}` }
export function targetText(target: MonitoringTarget) { return target.kind === 'service' ? `${target.applicationId} · ${target.environmentId}` : `CI ${target.ciId}` }

export function PolicyHistory({ policy }: { policy: Policy }) { return <details className="alert-history"><summary>版本與決策歷史 · {policy.revisions.length} 版</summary><ol>{policy.revisions.map(revision => <li key={revision.revision}><strong>revision {revision.revision}</strong> · {revision.revision === policy.activeRevision ? '目前生效' : '非目前生效'}{revision.submittedAt && <> · 提交 {time(revision.submittedAt)}</>}{revision.decision && <p>決策：{revision.decision.decision === 'approved' ? '核准' : '拒絕'} · {revision.decision.actorId} · {time(revision.decision.occurredAt)} · {revision.decision.reason}</p>}<pre>{JSON.stringify(revision.spec, null, 2)}</pre></li>)}</ol></details> }

type Action = 'validate' | 'submit' | 'approve' | 'reject' | 'activate'
const actionLabel: Record<Action, string> = { validate: '驗證草稿', submit: '提交規則', approve: '核准規則', reject: '拒絕規則', activate: '啟用規則' }
function perform(kind: PolicyKind, policy: Policy, action: Action, reason: string) {
  const input = { expectedVersion: policy.version, reason }
  if (kind === 'monitorPolicy') return api.monitorPolicyAction(policy.id, action, input)
  if (kind === 'alertRule') return api.alertRuleAction(policy.id, action, input)
  return api.sloPolicyAction(policy.id, action, input)
}
export function PolicyAction({ kind, policy, action, onDone }: { kind: PolicyKind; policy: Policy; action: Action; onDone?: () => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const readBack = async (receipt: CommandReceipt) => {
    if (kind === 'monitorPolicy') await api.getMonitorPolicy(receipt.entityId)
    else if (kind === 'alertRule') await api.getAlertRule(receipt.entityId)
    else await api.getSloPolicy(receipt.entityId)
  }
  const command = useServiceCommand(readBack, ['alerting-command'])
  const confirm = async () => { try { await command.mutateAsync(() => perform(kind, policy, action, reason.trim())); setOpen(false); onDone?.() } catch { /* The reviewed version and reason remain available. */ } }
  return <><Button ref={trigger} variant="outline" disabled={command.isPending} onClick={() => { command.reset(); setReason(''); setOpen(true) }}>{actionLabel[action]}</Button>{open && <ServiceConfirmation title={actionLabel[action]} description={`此 Mock 操作會對 ${label[kind]} revision ${policy.revision} 重新確認版本與目前授權；不會向外部投遞。`} open={open} pending={command.isPending} committed={command.committed} reason={reason} onReason={setReason} error={command.error} onClose={() => setOpen(false)} onConfirm={() => void confirm()} trigger={trigger}><p><code>{policy.id}</code> · revision {policy.revision} · 目前 {status(policy)}</p><p>檢閱版本 v{policy.version}；正式環境必須由另一位 Ops 批准。</p></ServiceConfirmation>}</>
}
export function PolicyActions({ kind, policy, target, session, projectId, stage, poolId, onRevise }: { kind: PolicyKind; policy: Policy; target: MonitoringTarget; session: SessionView; projectId?: string; stage?: string; poolId?: string; onRevise: () => void }) {
  const writer = canWrite(session, target, projectId, stage, poolId)
  const approver = canApprove(session, policy, target, projectId, stage)
  const actions: Action[] = policy.status === 'draft' ? ['validate'] : policy.status === 'validated' ? ['submit'] : policy.status === 'approved' ? ['activate'] : []
  return <div className="alert-actions">{writer && actions.map(action => <PolicyAction key={action} kind={kind} policy={policy} action={action} />)}{writer && <Button variant="outline" onClick={onRevise}>建立下一版草稿</Button>}{approver && policy.status === 'submitted' && <><PolicyAction kind={kind} policy={policy} action="approve" /><PolicyAction kind={kind} policy={policy} action="reject" /></>}{policy.status === 'submitted' && !approver && <p className="muted">等待另一位具有此專案與 prod 階段授權的 Ops 決策。</p>}</div>
}

export function EvaluationEvidence({ evaluations, deliveries, silences, now }: { evaluations: AlertEvaluation[]; deliveries: NotificationDelivery[]; silences: Silence[]; now: string }) {
  const active = silences.filter(item => Date.parse(item.startAt) <= Date.parse(now) && Date.parse(item.expiresAt) > Date.parse(now))
  return <div className="alert-evidence"><section className="panel"><h2>評估與事件證據</h2><p className="muted">依來源樣本時間與規則 revision 判定；未知、缺漏、過期樣本不代表健康。</p>{evaluations.length ? <ServiceTable label="規則評估"><table><caption>最近規則評估</caption><thead><tr><th scope="col">規則／revision</th><th scope="col">來源時間</th><th scope="col">樣本／時效</th><th scope="col">判定／連續</th><th scope="col">事件</th></tr></thead><tbody>{evaluations.map(item => <tr key={item.id}><th scope="row"><code>{item.ruleId}</code><small>rev {item.ruleRevision}</small></th><td>{time(item.sourceTime)}</td><td>{item.value ?? 'unknown'} · {item.freshness}</td><td>{item.breached == null ? 'unknown' : item.breached ? '超過門檻' : '未超過門檻'} · {item.consecutive}</td><td>{item.incidentId ? <Link to={`/ops/incidents/${encodeURIComponent(item.incidentId)}`}>事件 {item.incidentId}</Link> : '尚無事件'}</td></tr>)}</tbody></table></ServiceTable> : <ServiceNotice>尚無評估樣本，健康狀態 unknown；啟用規則不會補造觀測。</ServiceNotice>}</section>
    <section className="panel"><h2>Silence 與通知投遞</h2><p className="muted">Silence 只抑制通知，不關閉事件或刪除樣本；所有投遞均為 Mock。</p>{silences.length ? <ul className="alert-records">{silences.map(item => <li key={item.id}><strong>{active.includes(item) ? `抑制中 · 剩餘 ${Math.ceil((Date.parse(item.expiresAt) - Date.parse(now)) / 60000)} 分鐘` : '已到期'}</strong> · rule rev {item.ruleRevision} · {item.reason}<small>{time(item.startAt)} → {time(item.expiresAt)} · {item.actorId}</small></li>)}</ul> : <p>目前沒有 Silence。</p>}{deliveries.length ? <ServiceTable label="Mock 通知投遞"><table><caption>可查 Mock 通知投遞</caption><thead><tr><th scope="col">規則／revision</th><th scope="col">狀態</th><th scope="col">通道／時間</th><th scope="col">事件證據</th></tr></thead><tbody>{deliveries.map(item => <tr key={item.id}><th scope="row"><code>{item.ruleId}</code><small>rev {item.ruleRevision}</small></th><td>{({ queued: '已建立', suppressed: '已抑制', delivered: '模擬投遞成功', failed: '模擬投遞失敗' } as const)[item.status]}{item.safeFailureCode && <small>{item.safeFailureCode}</small>}</td><td>{item.channelRef}<small>{time(item.occurredAt)}</small></td><td><Link to={`/ops/incidents/${encodeURIComponent(item.incidentId)}`}>{item.incidentId}</Link></td></tr>)}</tbody></table></ServiceTable> : <p>尚無通知投遞紀錄；規則啟用不代表已投遞。</p>}</section></div>
}

export function FormError({ error, title }: { error: unknown; title: string }) { return error ? <ErrorState error={error} title={title} /> : null }
export function ReasonField({ value, onChange }: { value: string; onChange: (value: string) => void }) { return <label className="alert-wide">變更理由<textarea value={value} onChange={event => onChange(event.target.value)} required minLength={1} maxLength={500} rows={3} /></label> }
export function SubmitForm({ children, onSubmit }: { children: ReactNode; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <form className="alert-form" onSubmit={onSubmit}>{children}</form> }
