import { useQuery } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import type { SessionView } from '../../domain/schemas'
import { ErrorState, LoadingState } from '../../components/shared/states'

export function Notifications({ session }: { session: SessionView }) {
  const notifications = useQuery({ queryKey: queryKey('notifications'), queryFn: () => api.getNotifications() })
  return <details className="notification-menu" key={`${session.sessionId}:${session.identityEpoch}:${session.policyVersion}`}>
    <summary aria-label="事件通知"><Bell size={18} aria-hidden="true" /><span className="notification-label">通知</span>{notifications.data && <span>{notifications.data.items.length}</span>}</summary>
    <section className="panel notification-panel" aria-label="目前可見通知"><h2>目前可見通知</h2><p className="muted">由已提交事件產生，依目前授權範圍顯示最近 20 筆。</p>
      {notifications.isPending ? <LoadingState /> : notifications.isError ? <ErrorState error={notifications.error} onRetry={() => void notifications.refetch()} /> : notifications.data.items.length === 0 ? <p>目前沒有可見事件。</p> : <ul>{notifications.data.items.map(item => <li key={item.id}><Link to={item.route} onClick={event => event.currentTarget.closest('details')?.removeAttribute('open')}>{item.title}</Link><time dateTime={item.occurredAt}>{item.occurredAt}</time></li>)}</ul>}
    </section>
  </details>
}
