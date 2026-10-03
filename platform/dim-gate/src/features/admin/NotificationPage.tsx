import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, queryKey } from '../../api/client'
import { PageHeading } from '../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import type { Channel, NotificationPolicy, NotificationTemplate } from '../../domain/schemas'

const ids = (value: string) => [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))]

function ChannelCard({ channel, committed }: { channel: Channel; committed: () => Promise<unknown> }) {
  const [kind, setKind] = useState(channel.kind)
  const [label, setLabel] = useState(channel.destinationLabel)
  const [projectIds, setProjectIds] = useState(channel.allowedProjectIds.join(', '))
  const [enabled, setEnabled] = useState(channel.enabled)
  const [reason, setReason] = useState('Review safe Mock channel')
  const [simulateFailure, setSimulateFailure] = useState(false)
  const mutation = useMutation({ mutationFn: (action: 'save' | 'test') => action === 'save'
    ? api.patchChannel(channel.id, { expectedVersion: channel.version, kind, destinationLabel: label,
      allowedProjectIds: ids(projectIds), enabled, reason })
    : api.testChannel(channel.id, { expectedVersion: channel.version, simulateFailure, reason }) })
  const run = async (action: 'save' | 'test') => { try { await mutation.mutateAsync(action); await committed() } catch { /* Render refusal below. */ } }
  return <article className="panel" aria-label={channel.destinationLabel}><div className="panel-title"><h3>{channel.destinationLabel}</h3><span className="tag">{channel.enabled ? '啟用' : '停用'} · v{channel.version}</span></div>
    <p><code>{channel.id}</code> · {channel.kind} · 本機 Mock metadata</p>
    <div className="catalog-spec-grid"><label>Channel 類型<select value={kind} onChange={event => setKind(event.target.value as Channel['kind'])}>
      <option value="in_app">站內 Demo</option><option value="demo_email">Demo email</option><option value="demo_webhook">Demo webhook</option></select></label>
      <label>安全目的地標籤<input value={label} maxLength={80} onChange={event => setLabel(event.target.value)} /></label>
      <label>可用專案 ID（逗號分隔）<input value={projectIds} onChange={event => setProjectIds(event.target.value)} /></label>
      <label>狀態<select value={String(enabled)} onChange={event => setEnabled(event.target.value === 'true')}><option value="true">啟用</option><option value="false">停用</option></select></label>
    </div><label>變更理由<input required value={reason} onChange={event => setReason(event.target.value)} /></label>
    <div className="request-actions"><Button disabled={mutation.isPending || !reason.trim() || !label.trim()} onClick={() => void run('save')}>儲存 channel</Button>
      <label>Mock 測試結果<select value={String(simulateFailure)} onChange={event => setSimulateFailure(event.target.value === 'true')}>
        <option value="false">模擬成功</option><option value="true">模擬失敗</option></select></label>
      <Button variant="outline" disabled={mutation.isPending || !channel.enabled || !reason.trim()} onClick={() => void run('test')}>建立安全測試投遞</Button></div>
    {mutation.isError && <ErrorState error={mutation.error} title="Channel 操作未完成" />}</article>
}

function TemplateCard({ template, committed }: { template: NotificationTemplate; committed: () => Promise<unknown> }) {
  const [subject, setSubject] = useState(template.subject)
  const [body, setBody] = useState(template.body)
  const [reason, setReason] = useState('Review safe notification template')
  const mutation = useMutation({ mutationFn: (action: 'revise' | 'activate' | 'disable') => action === 'revise'
    ? api.reviseNotificationTemplate(template.id, { expectedVersion: template.version, subject, body, reason })
    : api.notificationTemplateAction(template.id, action, template.version, reason) })
  const run = async (action: 'revise' | 'activate' | 'disable') => { try { await mutation.mutateAsync(action); await committed() } catch { /* shown */ } }
  return <article className="panel" aria-label={`模板 ${template.id}`}><div className="panel-title"><h3>安全通知模板</h3><span className="tag">{template.status} · r{template.revision} · active {template.activeRevision ?? '無'}</span></div>
    <p><code>{template.id}</code> · 只允許 severity、source、time 三個 placeholder；不接受 HTML、網址或原始 log。</p>
    <label>標題<input maxLength={200} value={subject} onChange={event => setSubject(event.target.value)} /></label>
    <label>內容<textarea maxLength={200} value={body} onChange={event => setBody(event.target.value)} /></label>
    <label>變更理由<input value={reason} onChange={event => setReason(event.target.value)} /></label>
    <div className="request-actions">{template.status !== 'draft' && <Button variant="outline" disabled={mutation.isPending || !reason.trim()} onClick={() => void run('revise')}>建立新模板版本</Button>}
      {template.status === 'draft' && <Button disabled={mutation.isPending || !reason.trim()} onClick={() => void run('activate')}>啟用模板</Button>}
      {template.activeRevision !== null && template.status !== 'disabled' && <Button variant="destructive" disabled={mutation.isPending || !reason.trim()} onClick={() => void run('disable')}>停用模板</Button>}</div>
    <ul>{template.revisions.map(row => <li key={row.revision}>r{row.revision} · {row.reason}</li>)}</ul>
    {mutation.isError && <ErrorState error={mutation.error} title="模板操作未完成" />}</article>
}

function PolicyCard({ policy, committed }: { policy: NotificationPolicy; committed: () => Promise<unknown> }) {
  const [critical, setCritical] = useState(policy.severityChannels.find(row => row.severity === 'critical')?.channelIds.join(', ') ?? '')
  const [warning, setWarning] = useState(policy.severityChannels.find(row => row.severity === 'warning')?.channelIds.join(', ') ?? '')
  const [retentionDays, setRetentionDays] = useState(policy.retentionDays)
  const [dedupeSeconds, setDedupeSeconds] = useState(policy.dedupeSeconds)
  const [maxSilenceHours, setMaxSilenceHours] = useState(policy.maxSilenceHours)
  const [reason, setReason] = useState('Review notification policy')
  const mutation = useMutation({ mutationFn: () => api.patchNotificationPolicy(policy.id, { expectedVersion: policy.version,
    severityChannels: [{ severity: 'critical', channelIds: ids(critical) }, { severity: 'warning', channelIds: ids(warning) }],
    retentionDays, dedupeSeconds, maxSilenceHours, reason }) })
  return <article className="panel" aria-label="通知政策"><div className="panel-title"><h3>通知政策</h3><span className="tag">v{policy.version}</span></div>
    <p>嚴重度與 channel 的固定配對會在投遞及重試時重新檢查；Silence 上限不超過 W4 的 24 小時。</p>
    <div className="catalog-spec-grid"><label>Critical channel IDs<input value={critical} onChange={event => setCritical(event.target.value)} /></label>
      <label>Warning channel IDs<input value={warning} onChange={event => setWarning(event.target.value)} /></label>
      <label>保存天數<input type="number" min={1} max={30} value={retentionDays} onChange={event => setRetentionDays(Number(event.target.value))} /></label>
      <label>去重秒數<input type="number" min={60} max={86400} value={dedupeSeconds} onChange={event => setDedupeSeconds(Number(event.target.value))} /></label>
      <label>Silence 最長小時<input type="number" min={1} max={24} value={maxSilenceHours} onChange={event => setMaxSilenceHours(Number(event.target.value))} /></label></div>
    <label>變更理由<input value={reason} onChange={event => setReason(event.target.value)} /></label>
    <Button disabled={mutation.isPending || !reason.trim()} onClick={async () => { try { await mutation.mutateAsync(); await committed() } catch { /* shown */ } }}>儲存通知政策</Button>
    {mutation.isError && <ErrorState error={mutation.error} title="通知政策未更新" />}</article>
}

export function NotificationPage() {
  const channels = useQuery({ queryKey: queryKey('admin-channels'), queryFn: () => api.listAdminChannels() })
  const templates = useQuery({ queryKey: queryKey('admin-notification-templates'), queryFn: () => api.listAdminNotificationTemplates() })
  const policies = useQuery({ queryKey: queryKey('admin-notification-policies'), queryFn: () => api.listAdminNotificationPolicies() })
  const attempts = useQuery({ queryKey: queryKey('admin-notification-tests'), queryFn: () => api.listNotificationAttempts({ pageSize: 25 }) })
  const [channelForm, setChannelForm] = useState({ kind: 'in_app' as Channel['kind'], destinationLabel: '',
    allowedProjectIds: '', enabled: true, reason: 'Create safe Demo channel' })
  const createChannel = useMutation({ mutationFn: () => api.createChannel({ ...channelForm, allowedProjectIds: ids(channelForm.allowedProjectIds) }) })
  const [templateForm, setTemplateForm] = useState({ subject: 'Demo {{severity}} alert', body: '{{source}} at {{time}}',
    reason: 'Create safe Demo template' })
  const createTemplate = useMutation({ mutationFn: () => api.createNotificationTemplate(templateForm) })
  const refresh = async () => { await Promise.all([channels.refetch(), templates.refetch(), policies.refetch(), attempts.refetch()]) }
  const submitChannel = async (event: FormEvent) => { event.preventDefault(); try { await createChannel.mutateAsync(); await refresh() } catch { /* shown */ } }
  const submitTemplate = async (event: FormEvent) => { event.preventDefault(); try { await createTemplate.mutateAsync(); await refresh() } catch { /* shown */ } }
  if (channels.isPending || templates.isPending || policies.isPending || attempts.isPending) return <LoadingState label="正在讀取安全通知設定…" />
  if (channels.isError) return <ErrorState error={channels.error} onRetry={() => void channels.refetch()} />
  if (templates.isError) return <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />
  if (policies.isError) return <ErrorState error={policies.error} onRetry={() => void policies.refetch()} />
  if (attempts.isError) return <ErrorState error={attempts.error} onRetry={() => void attempts.refetch()} />
  return <><PageHeading eyebrow="ADMIN · MOCK NOTIFICATION" title="安全通知設定" description="只管理本地 channel 標籤、模板與投遞政策。沒有電子郵件地址、webhook URL、憑證或外部發送。" />
    <form className="panel admin-form" onSubmit={event => void submitChannel(event)}><div className="panel-title"><h2>建立 Demo channel</h2></div>
      <label>類型<select value={channelForm.kind} onChange={event => setChannelForm({ ...channelForm, kind: event.target.value as Channel['kind'] })}>
        <option value="in_app">站內 Demo</option><option value="demo_email">Demo email</option><option value="demo_webhook">Demo webhook</option></select></label>
      <label>安全目的地標籤<input required maxLength={80} value={channelForm.destinationLabel} onChange={event => setChannelForm({ ...channelForm, destinationLabel: event.target.value })} /></label>
      <label>可用專案 ID（逗號分隔）<input value={channelForm.allowedProjectIds} onChange={event => setChannelForm({ ...channelForm, allowedProjectIds: event.target.value })} /></label>
      <label>理由<input required value={channelForm.reason} onChange={event => setChannelForm({ ...channelForm, reason: event.target.value })} /></label>
      <div className="form-actions span-all"><Button type="submit" disabled={createChannel.isPending}>建立 channel</Button></div></form>
    {createChannel.isError && <ErrorState error={createChannel.error} title="Channel 未建立" />}
    {channels.data.map(channel => <ChannelCard key={`${channel.id}:${channel.version}`} channel={channel} committed={refresh} />)}
    <form className="panel admin-form" onSubmit={event => void submitTemplate(event)}><div className="panel-title"><h2>建立安全模板</h2></div>
      <label>標題<input required maxLength={200} value={templateForm.subject} onChange={event => setTemplateForm({ ...templateForm, subject: event.target.value })} /></label>
      <label>內容<textarea required maxLength={200} value={templateForm.body} onChange={event => setTemplateForm({ ...templateForm, body: event.target.value })} /></label>
      <label>理由<input required value={templateForm.reason} onChange={event => setTemplateForm({ ...templateForm, reason: event.target.value })} /></label>
      <div className="form-actions span-all"><Button type="submit" disabled={createTemplate.isPending}>建立模板草稿</Button></div></form>
    {createTemplate.isError && <ErrorState error={createTemplate.error} title="模板未建立" />}
    {templates.data.map(template => <TemplateCard key={`${template.id}:${template.version}`} template={template} committed={refresh} />)}
    {policies.data.map(policy => <PolicyCard key={`${policy.id}:${policy.version}`} policy={policy} committed={refresh} />)}
    <section className="panel"><h2>安全測試投遞</h2><p>僅顯示目前 Admin 身分建立的 synthetic Mock 測試；不包含任何服務或基建私有內容。</p>
      <ul>{attempts.data.items.map(item => <li key={item.attempt.id}><code>{item.attempt.id}</code> · {item.attempt.status} · {item.attempt.safeFailureCode ?? 'MOCK_OK'}</li>)}</ul></section>
  </>
}
