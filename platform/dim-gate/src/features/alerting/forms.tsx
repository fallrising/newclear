import { useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import { Button } from '../../components/ui/button'
import type { CommandReceipt } from '../../domain/schemas'
import type { AlertRule, MonitorPolicy, MonitoringTarget, SLOPolicy } from '../../domain/monitoring-models'
import { ServiceNotice, useServiceCommand } from '../service-delivery'
import { FormError, ReasonField, SubmitForm, metricLabel } from './shared'

const serviceMetrics = ['rate', 'errorRate', 'p95Latency'] as const
const infrastructureMetrics = ['cpuUtilization', 'memoryUtilization'] as const
const unitFor = (metric: string) => metric === 'rate' ? 'requests/second' : metric === 'p95Latency' ? 'ms' : 'fraction'
const defaultThreshold = (metric: string) => metric === 'rate' ? 100 : metric === 'p95Latency' ? 500 : 0.05

export function MonitorForm({ target, original, onDone, onCancel }: { target: MonitoringTarget; original?: MonitorPolicy; onDone: (id: string) => void; onCancel: () => void }) {
  const [metrics, setMetrics] = useState<string[]>(original?.spec.metrics ?? (target.kind === 'service' ? [...serviceMetrics] : [...infrastructureMetrics]))
  const [interval, setInterval] = useState(original?.spec.sampleIntervalSeconds ?? 60)
  const [freshness, setFreshness] = useState(original?.spec.freshnessSeconds ?? 180)
  const [enabled, setEnabled] = useState(original?.spec.enabled ?? true)
  const [reason, setReason] = useState('')
  const command = useServiceCommand(async receipt => { await api.getMonitorPolicy(receipt.entityId) }, ['alerting-command'])
  const allowed = target.kind === 'service' ? serviceMetrics : infrastructureMetrics
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const spec: MonitorPolicy['spec'] = { target, source: target.kind === 'service' ? 'demo-red' : 'demo-ci', metrics: metrics as MonitorPolicy['spec']['metrics'], sampleIntervalSeconds: interval, freshnessSeconds: freshness, enabled }
    try {
      const receipt = await command.mutateAsync(() => original ? api.reviseMonitorPolicy(original.id, { expectedVersion: original.version, spec, reason: reason.trim() }) : api.createMonitorPolicy({ spec, reason: reason.trim() }))
      onDone(receipt.entityId)
    } catch { /* Preserve draft and API refusal. */ }
  }
  return <section className="panel"><h2>{original ? '建立監控設定新 revision' : '新增監控設定'}</h2><p className="muted">固定來源 {target.kind === 'service' ? 'demo-red' : 'demo-ci'}；樣本時效與設定狀態分開顯示。修改會建立新 revision，原生效版本仍留存。</p><SubmitForm onSubmit={event => void save(event)}><fieldset className="alert-wide"><legend>允許的指標</legend>{allowed.map(metric => <label className="alert-check" key={metric}><input type="checkbox" checked={metrics.includes(metric)} disabled={command.isPending || command.committed} onChange={event => setMetrics(current => event.target.checked ? [...current, metric] : current.filter(item => item !== metric))} />{metricLabel[metric]}</label>)}</fieldset><label>採樣間隔（秒）<input type="number" min={60} max={3600} step={60} value={interval} disabled={command.isPending || command.committed} onChange={event => setInterval(Number(event.target.value))} required /></label><label>新鮮度上限（秒）<input type="number" min={60} max={86400} step={60} value={freshness} disabled={command.isPending || command.committed} onChange={event => setFreshness(Number(event.target.value))} required /></label><label className="alert-check alert-wide"><input type="checkbox" checked={enabled} disabled={command.isPending || command.committed} onChange={event => setEnabled(event.target.checked)} />啟用採集設定</label><ReasonField value={reason} onChange={setReason} />{command.committed && command.isError && <ServiceNotice>操作已受理；只能重新讀取同一結果，不可修改或再次提交草稿。</ServiceNotice>}<FormError error={command.error} title={command.committed ? '監控設定讀回失敗' : '監控設定未儲存'} /><div className="alert-actions alert-wide"><Button variant="outline" type="button" disabled={command.isPending} onClick={onCancel}>返回</Button><Button type="submit" disabled={command.isPending || !reason.trim() || !metrics.length}>{command.isPending ? '正在提交並讀回…' : command.committed ? '重新讀取結果' : '儲存監控草稿'}</Button></div></SubmitForm></section>
}

export function RuleForm({ monitors, original, onDone, onCancel }: { monitors: MonitorPolicy[]; original?: AlertRule; onDone: (id: string) => void; onCancel: () => void }) {
  const eligible = monitors.filter(item => item.status === 'active' || item.activeRevision != null)
  const [monitorId, setMonitorId] = useState(original?.spec.monitorPolicyId ?? eligible[0]?.id ?? '')
  const monitor = eligible.find(item => item.id === monitorId)
  const [metric, setMetric] = useState(original?.spec.metric ?? monitor?.spec.metrics[0] ?? 'errorRate')
  const [aggregation, setAggregation] = useState<AlertRule['spec']['aggregation']>(original?.spec.aggregation ?? 'last')
  const [windowSeconds, setWindowSeconds] = useState(original?.spec.windowSeconds ?? 120)
  const [comparator, setComparator] = useState<AlertRule['spec']['comparator']>(original?.spec.comparator ?? 'gt')
  const [threshold, setThreshold] = useState(original?.spec.threshold ?? defaultThreshold(metric))
  const [samples, setSamples] = useState(original?.spec.requiredConsecutiveSamples ?? 2)
  const [severity, setSeverity] = useState<AlertRule['spec']['severity']>(original?.spec.severity ?? 'critical')
  const [channel, setChannel] = useState<AlertRule['spec']['channelRef']>(original?.spec.channelRef ?? (monitor?.spec.target.kind === 'infrastructure' ? 'demo-ops' : 'demo-rd'))
  const [enabled, setEnabled] = useState(original?.spec.enabled ?? true)
  const [reason, setReason] = useState('')
  const command = useServiceCommand(async receipt => { await api.getAlertRule(receipt.entityId) }, ['alerting-command'])
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!monitor) return
    const spec: AlertRule['spec'] = { monitorPolicyId: monitor.id, metric, aggregation, windowSeconds, comparator, threshold, unit: unitFor(metric) as AlertRule['spec']['unit'], requiredConsecutiveSamples: samples, severity, channelRef: channel, enabled }
    try {
      const receipt: CommandReceipt = await command.mutateAsync(() => original ? api.reviseAlertRule(original.id, { expectedVersion: original.version, spec, reason: reason.trim() }) : api.createAlertRule({ spec, reason: reason.trim() }))
      onDone(receipt.entityId)
    } catch { /* Preserve draft and refusal. */ }
  }
  return <section className="panel"><h2>{original ? '建立告警規則新 revision' : '新增告警規則'}</h2><p className="muted">只可引用目前可見且已生效的監控設定；通道為固定安全參照，不提供外部 URL。</p>{eligible.length ? <SubmitForm onSubmit={event => void save(event)}><label>監控設定<select value={monitorId} disabled={command.isPending || command.committed} onChange={event => { const next = eligible.find(item => item.id === event.target.value); setMonitorId(event.target.value); const nextMetric = next?.spec.metrics[0] ?? 'errorRate'; setMetric(nextMetric); setThreshold(defaultThreshold(nextMetric)); setChannel(next?.spec.target.kind === 'infrastructure' ? 'demo-ops' : 'demo-rd') }}>{eligible.map(item => <option value={item.id} key={item.id}>{item.id} · rev {item.activeRevision ?? item.revision}</option>)}</select></label><label>指標<select value={metric} disabled={command.isPending || command.committed} onChange={event => { setMetric(event.target.value as AlertRule['spec']['metric']); setThreshold(defaultThreshold(event.target.value)) }}>{monitor?.spec.metrics.map(item => <option key={item} value={item}>{metricLabel[item]}</option>)}</select></label><label>聚合<select value={aggregation} disabled={command.isPending || command.committed} onChange={event => setAggregation(event.target.value as typeof aggregation)}><option value="last">最後樣本</option><option value="avg">平均</option><option value="max">最大</option></select></label><label>評估窗口（秒）<input type="number" min={samples * 60} max={86400} step={60} value={windowSeconds} disabled={command.isPending || command.committed} onChange={event => setWindowSeconds(Number(event.target.value))} required /></label><label>比較<select value={comparator} disabled={command.isPending || command.committed} onChange={event => setComparator(event.target.value as typeof comparator)}><option value="gt">大於</option><option value="gte">大於等於</option><option value="lt">小於</option><option value="lte">小於等於</option></select></label><label>門檻（{unitFor(metric)}）<input type="number" min={0} step="any" value={threshold} disabled={command.isPending || command.committed} onChange={event => setThreshold(Number(event.target.value))} required /></label><label>連續已知樣本數<input type="number" min={1} max={10} value={samples} disabled={command.isPending || command.committed} onChange={event => setSamples(Number(event.target.value))} required /></label><p className="alert-wide muted">窗口至少為連續樣本數 × 60 秒；目前最低 {samples * 60} 秒。</p><label>嚴重程度<select value={severity} disabled={command.isPending || command.committed} onChange={event => setSeverity(event.target.value as typeof severity)}><option value="warning">warning</option><option value="critical">critical</option></select></label><label>固定 Mock 通道<select value={channel} disabled={command.isPending || command.committed} onChange={event => setChannel(event.target.value as typeof channel)}><option value="demo-rd">demo-rd</option><option value="demo-ops">demo-ops</option></select></label><label className="alert-check"><input type="checkbox" checked={enabled} disabled={command.isPending || command.committed} onChange={event => setEnabled(event.target.checked)} />啟用規則</label><ReasonField value={reason} onChange={setReason} />{command.committed && command.isError && <ServiceNotice>操作已受理；重新讀取同一結果，避免重複建立規則。</ServiceNotice>}<FormError error={command.error} title="規則儲存或讀回失敗" /><div className="alert-actions alert-wide"><Button variant="outline" type="button" disabled={command.isPending} onClick={onCancel}>返回</Button><Button type="submit" disabled={command.isPending || !reason.trim() || windowSeconds < samples * 60}>{command.isPending ? '正在提交並讀回…' : command.committed ? '重新讀取結果' : '儲存告警草稿'}</Button></div></SubmitForm> : <ServiceNotice>先啟用同範圍的監控設定，再建立告警規則。</ServiceNotice>}</section>
}

export function SloForm({ monitors, original, onDone, onCancel }: { monitors: MonitorPolicy[]; original?: SLOPolicy; onDone: (id: string) => void; onCancel: () => void }) {
  const eligible = monitors.filter(item => item.spec.target.kind === 'service' && (item.status === 'active' || item.activeRevision != null))
  const [monitorId, setMonitorId] = useState(original?.spec.monitorPolicyId ?? eligible[0]?.id ?? '')
  const [indicator, setIndicator] = useState<SLOPolicy['spec']['indicator']>(original?.spec.indicator ?? 'availability')
  const [targetFraction, setTargetFraction] = useState(original?.spec.targetFraction ?? 0.99)
  const [thresholdMs, setThresholdMs] = useState(original?.spec.thresholdMs ?? 500)
  const [windowSeconds, setWindowSeconds] = useState(original?.spec.windowSeconds ?? 3600)
  const [reason, setReason] = useState('')
  const command = useServiceCommand(async receipt => { await api.getSloPolicy(receipt.entityId) }, ['alerting-command'])
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const spec: SLOPolicy['spec'] = { monitorPolicyId: monitorId, indicator, targetFraction, windowSeconds, unit: indicator === 'availability' ? 'fraction' : 'ms', ...(indicator === 'latency' ? { thresholdMs } : {}) }
    try { const receipt = await command.mutateAsync(() => original ? api.reviseSloPolicy(original.id, { expectedVersion: original.version, spec, reason: reason.trim() }) : api.createSloPolicy({ spec, reason: reason.trim() })); onDone(receipt.entityId) } catch { /* Keep draft. */ }
  }
  return <section className="panel"><h2>{original ? '建立 SLO 新 revision' : '新增 SLO 目標'}</h2>{eligible.length ? <SubmitForm onSubmit={event => void save(event)}><label>服務監控設定<select value={monitorId} disabled={command.isPending || command.committed} onChange={event => setMonitorId(event.target.value)}>{eligible.map(item => <option key={item.id} value={item.id}>{item.id} · rev {item.activeRevision ?? item.revision}</option>)}</select></label><label>指標<select value={indicator} disabled={command.isPending || command.committed} onChange={event => setIndicator(event.target.value as typeof indicator)}><option value="availability">可用性</option><option value="latency">延遲</option></select></label><label>目標比例（0–1）<input type="number" min="0.001" max="1" step="0.001" value={targetFraction} disabled={command.isPending || command.committed} onChange={event => setTargetFraction(Number(event.target.value))} required /></label><label>窗口（秒）<input type="number" min="60" max="2592000" step="60" value={windowSeconds} disabled={command.isPending || command.committed} onChange={event => setWindowSeconds(Number(event.target.value))} required /></label>{indicator === 'latency' && <label>延遲門檻（ms）<input type="number" min="1" max="60000" step="1" value={thresholdMs} disabled={command.isPending || command.committed} onChange={event => setThresholdMs(Number(event.target.value))} required /></label>}<ReasonField value={reason} onChange={setReason} /><FormError error={command.error} title="SLO 儲存或讀回失敗" /><div className="alert-actions alert-wide"><Button type="button" variant="outline" onClick={onCancel} disabled={command.isPending}>返回</Button><Button type="submit" disabled={command.isPending || !reason.trim()}>{command.isPending ? '正在提交並讀回…' : command.committed ? '重新讀取結果' : '儲存 SLO 草稿'}</Button></div></SubmitForm> : <ServiceNotice>先啟用此服務環境的監控設定，再建立 SLO 目標。</ServiceNotice>}</section>
}
