import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import type { Environment, Incident, SessionView } from '../../domain/schemas'
import './observability.css'

export const incidentLabels: Record<Incident['state'], string> = { open: '待認領', acknowledged: '已認領', investigating: '調查中', resolved: '已恢復' }
export const timestamp = (value: string | null | undefined) => value ? new Date(value).toLocaleString('zh-TW', { timeZone: 'UTC', hour12: false }) + ' UTC' : '尚無紀錄'
export const isNotFound = (error: unknown) => typeof error === 'object' && error !== null && (error as { status?: number }).status === 404
export const pageNumber = (value: string | null) => value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : 1

export function canReadRaw(session: SessionView, projectId: string, stage: Environment['stage']) {
  return session.assignments.some(grant => (grant.role === 'rd' || grant.role === 'ops') && grant.scopeType === 'project' && grant.scopeId === projectId && (!grant.stages || grant.stages.includes(stage)))
}

export function observationLink(input: Record<string, string | undefined>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) if (value) query.set(key, value)
  return `/rd/observability?${query}`
}

export function useObservationRefresh() {
  const cache = useQueryClient()
  return useCallback(() => cache.invalidateQueries({ predicate: query => ['metrics', 'traces', 'trace', 'logs', 'incidents', 'incident', 'integrations', 'audit', 'guide', 'dashboard', 'notifications'].includes(String(query.queryKey[3])) }), [cache])
}

export function MissingObservation({ entity }: { entity: string }) {
  return <section className="access-state" role="status"><p className="eyebrow">404 · 找不到資料</p><h1>找不到這個{entity}</h1><p>資料不存在，或不在目前身分的授權範圍。</p></section>
}

export function ScopeBadge({ environment, applicationId }: { environment: Environment; applicationId: string }) {
  return <div className="observation-scope"><span className="tag">{environment.stage}</span><Link to={`/rd/apps/${encodeURIComponent(applicationId)}/environments/${encodeURIComponent(environment.id)}`}>{environment.name}</Link><code>{environment.id}</code><span className="tag">模擬觀測</span></div>
}

export function IncidentStatus({ incident }: { incident: Incident }) {
  return <span className={`status ${incident.state === 'resolved' ? 'status-healthy' : incident.severity === 'critical' ? 'status-unhealthy' : 'status-degraded'}`}>{incidentLabels[incident.state]} · {incident.severity}</span>
}

export function Pager({ name, page, total, size = 25, onPage }: { name: string; page: number; total: number; size?: number; onPage: (page: number) => void }) {
  return <nav className="pagination" aria-label={`${name}分頁`}><span>共 {total} 筆 · 第 {page} 頁</span><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一頁</Button><Button variant="outline" size="sm" disabled={page * size >= total} onClick={() => onPage(page + 1)}>下一頁</Button></nav>
}

export function ObservationAudit({ entityId }: { entityId: string }) {
  const filters = { entityId, page: 1, pageSize: 100, sort: 'occurredAt' as const, order: 'desc' as const }
  const audit = useQuery({ queryKey: queryKey('audit', entityId, filters), queryFn: () => api.listAudit(filters) })
  return <section className="panel"><h2>操作與稽核歷史</h2>{audit.isPending ? <LoadingState label="正在讀取稽核紀錄…" /> : audit.isError ? <ErrorState error={audit.error} onRetry={() => void audit.refetch()} /> : audit.data.items.length === 0 ? <p className="observation-note">目前沒有可見的稽核紀錄。</p> : <ol className="observation-audit">{audit.data.items.map(entry => <li key={entry.id}><time dateTime={entry.occurredAt}>{timestamp(entry.occurredAt)}</time><strong>{entry.action}</strong><p>執行者 <code>{entry.actorId}</code> · {entry.outcome}</p><p>{entry.diffSummary.join('；')}</p>{entry.reason && <p>理由：{entry.reason}</p>}<code>{entry.correlationId}</code></li>)}</ol>}{audit.data && audit.data.total > audit.data.items.length && <p className="observation-note">顯示最近 {audit.data.items.length} 筆，共 {audit.data.total} 筆。</p>}</section>
}
