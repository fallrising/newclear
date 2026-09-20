import type { ContractContext } from '../contracts.ts'

export function registerCmdbContracts({ z, d, w, s, id, listQuery, read, command }: ContractContext) {
  read('/applications', 'listApplications', d.pageSchema(s.Application), 'M0', listQuery({ projectId: id.optional() }))
  read('/cis', 'listCIs', d.pageSchema(s.CIView), 'M0', listQuery({ provider: d.providerSchema.optional(), kind: d.ciKindSchema.optional(), projectId: id.optional(), environmentId: id.optional(), health: d.healthSchema.optional(), freshness: z.enum(['fresh', 'stale']).optional() }, ['id', 'name', 'updatedAt', 'provider', 'kind', 'health']))
  read('/cis/{id}', 'getCI', s.CIView, 'M0')
  read('/applications/{id}', 'getApplication', w.ApplicationDetail, 'M1')
  read('/environments/{id}', 'getEnvironment', w.EnvironmentDetail, 'M1')
  command('post', '/cis', 'createCI', w.CreateCI, 'M1', 201)
  command('patch', '/cis/{id}', 'patchCI', s.PatchCI, 'M0')
}

export const cmdbFamilies = ['applications', 'environments', 'cis'] as const
