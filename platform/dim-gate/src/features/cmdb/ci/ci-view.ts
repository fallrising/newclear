import type { CIView, Provider } from '../../../domain/schemas'

export const providerLabels: Record<Provider, string> = { aws: 'AWS', aliyun: 'Aliyun', onprem: 'On-premises' }
export const healthLabels: Record<CIView['health'], string> = {
  healthy: '正常', degraded: '效能下降', unhealthy: '異常', unknown: '健康度未知',
}
export const kindLabels: Record<CIView['kind'], string> = {
  compute: '運算', cluster: '叢集', database: '資料庫', cache: '快取', queue: '佇列',
  load_balancer: '負載平衡', network: '網路', storage: '儲存',
}

export type Freshness = 'fresh' | 'stale' | 'unknown'

export function freshnessOf(ci: Pick<CIView, 'observedAt'>, logicalClock: number): Freshness {
  if (ci.observedAt === null) return 'unknown'
  const now = Date.parse('2026-09-20T09:00:00Z') + logicalClock * 1000
  return now - Date.parse(ci.observedAt) > 86_400_000 ? 'stale' : 'fresh'
}

export function freshnessText(ci: Pick<CIView, 'observedAt'>, logicalClock: number): string {
  const freshness = freshnessOf(ci, logicalClock)
  if (freshness === 'unknown') return '未知 · 尚未觀測'
  const observed = new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC', hour12: false,
  }).format(new Date(ci.observedAt!))
  return freshness === 'stale' ? `過期 · ${observed} UTC` : `最新 · ${observed} UTC`
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '未知'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function fieldErrors(error: unknown): Record<string, string[]> {
  if (!error || typeof error !== 'object') return {}
  return (error as { fieldErrors?: Record<string, string[]> }).fieldErrors ?? {}
}

export function errorStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' ? (error as { status?: number }).status : undefined
}
