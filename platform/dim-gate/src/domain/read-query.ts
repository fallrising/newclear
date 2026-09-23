import type { Page } from './schema-models'
import { DomainError } from './errors'
import { fail } from './engine-shared'

export function validateQuery(query: URLSearchParams, allowed: string[]): void {
  const seen = new Set<string>()
  for (const key of query.keys()) {
    if (!allowed.includes(key) || seen.has(key)) throw new DomainError(422, 'VALIDATION_ERROR', '不支援的查詢欄位或重複欄位。', { [key]: ['Unknown or duplicate query parameter'] })
    seen.add(key)
    if (key !== 'q' && query.get(key) === '') throw new DomainError(422, 'VALIDATION_ERROR', '查詢欄位不可為空。', { [key]: ['Empty query parameter'] })
  }
  if ((query.get('q')?.length ?? 0) > 100) fail(422, 'VALIDATION_ERROR', '搜尋字串最多 100 字元。')
}

export function pageValues(query: URLSearchParams): { page: number; pageSize: number } {
  const integer = (key: string, fallback: number, max: number) => {
    const value = query.get(key)
    if (value === null) return fallback
    if (!/^[1-9]\d*$/.test(value) || Number(value) > max) fail(422, 'VALIDATION_ERROR', `${key} 超出允許範圍。`)
    return Number(value)
  }
  return { page: integer('page', 1, Number.MAX_SAFE_INTEGER), pageSize: integer('pageSize', 25, 100) }
}

export function basicPage<T>(items: T[], query: URLSearchParams): Page<T> {
  const { page, pageSize } = pageValues(query)
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize }
}
