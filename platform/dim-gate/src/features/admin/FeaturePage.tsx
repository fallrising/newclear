import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import { PageHeading } from '../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import type { FeatureSpec, PlatformFeature } from '../../domain/schemas'

const featureNames: Record<FeatureSpec['featureKey'], string> = {
  'rd.monitoring': 'RD 服務監控', 'ops.alerting': 'Ops 告警控制',
  'rd.delivery': 'RD 交付定義', 'rd.traffic': 'RD 流量政策',
}
const reasonNames: Record<string, string> = {
  'underlying-grant': '缺少原有角色動作', 'project-grant': '缺少專案授權',
  'default-available': '沿用既有功能', 'inactive-policy': '政策尚未啟用',
  'missing-active-revision': '缺少啟用版本', 'project-cohort': '不在專案範圍',
  'team-cohort': '不在團隊範圍', 'percentage-cohort': '不在灰度百分比',
  'active-cohort': '符合啟用條件',
}
const ids = (input: string) => [...new Set(input.split(',').map(value => value.trim()).filter(Boolean))]

function SpecEditor({ spec, onChange }: { spec: FeatureSpec; onChange: (next: FeatureSpec) => void }) {
  return <div className="catalog-spec-grid">
    <label>適用專案 ID（逗號分隔）<input value={spec.eligibleProjectIds.join(', ')} onChange={event => onChange({ ...spec, eligibleProjectIds: ids(event.target.value) })} /></label>
    <label>適用團隊 ID（逗號分隔）<input value={spec.eligibleTeamIds.join(', ')} onChange={event => onChange({ ...spec, eligibleTeamIds: ids(event.target.value) })} /></label>
    <label>灰度百分比<input type="number" min={0} max={100} step={1} value={spec.rolloutPercent} onChange={event => onChange({ ...spec, rolloutPercent: Number(event.target.value) })} /></label>
    <label>分桶 salt 版本<input type="number" min={1} step={1} value={spec.saltVersion} onChange={event => onChange({ ...spec, saltVersion: Number(event.target.value) })} /></label>
  </div>
}

function PolicyCard({ feature, committed }: { feature: PlatformFeature; committed: () => Promise<unknown> }) {
  const [spec, setSpec] = useState(feature.spec)
  const [reason, setReason] = useState('Review feature cohort')
  const [restoreRevision, setRestoreRevision] = useState(feature.revisions[0]!.revision)
  const preview = useQuery({ queryKey: queryKey('feature-preview', feature.id, feature.version), queryFn: () => api.previewPlatformFeature(feature.id) })
  const mutation = useMutation({ mutationFn: (action: 'revise' | 'validate' | 'activate' | 'disable' | 'restore') => {
    if (action === 'revise') return api.revisePlatformFeature(feature.id, feature.version, spec, reason)
    if (action === 'restore') return api.restorePlatformFeature(feature.id, feature.version, restoreRevision, reason)
    return api.platformFeatureAction(feature.id, action, feature.version, reason)
  } })
  const run = async (action: Parameters<typeof mutation.mutateAsync>[0]) => {
    try { await mutation.mutateAsync(action); await committed() } catch { /* Render the exact refusal below. */ }
  }
  const active = feature.revisions.find(row => row.revision === feature.activeRevision)
  return <article className="panel" aria-label={featureNames[feature.spec.featureKey]}>
    <div className="panel-title"><h2>{featureNames[feature.spec.featureKey]}</h2><span className="tag">{feature.status} · draft r{feature.revision} · active {feature.activeRevision ? `r${feature.activeRevision}` : '無'}</span></div>
    <p><code>{feature.spec.featureKey}</code> · <code>{feature.id}</code></p>
    <p className="muted">原有授權仍須成立；此政策只縮小可使用範圍。百分比依使用者、功能及 salt 穩定分桶。</p>
    {active && active.revision !== feature.revision && <section><h3>草稿與目前啟用版本</h3><dl className="detail-list">
      <div><dt>灰度百分比</dt><dd>{active.spec.rolloutPercent}% → {feature.spec.rolloutPercent}%</dd></div>
      <div><dt>分桶 salt 版本</dt><dd>{active.spec.saltVersion} → {feature.spec.saltVersion}</dd></div>
      <div><dt>適用專案</dt><dd>{active.spec.eligibleProjectIds.join(', ') || '全部'} → {feature.spec.eligibleProjectIds.join(', ') || '全部'}</dd></div>
      <div><dt>適用團隊</dt><dd>{active.spec.eligibleTeamIds.join(', ') || '全部'} → {feature.spec.eligibleTeamIds.join(', ') || '全部'}</dd></div>
    </dl></section>}
    <SpecEditor spec={spec} onChange={setSpec} />
    <label>變更理由<input required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
    <div className="request-actions">
      {feature.status !== 'draft' && <Button variant="outline" disabled={mutation.isPending || !reason.trim()} onClick={() => void run('revise')}>建立新版草稿</Button>}
      {feature.status === 'draft' && <Button disabled={mutation.isPending || !reason.trim()} onClick={() => void run('validate')}>驗證草稿</Button>}
      {feature.status === 'validated' && <Button disabled={mutation.isPending || !reason.trim()} onClick={() => void run('activate')}>啟用灰度</Button>}
      {feature.activeRevision !== null && feature.status !== 'disabled' && <Button variant="destructive" disabled={mutation.isPending || !reason.trim()} onClick={() => void run('disable')}>停用新指令</Button>}
    </div>
    {feature.status !== 'draft' && <div className="request-actions"><label>從舊版本建立新草稿<select aria-label={`${feature.id} 復原版本`} value={restoreRevision} onChange={event => setRestoreRevision(Number(event.target.value))}>
      {feature.revisions.map(row => <option key={row.revision} value={row.revision}>r{row.revision} · {row.reason}</option>)}</select></label>
      <Button variant="outline" disabled={mutation.isPending || !reason.trim()} onClick={() => void run('restore')}>復原為新版</Button></div>}
    <section><h3>不可變版本紀錄</h3><ul>{feature.revisions.map(row => <li key={row.revision}>r{row.revision} · {row.spec.rolloutPercent}% · salt {row.spec.saltVersion} · {row.reason}</li>)}</ul></section>
    <section><h3>目前啟用資格預覽</h3>{preview.isPending ? <LoadingState label="正在計算資格…" /> : preview.isError ? <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
      : <div className="table-scroll" tabIndex={0} role="region" aria-label="Demo 身分灰度資格預覽"><table><caption>policy v{preview.data.policyVersion}；只列出固定 Demo 身分</caption><thead><tr><th>使用者</th><th>結果</th><th>理由</th></tr></thead><tbody>
        {preview.data.items.map(item => <tr key={item.userId}><th scope="row"><code>{item.userId}</code></th><td>{item.eligible ? '可使用' : '不可使用'}</td><td>{reasonNames[item.reason]}</td></tr>)}
      </tbody></table></div>}</section>
    <Button asChild variant="outline"><Link to={`/admin/audit?entityType=platformFeature&entityId=${encodeURIComponent(feature.id)}`}>查看稽核</Link></Button>
    {mutation.isError && <ErrorState error={mutation.error} title="功能政策未更新" />}
  </article>
}

export function FeaturePage() {
  const [page, setPage] = useState(1)
  const policies = useQuery({ queryKey: queryKey('platform-features', null, page), queryFn: () => api.listPlatformFeatures(page, 25) })
  const registry = useQuery({ queryKey: queryKey('capability-registry'), queryFn: () => api.getCapabilityRegistry() })
  const [featureKey, setFeatureKey] = useState<FeatureSpec['featureKey']>('rd.monitoring')
  const [spec, setSpec] = useState<FeatureSpec>({ featureKey: 'rd.monitoring', targetCenter: 'rd', eligibleProjectIds: [], eligibleTeamIds: [], rolloutPercent: 100, saltVersion: 1 })
  const [reason, setReason] = useState('Create Demo feature cohort')
  const create = useMutation({ mutationFn: () => api.createPlatformFeature(spec, reason) })
  const submit = async (event: FormEvent) => { event.preventDefault(); try { await create.mutateAsync(); await policies.refetch() } catch { /* Render refusal below. */ } }
  if (policies.isPending || registry.isPending) return <LoadingState label="正在讀取功能治理…" />
  if (policies.isError) return <ErrorState error={policies.error} onRetry={() => void policies.refetch()} />
  if (registry.isError) return <ErrorState error={registry.error} onRetry={() => void registry.refetch()} />
  const choices = registry.data.filter(item => !policies.data.items.some(row => row.spec.featureKey === item.featureKey))
  return <><PageHeading eyebrow="ADMIN · MOCK FEATURE GOVERNANCE" title="功能灰度" description="只管理程式碼已註冊的 Demo 功能。草稿及驗證不改變目前資格；啟用與停用會重新檢查當前角色授權及 cohort。" />
    <form className="panel admin-form" onSubmit={event => void submit(event)}><div className="panel-title"><h2>建立功能政策</h2></div>
      <label>功能<select value={featureKey} onChange={event => { const next = registry.data.find(row => row.featureKey === event.target.value)!; setFeatureKey(next.featureKey); setSpec({ ...spec, featureKey: next.featureKey, targetCenter: next.center }) }}>
        {registry.data.map(item => <option key={item.featureKey} value={item.featureKey}>{featureNames[item.featureKey]}</option>)}
      </select></label><p>目前選擇：<code>{featureKey}</code></p><SpecEditor spec={spec} onChange={setSpec} />
      <label>建立理由<input required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <div className="form-actions span-all"><Button type="submit" disabled={create.isPending || !reason.trim() || choices.length === 0 || !choices.some(item => item.featureKey === featureKey)}>建立草稿</Button></div>
    </form>
    {create.isError && <ErrorState error={create.error} title="功能政策未建立" />}
    {choices.length === 0 && <p className="muted">所有已註冊功能均已有政策。</p>}
    {policies.data.items.map(feature => <PolicyCard key={`${feature.id}:${feature.version}`} feature={feature} committed={() => policies.refetch()} />)}
    <div className="request-actions"><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>上一頁</Button><span>第 {page} 頁，共 {policies.data.total} 筆</span>
      <Button variant="outline" disabled={page * 25 >= policies.data.total} onClick={() => setPage(page + 1)}>下一頁</Button></div>
  </>
}
