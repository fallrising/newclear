import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Play, Undo2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import type { ReleaseDetail } from '../../api/clients/delivery'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../../components/ui/dialog'
import type { CommandReceipt, Environment, SessionView } from '../../domain/schemas'
import { deliveryApi, EnvironmentScope, environmentStageLabels, projectAction, useDeliveryRefresh } from './shared'

export function TriggerPipelineDialog({ session, applicationId = '', environmentId = '' }: { session: SessionView; applicationId?: string; environmentId?: string }) {
  const [open, setOpen] = useState(false)
  const [selectedApp, setSelectedApp] = useState(applicationId)
  const [selectedEnvironment, setSelectedEnvironment] = useState(environmentId)
  const [revision, setRevision] = useState('')
  const navigate = useNavigate()
  const refresh = useDeliveryRefresh()
  const applications = useQuery({ queryKey: queryKey('applications', null, { purpose: 'pipeline-trigger' }), queryFn: () => api.listApplications({ page: 1, pageSize: 100, sort: 'name', order: 'asc' }), enabled: open })
  const permittedApps = (applications.data?.items ?? []).filter((app) => (['dev', 'staging', 'prod'] as const).some((stage) => projectAction(session, 'pipeline.trigger', app.projectId, stage)))
  const selected = permittedApps.find((app) => app.id === selectedApp)
  const application = useQuery({ queryKey: queryKey('application', selectedApp), queryFn: () => api.getApplication(selectedApp), enabled: open && Boolean(selected) })
  const environments = (application.data?.environments ?? []).filter((env) => env.status === 'ready' && projectAction(session, 'pipeline.trigger', application.data!.application.projectId, env.stage))
  const environment = environments.find((env) => env.id === selectedEnvironment)
  const command = useMutation({ mutationFn: deliveryApi.createPipeline })
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected || !environment || !revision.trim()) return
    try {
      const receipt = await command.mutateAsync({ applicationId: selected.id, environmentId: environment.id, environmentVersion: environment.version, revision: revision.trim() })
      await refresh()
      setOpen(false)
      navigate(`/rd/pipelines/${receipt.entityId}`)
    } catch { /* Display the exact error and preserve form input. */ }
  }
  const changeOpen = (next: boolean) => {
    if (command.isPending) return
    if (next) { command.reset(); setSelectedApp(applicationId); setSelectedEnvironment(environmentId) }
    setOpen(next)
  }
  const loadError = applications.error || application.error
  return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><Button disabled={!session.effectiveActions.includes('pipeline.trigger')}><Play size={16} aria-hidden="true" />觸發 Pipeline</Button></DialogTrigger><DialogContent className="delivery-dialog"><DialogTitle>觸發 Pipeline</DialogTitle><DialogDescription>選擇已就緒的環境與來源版本。正式環境在封裝後，需要另一位具授權的 Ops 核准。</DialogDescription>{applications.isPending ? <LoadingState label="正在讀取可發布應用…" /> : loadError ? <ErrorState error={loadError} onRetry={() => { void applications.refetch(); if (selected) void application.refetch() }} /> : permittedApps.length === 0 ? <p className="delivery-note" role="status">目前 scope 沒有可發布的應用。</p> : <form onSubmit={(event) => void submit(event)}><label>發布應用<select required value={selectedApp} disabled={command.isPending} onChange={(event) => { setSelectedApp(event.target.value); setSelectedEnvironment(''); command.reset() }}><option value="">選擇應用</option>{permittedApps.map((app) => <option key={app.id} value={app.id}>{app.name} · {app.id}</option>)}</select></label><label>發布環境<select required value={selectedEnvironment} disabled={!selected || application.isPending || command.isPending} onChange={(event) => { setSelectedEnvironment(event.target.value); command.reset() }}><option value="">選擇已就緒的環境</option>{environments.map((env) => <option key={env.id} value={env.id}>{env.name} · {environmentStageLabels[env.stage]} ({env.stage})</option>)}</select></label>{selected && application.isPending && <LoadingState label="正在讀取環境…" />}{selected && application.isSuccess && environments.length === 0 && <p role="status" className="delivery-note">這個應用沒有已就緒且可發布的環境。請先完成環境申請與交付。</p>}{environment && <EnvironmentScope environment={environment} />}<label>來源版本<input required maxLength={160} value={revision} disabled={command.isPending} onChange={(event) => setRevision(event.target.value)} placeholder="例如 demo-stable-001" /></label><p className="delivery-note">產物 digest 是示範合成識別碼。建置成功後還需通過部署與健康檢查，才會變更目前生效版本。</p>{command.isError && <ErrorState error={command.error} title="Pipeline 尚未建立" onRetry={() => { command.reset(); void application.refetch() }} />}<div className="dialog-actions"><Button variant="outline" disabled={command.isPending} onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={command.isPending || !environment || !revision.trim()}>{command.isPending ? '正在建立…' : '確認觸發'}</Button></div></form>}</DialogContent></Dialog>
}

export function ReasonActionDialog({ title, description, trigger, environment, version, destructive = false, disabledReason, command: execute, onSuccess }: {
  title: string; description: string; trigger?: ReactNode; environment: Environment; version: number;
  destructive?: boolean; disabledReason?: string; command: (version: number, reason: string) => Promise<CommandReceipt>;
  onSuccess?: (receipt: CommandReceipt) => void;
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [expectedVersion, setExpectedVersion] = useState(version)
  const refresh = useDeliveryRefresh()
  const command = useMutation({ mutationFn: () => execute(expectedVersion, reason.trim()) })
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!reason.trim() || disabledReason) return
    try {
      const receipt = await command.mutateAsync()
      await refresh()
      setOpen(false)
      onSuccess?.(receipt)
    } catch { /* A conflict retains the reviewed version until explicit reload. */ }
  }
  return <div><Dialog open={open} onOpenChange={(next) => { if (command.isPending) return; if (next) { setExpectedVersion(version); setReason(''); command.reset() } setOpen(next) }}><DialogTrigger asChild><Button variant={destructive ? 'destructive' : 'outline'} disabled={Boolean(disabledReason)}>{trigger ?? title}</Button></DialogTrigger><DialogContent className="delivery-dialog"><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription><EnvironmentScope environment={environment} /><form onSubmit={(event) => void submit(event)}><label>操作理由<textarea required minLength={1} maxLength={500} rows={3} value={reason} disabled={command.isPending} onChange={(event) => setReason(event.target.value)} /></label>{disabledReason && <p role="status" className="delivery-note">{disabledReason}</p>}{command.isError && <ErrorState error={command.error} title="操作未完成" onRetry={() => { setOpen(false); void refresh() }} />}<div className="dialog-actions"><Button variant="outline" disabled={command.isPending} onClick={() => setOpen(false)}>返回</Button><Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={command.isPending || !reason.trim() || Boolean(disabledReason)}>{command.isPending ? '處理中…' : `確認${title}`}</Button></div></form></DialogContent></Dialog>{disabledReason && <p className="delivery-note">{disabledReason}</p>}</div>
}

export function RollbackDialog({ detail, environment, disabledReason, center }: { detail: ReleaseDetail; environment: Environment; disabledReason?: string; center: 'rd' | 'ops' }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [targetId, setTargetId] = useState('')
  const [reviewed, setReviewed] = useState({ release: detail.release, environment, targets: detail.rollbackTargets })
  const refresh = useDeliveryRefresh()
  const navigate = useNavigate()
  const command = useMutation({ mutationFn: () => deliveryApi.rollbackRelease(reviewed.release.id, { expectedVersion: reviewed.release.version, environmentVersion: reviewed.environment.version, targetReleaseId: targetId, reason: reason.trim() }) })
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!reason.trim() || !targetId || disabledReason) return
    try {
      const receipt = await command.mutateAsync()
      await refresh()
      setOpen(false)
      navigate(`/${center}/releases/${receipt.entityId}`)
    } catch { /* The currently active release remains visible while errors are shown. */ }
  }
  return <div><Dialog open={open} onOpenChange={(next) => { if (command.isPending) return; if (next) { setReviewed({ release: detail.release, environment, targets: detail.rollbackTargets }); setTargetId(''); setReason(''); command.reset() } setOpen(next) }}><DialogTrigger asChild><Button variant="outline" disabled={Boolean(disabledReason)}><Undo2 size={16} aria-hidden="true" />回滾版本</Button></DialogTrigger><DialogContent className="delivery-dialog"><DialogTitle>回滾版本</DialogTitle><DialogDescription>建立新的回滾發布；健康檢查通過後才會切換生效版本。正式環境仍需另一位 Ops 核准。</DialogDescription><EnvironmentScope environment={reviewed.environment} /><dl className="detail-list"><div><dt>目前生效版本</dt><dd><code>{reviewed.release.id}</code></dd></div><div><dt>目前產物</dt><dd><code>{reviewed.release.artifactDigest}</code></dd></div></dl><form onSubmit={(event) => void submit(event)}><label>回滾目標<select required value={targetId} disabled={command.isPending} onChange={(event) => setTargetId(event.target.value)}><option value="">選擇同環境成功的歷史版本</option>{reviewed.targets.map((target) => <option key={target.id} value={target.id}>{target.id} · {target.artifactDigest}</option>)}</select></label><label>回滾理由<textarea required minLength={1} maxLength={500} rows={3} value={reason} disabled={command.isPending} onChange={(event) => setReason(event.target.value)} /></label>{disabledReason && <p className="delivery-note" role="status">{disabledReason}</p>}{command.isError && <ErrorState error={command.error} title="回滾尚未建立" onRetry={() => { setOpen(false); void refresh() }} />}<div className="dialog-actions"><Button variant="outline" disabled={command.isPending} onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={command.isPending || !targetId || !reason.trim() || Boolean(disabledReason)}>{command.isPending ? '正在建立回滾…' : '確認回滾'}</Button></div></form></DialogContent></Dialog>{disabledReason && <p className="delivery-note">{disabledReason}</p>}</div>
}
