import { AlertCircle, LoaderCircle } from 'lucide-react'
import { Button } from '../ui/button'

export function errorDetails(error: unknown) {
  if (typeof error !== 'object' || error === null) return { message: '目前無法讀取示範資料。', code: 'UNKNOWN_ERROR', requestId: null }
  const value = error as { message?: string; code?: string; requestId?: string; status?: number }
  return {
    message: value.message || '目前無法讀取示範資料。',
    code: value.code || 'UNKNOWN_ERROR',
    requestId: value.requestId || null,
  }
}

export function ErrorState({ error, onRetry, title = '資料讀取失敗' }: { error: unknown; onRetry?: () => void; title?: string }) {
  const details = errorDetails(error)
  return (
    <section className="error-state" role="alert">
      <AlertCircle size={22} aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        <p>{details.message}</p>
        <p className="error-reference"><code>{details.code}</code>{details.requestId && <> · 請求 ID：<code>{details.requestId}</code></>}</p>
        {onRetry && <Button variant="outline" onClick={onRetry}>重新讀取</Button>}
      </div>
    </section>
  )
}

export function LoadingState({ label = '正在讀取目前身分的資料…' }: { label?: string }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <div className="loading-label"><LoaderCircle size={18} className="spin" aria-hidden="true" />{label}</div>
      <div className="skeleton-row" aria-hidden="true"><div /><div /><div /></div>
      <div className="skeleton-block" aria-hidden="true" />
    </div>
  )
}
