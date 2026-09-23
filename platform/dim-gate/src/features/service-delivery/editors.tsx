import { useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { ErrorState } from '../../components/shared/states'
import type { CreatePipelineDefinitionInput, CreateServiceConfigInput, CreateTrafficPolicyInput, DeliveryOptions, PipelineDefinition, ServiceConfig, TrafficPolicy } from '../../domain/schemas'
import { ServiceNotice } from './ui'

type FormState = { pending: boolean; committed: boolean; error: unknown }
function FormFeedback({ pending, committed, error }: FormState) {
  const fields = typeof error === 'object' && error !== null && 'fieldErrors' in error ? error.fieldErrors as Record<string, string[]> | undefined : undefined
  return <div className="service-span-all">{committed && error != null && <ServiceNotice>草稿已受理，結果讀回尚未完成。再次確認只會重新讀取，不會建立另一個版本。</ServiceNotice>}{error != null && <ErrorState error={error} title={committed ? '結果尚未讀回' : '草稿尚未儲存'} />}{fields && <ul aria-label="欄位錯誤">{Object.entries(fields).map(([field, messages]) => <li key={field}><code>{field}</code>：{messages.join('；')}</li>)}</ul>}<div className="service-actions"><Button type="submit" disabled={pending}>{pending ? '正在儲存並讀回…' : committed ? '重新讀取草稿' : '儲存版本草稿'}</Button></div></div>
}

export function DefinitionEditor({ options, source, onSave, ...state }: FormState & { options: DeliveryOptions; source?: PipelineDefinition; onSave: (input: CreatePipelineDefinitionInput) => void }) {
  const [name, setName] = useState(source?.name ?? `${options.application.name} 交付定義`)
  const [reason, setReason] = useState(source?.reason ?? '')
  const [spec, setSpec] = useState<PipelineDefinition['spec']>(source?.spec ?? {
    repositoryRef: options.repositories[0]?.id ?? '', refPattern: 'main', recipeRef: 'demo-web-v1',
    artifactRepositoryRef: options.artifactRepositories[0]?.id ?? '', approvalPolicyRef: 'independent-ops-prod-v1', targetEnvironmentIds: [options.environment.id],
  })
  const disabled = state.pending || state.committed
  const save = (event: FormEvent) => { event.preventDefault(); onSave({ applicationId: options.application.id, name: name.trim(), reason: reason.trim(), spec }) }
  return <form className="panel service-form" aria-label="交付定義編輯器" onSubmit={save}>
    <h2 className="service-span-all">{source ? '編輯定義草稿' : '新增交付定義'}</h2>
    <label>定義名稱<input required maxLength={120} disabled={disabled} value={name} onChange={event => setName(event.target.value)} /></label>
    <label>原始碼倉庫<select required disabled={disabled} value={spec.repositoryRef} onChange={event => setSpec({ ...spec, repositoryRef: event.target.value })}>{options.repositories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <label>允許的來源分支<select required disabled={disabled} value={spec.refPattern} onChange={event => setSpec({ ...spec, refPattern: event.target.value as PipelineDefinition['spec']['refPattern'] })}>{options.refPatterns.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
    <label>建置配方<select required disabled={disabled} value={spec.recipeRef} onChange={event => setSpec({ ...spec, recipeRef: event.target.value as 'demo-web-v1' })}>{options.recipes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <label>產物倉庫<select required disabled={disabled} value={spec.artifactRepositoryRef} onChange={event => setSpec({ ...spec, artifactRepositoryRef: event.target.value })}>{options.artifactRepositories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <label>正式環境審批政策<select required disabled={disabled} value={spec.approvalPolicyRef} onChange={event => setSpec({ ...spec, approvalPolicyRef: event.target.value as 'independent-ops-prod-v1' })}>{options.approvalPolicies.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <fieldset className="service-span-all" disabled={disabled}><legend>可交付目標環境</legend>{options.environments.map(environment => <label className="service-checkbox" key={environment.id}><input type="checkbox" checked={spec.targetEnvironmentIds.includes(environment.id)} onChange={event => setSpec({ ...spec, targetEnvironmentIds: event.target.checked ? [...spec.targetEnvironmentIds, environment.id] : spec.targetEnvironmentIds.filter(id => id !== environment.id) })} />{environment.name} · {environment.stage} · {environment.status}</label>)}{spec.targetEnvironmentIds.length === 0 && <p role="status">請至少選擇一個目標環境。</p>}</fieldset>
    <label className="service-span-all">變更理由<textarea required maxLength={500} rows={3} disabled={disabled} value={reason} onChange={event => setReason(event.target.value)} /></label>
    <p className="muted service-span-all">儲存與驗證不會觸發建置。啟用後可明確選擇環境及來源版本執行；正式環境的定義啟用及業務發布各自需要獨立核准。</p>
    <FormFeedback {...state} />
  </form>
}

type Entry = ServiceConfig['spec']['entries'][number]
export function ConfigurationEditor({ options, source, onSave, ...state }: FormState & { options: DeliveryOptions; source?: ServiceConfig; onSave: (input: CreateServiceConfigInput) => void }) {
  const [entries, setEntries] = useState<Entry[]>(source?.spec.entries ?? [])
  const [reason, setReason] = useState(source?.reason ?? '')
  const disabled = state.pending || state.committed
  const update = (index: number, change: (entry: Entry) => Entry) => setEntries(current => current.map((entry, position) => position === index ? change(entry) : entry))
  const changeType = (index: number, valueType: Entry['valueType']) => update(index, entry => {
    const common = { key: entry.key, description: entry.description }
    if (valueType === 'number') return { ...common, valueType, value: 0 }
    if (valueType === 'boolean') return { ...common, valueType, value: false }
    if (valueType === 'secretRef') return { ...common, valueType, value: options.secretRefs[0]?.id ?? '' }
    return { ...common, valueType, value: '' }
  })
  return <form className="panel service-form" aria-label="服務配置編輯器" onSubmit={event => { event.preventDefault(); onSave({ applicationId: options.application.id, environmentId: options.environment.id, environmentVersion: options.environment.version, reason: reason.trim(), spec: { entries } }) }}>
    <h2 className="service-span-all">{source ? '編輯配置草稿' : '新增配置版本'}</h2>
    <p className="service-span-all muted">每個設定保留名稱、型別與說明。一般值只放非秘密內容；秘密設定僅能選擇已登記的虛構 reference。</p>
    <div className="service-span-all">{entries.length === 0 && <ServiceNotice>此草稿沒有設定項目。空設定不代表環境已有生效配置。</ServiceNotice>}{entries.map((entry, index) => <fieldset className="service-entry" key={index} disabled={disabled}><legend>設定項目 {index + 1}</legend><div className="service-entry-header"><strong>{entry.key || '尚未命名'}</strong><Button type="button" variant="outline" size="sm" onClick={() => setEntries(current => current.filter((_, position) => position !== index))}><Trash2 size={16} aria-hidden="true" />移除項目 {index + 1}</Button></div><div className="service-entry-fields">
      <label>設定名稱 {index + 1}<input required maxLength={64} pattern="[A-Z][A-Z0-9_]{0,63}" value={entry.key} onChange={event => update(index, item => ({ ...item, key: event.target.value }))} placeholder="例如 LOG_LEVEL" /></label>
      <label>值型別 {index + 1}<select value={entry.valueType} onChange={event => changeType(index, event.target.value as Entry['valueType'])}><option value="string">字串</option><option value="number">數字</option><option value="boolean">布林值</option><option value="secretRef" disabled={options.secretRefs.length === 0}>秘密 reference</option></select></label>
      <label>設定值 {index + 1}{entry.valueType === 'boolean' ? <select value={String(entry.value)} onChange={event => update(index, item => ({ key: item.key, description: item.description, valueType: 'boolean', value: event.target.value === 'true' }))}><option value="false">false</option><option value="true">true</option></select> : entry.valueType === 'secretRef' ? <select required value={entry.value} onChange={event => update(index, item => ({ key: item.key, description: item.description, valueType: 'secretRef', value: event.target.value }))}>{options.secretRefs.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : entry.valueType === 'number' ? <input required type="number" min={-1_000_000} max={1_000_000} step="any" value={entry.value} onChange={event => update(index, item => ({ key: item.key, description: item.description, valueType: 'number', value: Number(event.target.value) }))} /> : <input maxLength={256} value={entry.value} onChange={event => update(index, item => ({ key: item.key, description: item.description, valueType: 'string', value: event.target.value }))} />}</label>
      <label>設定說明 {index + 1}<input maxLength={160} value={entry.description} onChange={event => update(index, item => ({ ...item, description: event.target.value }))} /></label>
    </div></fieldset>)}<div className="service-actions"><Button type="button" variant="outline" disabled={disabled || entries.length >= 30} onClick={() => setEntries(current => [...current, { key: '', description: '', valueType: 'string', value: '' }])}><Plus size={16} aria-hidden="true" />新增設定項目</Button><span className="muted">{entries.length} / 30 項</span></div></div>
    <label className="service-span-all">變更理由<textarea required maxLength={500} rows={3} disabled={disabled} value={reason} onChange={event => setReason(event.target.value)} /></label>
    <p className="muted service-span-all">驗證後可核對與生效版本的差異。執行失敗會保留上一個生效版本；回復歷史內容也會建立新的草稿，再走驗證及生效流程。</p>
    <FormFeedback {...state} />
  </form>
}

export function TrafficEditor({ options, source, onSave, ...state }: FormState & { options: DeliveryOptions; source?: TrafficPolicy; onSave: (input: CreateTrafficPolicyInput) => void }) {
  const [reason, setReason] = useState(source?.reason ?? '')
  const [spec, setSpec] = useState<TrafficPolicy['spec']>(source?.spec ?? {
    endpointRef: options.endpoints[0]?.id ?? '', matchRef: (options.matches[0]?.id as TrafficPolicy['spec']['matchRef'] | undefined) ?? 'demo-path-api-v1',
    targets: [{ releaseId: '', weight: 0 }, { releaseId: '', weight: 100 }],
    healthWindowSeconds: 60, timeoutSeconds: 120, thresholds: { p95LatencyMs: 500, errorRate: 0.05 },
  })
  const disabled = state.pending || state.committed
  return <form className="panel service-form" aria-label="流量策略編輯器" onSubmit={event => { event.preventDefault(); onSave({ applicationId: options.application.id, environmentId: options.environment.id, environmentVersion: options.environment.version, reason: reason.trim(), spec }) }}>
    <h2 className="service-span-all">{source ? '編輯流量草稿' : '新增流量策略'}</h2>
    <label>服務端點<select required disabled={disabled} value={spec.endpointRef} onChange={event => setSpec({ ...spec, endpointRef: event.target.value })}>{options.endpoints.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <label>請求比對<select required disabled={disabled} value={spec.matchRef} onChange={event => setSpec({ ...spec, matchRef: event.target.value as TrafficPolicy['spec']['matchRef'] })}>{options.matches.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    {(['基準版本', '候選版本'] as const).map((label, index) => <label key={label}>{label}<select required disabled={disabled} value={spec.targets[index].releaseId} onChange={event => setSpec({ ...spec, targets: index === 0 ? [{ releaseId: event.target.value, weight: 0 }, spec.targets[1]] : [spec.targets[0], { releaseId: event.target.value, weight: 100 }] })}><option value="">選擇此環境已成功且保留產物的版本</option>{options.eligibleReleases.map(release => <option key={release.id} value={release.id} disabled={release.id === spec.targets[index === 0 ? 1 : 0].releaseId}>{release.revision} · {release.id}</option>)}</select></label>)}
    <div className="service-span-all"><ServiceNotice>此演示支援候選版本 10% → 50% → 100%。每一步都需完成健康窗口；最終為基準 0%、候選 100%。不支援其他放量計畫。</ServiceNotice>{options.eligibleReleases.length < 2 && <p role="status">尚不足兩個合格版本。先在此環境完成兩次發布並保留產物，再建立流量策略。</p>}</div>
    <label>健康窗口<select disabled={disabled} value={spec.healthWindowSeconds} onChange={event => { const seconds = Number(event.target.value) as 60 | 120 | 180; setSpec({ ...spec, healthWindowSeconds: seconds, timeoutSeconds: seconds * 2 as 120 | 240 | 360 }) }}><option value={60}>60 秒</option><option value={120}>120 秒</option><option value={180}>180 秒</option></select></label>
    <label>等待上限（秒）<input type="number" value={spec.timeoutSeconds} readOnly aria-readonly="true" /></label>
    <label>p95 延遲門檻（ms）<input required type="number" min={50} max={800} step="any" disabled={disabled} value={spec.thresholds.p95LatencyMs} onChange={event => setSpec({ ...spec, thresholds: { ...spec.thresholds, p95LatencyMs: Number(event.target.value) } })} /></label>
    <label>錯誤率門檻（%）<input required type="number" min={0} max={5} step="any" disabled={disabled} value={spec.thresholds.errorRate * 100} onChange={event => setSpec({ ...spec, thresholds: { ...spec.thresholds, errorRate: Number(event.target.value) / 100 } })} /></label>
    <label className="service-span-all">變更理由<textarea required maxLength={500} rows={3} disabled={disabled} value={reason} onChange={event => setReason(event.target.value)} /></label>
    <p className="muted service-span-all">缺少樣本會等待並在超時後停止；異常會立即停止。失敗保留最後通過的權重與證據，且不改寫業務發布的生效版本。</p>
    <FormFeedback {...state} />
  </form>
}
