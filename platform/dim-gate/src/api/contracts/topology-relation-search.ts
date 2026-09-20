import type { ContractContext } from '../contracts.ts'

export function registerTopologyContracts({ z, w, s, d, id, listQuery, read, command }: ContractContext) {
  read('/search', 'search', z.strictObject({ items: z.array(w.EntitySearchHit).max(20) }), 'M1', z.strictObject({ q: z.string().min(1).max(100), limit: z.coerce.number().int().min(1).max(20).default(10) }))
  read('/relations', 'listRelations', d.pageSchema(s.Relation), 'M1', listQuery({ ciId: id, direction: z.enum(['in', 'out', 'both']).default('both') }, ['id', 'updatedAt']))
  read('/topology', 'getTopology', w.TopologyView, 'M1', z.strictObject({ ciId: id.optional(), environmentId: id.optional(), mode: z.enum(['dependencies', 'impact']), depth: z.coerce.number().int().min(1).max(3).default(1) }).refine(value => Boolean(value.ciId) !== Boolean(value.environmentId), 'Choose exactly one root'))
  command('post', '/relations', 'createRelation', w.CreateRelation, 'M1', 201)
  command('delete', '/relations/{id}', 'deleteRelation', w.ReasonCommand, 'M1')
}

export const topologyFamilies = ['search', 'relations', 'topology'] as const
