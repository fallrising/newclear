import type { createRelationInputSchema, deleteRelationInputSchema } from '../../domain/schemas'
import { z } from 'zod'
import { topologyViewSchema, entitySearchHitSchema } from '../wire-views'
import {
  commandReceiptSchema,
  pageSchema,
  relationSchema,
} from '../../domain/schema-models'
import type { CommandReceipt, Relation } from '../../domain/schemas'
import type { ApiRequest } from '../core/request'

export type TopologyMode = 'dependencies' | 'impact'
export type TopologyDepth = 1 | 2 | 3
export type TopologyRoot = { ciId: string; environmentId?: never } | { environmentId: string; ciId?: never }
export type TopologyQuery = TopologyRoot & { mode: TopologyMode; depth: TopologyDepth }
export type TopologyView = z.infer<typeof topologyViewSchema>
export type EntitySearchHit = z.infer<typeof entitySearchHitSchema>
export type CreateRelationInput = z.infer<typeof createRelationInputSchema>
export type DeleteRelationInput = z.infer<typeof deleteRelationInputSchema>

export interface TopologyClient {
  search(q: string, limit?: number): Promise<{ items: EntitySearchHit[] }>
  getTopology(query: TopologyQuery): Promise<TopologyView>
  listRelations(ciId: string, direction?: 'in' | 'out' | 'both'): Promise<{ items: Relation[]; total: number; page: number; pageSize: number }>
  createRelation(input: CreateRelationInput): Promise<CommandReceipt>
  deleteRelation(relationId: string, input: DeleteRelationInput): Promise<CommandReceipt>
}

function topologyPath(query: TopologyQuery) {
  const parameters = new URLSearchParams({ mode: query.mode, depth: String(query.depth) })
  if (query.ciId !== undefined) parameters.set('ciId', query.ciId)
  else parameters.set('environmentId', query.environmentId)
  return `/topology?${parameters.toString()}`
}

export function createTopologyClient(request: ApiRequest): TopologyClient {
  return {
    search: (q, limit = 10) => request(`/search?${new URLSearchParams({ q, limit: String(limit) }).toString()}`,
      z.strictObject({ items: z.array(entitySearchHitSchema).max(20) })),
    getTopology: (query) => request(topologyPath(query), topologyViewSchema),
    listRelations: (ciId, direction = 'both') => {
      const parameters = new URLSearchParams({ ciId, direction, page: '1', pageSize: '100', sort: 'id', order: 'asc' })
      return request(`/relations?${parameters.toString()}`, pageSchema(relationSchema))
    },
    createRelation: (input) => request('/relations', commandReceiptSchema, { method: 'POST', body: input }),
    deleteRelation: (relationId, input) => request(`/relations/${encodeURIComponent(relationId)}`, commandReceiptSchema, { method: 'DELETE', body: input }),
  }
}
