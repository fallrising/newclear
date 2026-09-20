import type { z } from 'zod'
import {
  ciViewSchema, commandReceiptSchema, createCiInputSchema, dashboardViewSchema, pageSchema, patchCiSchema,
} from '../../domain/schemas'
import type { Center, CIView, CommandReceipt, DashboardView, Page, Provider } from '../../domain/schemas'
import type { ApiRequest } from '../core/request'

export type CiListFilters = {
  provider?: Provider
  kind?: CIView['kind']
  projectId?: string
  environmentId?: string
  health?: CIView['health']
  freshness?: 'fresh' | 'stale' | 'unknown'
  q?: string
  page?: number
  pageSize?: number
  sort?: 'id' | 'name' | 'updatedAt' | 'provider' | 'kind' | 'health'
  order?: 'asc' | 'desc'
}
export type CreateCiInput = z.infer<typeof createCiInputSchema>
export type PatchCiInput = z.infer<typeof patchCiSchema>

function queryString(filters: CiListFilters): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters).sort(([left], [right]) => left.localeCompare(right))) {
    if (value !== undefined && value !== '') query.set(key, String(value))
  }
  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}

export function createCmdbClient(request: ApiRequest) {
  return {
    getDashboard: (center: Center): Promise<DashboardView> => request(`/dashboard?center=${encodeURIComponent(center)}`, dashboardViewSchema),
    listCis: (filters: CiListFilters = {}): Promise<Page<CIView>> => request(`/cis${queryString(filters)}`, pageSchema(ciViewSchema)),
    getCi: (ciId: string): Promise<CIView> => request(`/cis/${encodeURIComponent(ciId)}`, ciViewSchema),
    createCi: (input: CreateCiInput): Promise<CommandReceipt> => request('/cis', commandReceiptSchema, { method: 'POST', body: input }),
    patchCi: (ciId: string, input: PatchCiInput): Promise<CommandReceipt> => request(`/cis/${encodeURIComponent(ciId)}`, commandReceiptSchema,
      { method: 'PATCH', body: input }),
  }
}
