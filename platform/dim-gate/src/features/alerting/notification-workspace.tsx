import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, queryKey } from '../../api/client'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import type { NotificationAttempt, NotificationSubscription, SessionView } from '../../domain/schemas'

function AttemptRow({ value, session, committed }: { value: { attempt: NotificationAttempt; sourceLabel: string; sourceTime: string; mock: true };
  session: SessionView; committed: () => Promise<unknown> }) {
  const [reason, setReason] = useState('Retry current safe Mock projection')
  const retry = useMutation({ mutationFn: () => api.retryNotificationAttempt(value.attempt.id, value.attempt.version, reason) })
  const run = async () => { try { await retry.mutateAsync(); await committed() } catch { /* Exact refusal below. */ } }
  return <li className="panel"><p><strong>{value.sourceLabel}</strong> · {value.attempt.status} · 第 {value.attempt.attempt} 次 · Mock</p>
    <p><code>{value.attempt.id}</code> · 來源時間 {new Date(value.sourceTime).toLocaleString('zh-TW')} · {value.attempt.safeFailureCode ?? 'MOCK_OK'}</p>
    {value.attempt.status === 'failed' && value.attempt.recipientId === session.user.id && <div className="request-actions">
      <label>重試理由<input value={reason} onChange={event => setReason(event.target.value)} /></label>
      <Button variant="outline" disabled={retry.isPending || !reason.trim()} onClick={() => void run()}>重新投遞到目前授權範圍</Button></div>}
    {retry.isError && <ErrorState error={retry.error} title="通知未重試" />}</li>
}

function SubscriptionRow({ row, committed }: { row: NotificationSubscription; committed: () => Promise<unknown> }) {
  const [reason, setReason] = useState('Update own Demo subscription')
  const mutation = useMutation({ mutationFn: () => api.patchNotificationSubscription(row.id, {
    expectedVersion: row.version, channelId: row.channelId, enabled: !row.enabled, reason }) })
  return <li className="panel"><p><code>{row.id}</code> · channel <code>{row.channelId}</code> · {row.enabled ? '已訂閱' : '已停用'}</p>
    <div className="request-actions"><label>變更理由<input value={reason} onChange={event => setReason(event.target.value)} /></label>
      <Button variant="outline" disabled={mutation.isPending || !reason.trim()} onClick={async () => {
        try { await mutation.mutateAsync(); await committed() } catch { /* shown */ }
      }}>{row.enabled ? '停止訂閱' : '重新訂閱'}</Button></div>
    {mutation.isError && <ErrorState error={mutation.error} title="訂閱未更新" />}</li>
}

export function ServiceNotificationWorkspace({ environmentId, session }: { environmentId: string; session: SessionView }) {
  const channels = useQuery({ queryKey: queryKey('notification-channels', environmentId), queryFn: () => api.listNotificationChannels(environmentId) })
  const subscriptions = useQuery({ queryKey: queryKey('notification-subscriptions', environmentId),
    queryFn: () => api.listNotificationSubscriptions({ environmentId, pageSize: 100 }) })
  const attempts = useQuery({ queryKey: queryKey('notification-attempts', environmentId),
    queryFn: () => api.listNotificationAttempts({ environmentId, pageSize: 100 }) })
  const [channelId, setChannelId] = useState('demo-rd')
  const [reason, setReason] = useState('Subscribe to current service environment')
  const create = useMutation({ mutationFn: () => api.createNotificationSubscription({ environmentId, channelId, reason }) })
  const refresh = async () => { await Promise.all([channels.refetch(), subscriptions.refetch(), attempts.refetch()]) }
  const submit = async (event: FormEvent) => { event.preventDefault(); try { await create.mutateAsync(); await refresh() } catch { /* shown */ } }
  return <section className="panel"><h2>服務通知訂閱與逐收件者投遞</h2><p>只顯示目前授權的服務環境與自己的投遞；Mock 歷史不儲存原始 trace、log 或變更差異。</p>
    {channels.isPending || subscriptions.isPending || attempts.isPending ? <LoadingState label="正在讀取通知範圍…" />
      : channels.isError || subscriptions.isError || attempts.isError
        ? <ErrorState error={channels.error || subscriptions.error || attempts.error} onRetry={() => void refresh()} />
        : <><form className="admin-form" onSubmit={event => void submit(event)}><label>可用 Demo channel<select value={channelId} onChange={event => setChannelId(event.target.value)}>
          {channels.data.map(row => <option key={row.id} value={row.id}>{row.destinationLabel} · {row.kind}</option>)}</select></label>
          <label>訂閱理由<input required value={reason} onChange={event => setReason(event.target.value)} /></label>
          <Button type="submit" disabled={create.isPending || !reason.trim() || channels.data.length === 0}>訂閱此環境</Button></form>
          {create.isError && <ErrorState error={create.error} title="訂閱未建立" />}
          <h3>目前訂閱</h3>{subscriptions.data.items.length ? <ul className="alert-records">{subscriptions.data.items.map(row =>
            <SubscriptionRow key={`${row.id}:${row.version}`} row={row} committed={refresh} />)}</ul> : <p>此環境目前沒有你的通知訂閱。</p>}
          <h3>目前可見的投遞</h3>{attempts.data.items.length ? <ul className="alert-records">{attempts.data.items.map(value =>
            <AttemptRow key={value.attempt.id} value={value} session={session} committed={refresh} />)}</ul> : <p>此環境目前沒有可見投遞。</p>}
        </>}
  </section>
}

export function OpsNotificationWorkspace({ session }: { session: SessionView }) {
  const attempts = useQuery({ queryKey: queryKey('notification-attempts', 'ops'),
    queryFn: () => api.listNotificationAttempts({ pageSize: 100 }) })
  return <section className="panel"><h2>目前 pool 範圍的 Mock 投遞診斷</h2><p>僅列出目前可讀、可投遞的 recipient attempt；失敗重試重新檢查收件人、channel 與 pool 授權。</p>
    {attempts.isPending ? <LoadingState label="正在讀取可見投遞…" /> : attempts.isError
      ? <ErrorState error={attempts.error} onRetry={() => void attempts.refetch()} />
      : attempts.data.items.length ? <ul className="alert-records">{attempts.data.items.map(value =>
        <AttemptRow key={value.attempt.id} value={value} session={session} committed={() => attempts.refetch()} />)}</ul>
        : <p>目前沒有可見的逐收件者投遞。</p>}
  </section>
}
