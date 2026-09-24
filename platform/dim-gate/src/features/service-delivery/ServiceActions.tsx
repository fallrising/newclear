import { useRef, useState } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { demoClockMutationKey } from '../../api/query-definitions'
import type { PipelineDefinitionAction, ServiceConfigAction, TrafficPolicyAction } from '../../api/clients/service-delivery'
import type { CommandReceipt, DeliveryOptions, ServiceSource } from '../../domain/schemas'
import { Button } from '../../components/ui/button'
import { useServiceCommand } from './commands'
import { actionLabel, getServiceDetail, sectionTitle, sourcePath, stateLabel, type ServiceAction, type ServiceDetail } from './model'
import { ServiceConfirmation, ServiceNotice } from './ui'

async function perform(source: ServiceSource, action: ServiceAction, reason: string, environmentVersion: number) {
  const body = { expectedVersion: source.version, reason }
  if (source.sourceType === 'pipelineDefinition' && ['validate', 'submit', 'approve', 'reject', 'cancel', 'activate', 'revisions'].includes(action)) return api.pipelineDefinitionAction(source.id, action as PipelineDefinitionAction, body)
  if (source.sourceType === 'serviceConfig') {
    if (action === 'revisions') return api.reviseServiceConfig(source.id, { ...body, environmentVersion })
    if (action === 'restore') return api.restoreServiceConfig(source.id, { ...body, environmentVersion })
    if (['validate', 'submit', 'approve', 'reject', 'cancel', 'apply'].includes(action)) return api.serviceConfigAction(source.id, action as ServiceConfigAction, body)
  }
  if (source.sourceType === 'trafficPolicy') {
    if (action === 'revisions') return api.reviseTrafficPolicy(source.id, { ...body, environmentVersion })
    if (['validate', 'submit', 'approve', 'reject', 'cancel', 'start'].includes(action)) return api.trafficPolicyAction(source.id, action as TrafficPolicyAction, body)
  }
  throw new Error('此操作不適用於目前的版本類型。')
}

export function ServiceActions({ detail, options, center, onEdit, readOnly = false }: { detail: ServiceDetail; options: DeliveryOptions; center: 'rd' | 'ops'; onEdit: () => void; readOnly?: boolean }) {
  const [selected, setSelected] = useState<{ action: ServiceAction; source: ServiceSource } | null>(null)
  const [reason, setReason] = useState('')
  const [runTarget, setRunTarget] = useState(options.environment.id)
  const [sourceRef, setSourceRef] = useState('main')
  const [sourceRevision, setSourceRevision] = useState('')
  const trigger = useRef<HTMLElement | null>(null)
  const navigate = useNavigate()
  const clockPending = useIsMutating({ mutationKey: demoClockMutationKey }) > 0
  const command = useServiceCommand(async (receipt: CommandReceipt) => {
    if (selected?.action === 'runs') await api.getPipeline(receipt.entityId)
    else await getServiceDetail(detail.source.sourceType, receipt.entityId)
    await api.listAudit({ correlationId: receipt.correlationId, pageSize: 100 })
  })
  const available = center === 'ops' ? detail.availableActions.filter(action => action === 'approve' || action === 'reject')
    : readOnly ? [] : detail.availableActions.filter(action => action !== 'approve' && action !== 'reject')
  const confirm = async () => {
    if (!selected) return
    try {
      const receipt = await command.mutateAsync(async () => {
        if (selected.action !== 'runs') return perform(selected.source, selected.action, reason.trim(), options.environment.version)
        if (selected.source.sourceType !== 'pipelineDefinition') throw new Error('此來源不是可執行的交付定義。')
        const target = options.environments.find(environment => environment.id === runTarget && environment.status === 'ready' && selected.source.sourceType === 'pipelineDefinition' && selected.source.spec.targetEnvironmentIds.includes(environment.id))
        if (!target) throw new Error('請選擇此定義允許且已就緒的目標環境。')
        return api.runPipelineDefinition(selected.source.id, { expectedVersion: selected.source.version, reason: reason.trim(), environmentId: target.id, environmentVersion: target.version, sourceRef: sourceRef.trim(), sourceRevision: sourceRevision.trim() })
      })
      const action = selected.action
      setSelected(null)
      if (action === 'runs') navigate(`/rd/pipelines/${receipt.entityId}`)
      else if (action === 'revisions' || action === 'restore') navigate(sourcePath({ ...detail.source, id: receipt.entityId }, center, options.environment.id))
    } catch { /* Exact refusal/readback error stays visible; no automatic command retry. */ }
  }
  const pending = command.isPending || clockPending
  return <section className="panel"><h2>決策與下一步</h2>{available.length === 0 ? <p>目前身分與狀態沒有可執行的操作。</p> : <div className="service-actions">{available.map(action => <Button key={action} disabled={pending} variant={action === 'reject' || action === 'cancel' ? 'destructive' : action === 'edit' || action === 'revisions' || action === 'restore' ? 'outline' : 'default'} onClick={event => {
    if (action === 'edit') { onEdit(); return }
    trigger.current = event.currentTarget
    command.reset(); setReason(''); setSourceRevision('')
    setRunTarget(options.environment.id)
    setSourceRef(detail.source.sourceType === 'pipelineDefinition' && detail.source.spec.refPattern === 'release/*' ? 'release/' : 'main')
    setSelected({ action, source: detail.source })
  }}>{actionLabel[action]}</Button>)}</div>}
    <p className="muted">驗證不等於核准，核准不等於執行完成。每次操作都重新核對目前授權、版本與環境執行狀態。</p>
    {selected && <ServiceConfirmation open title={actionLabel[selected.action]} description="核對同一來源版本、變更理由與影響後確認。操作與結果讀回完成前，對話框會保持開啟。" reason={reason} onReason={setReason} pending={pending} committed={command.committed} error={command.error} trigger={trigger} onClose={() => setSelected(null)} onConfirm={() => void confirm()}>
      <p>{sectionTitle[selected.source.sourceType]} · revision {selected.source.revision} · {stateLabel[selected.source.state]}</p><p><code>{selected.source.id}</code> · v{selected.source.version}</p><p>{selected.source.reason}</p>
      {detail.productionRisk && <ServiceNotice>此變更包含正式環境影響；核准不會替申請者執行。</ServiceNotice>}
      {selected.action === 'restore' && <p>以這份歷史內容建立新的草稿，不會立刻替換目前生效配置。</p>}
      {selected.action === 'runs' && selected.source.sourceType === 'pipelineDefinition' && <div className="service-form"><label className="service-span-all">執行目標環境<select required disabled={pending || command.committed} value={runTarget} onChange={event => setRunTarget(event.target.value)}><option value="">選擇目標環境</option>{options.environments.filter(environment => selected.source.sourceType === 'pipelineDefinition' && selected.source.spec.targetEnvironmentIds.includes(environment.id)).map(environment => <option key={environment.id} value={environment.id} disabled={environment.status !== 'ready'}>{environment.name} · {environment.stage}</option>)}</select></label><label>來源分支<input required maxLength={80} value={sourceRef} readOnly={selected.source.spec.refPattern === 'main'} disabled={pending || command.committed} onChange={event => setSourceRef(event.target.value)} /></label><label>來源版本<input required maxLength={80} disabled={pending || command.committed} value={sourceRevision} onChange={event => setSourceRevision(event.target.value)} placeholder="例如 demo-stable-001" /></label></div>}
    </ServiceConfirmation>}
  </section>
}
