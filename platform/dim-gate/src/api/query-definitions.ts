/** Stable cache families. Feature clients may add members without changing identity isolation. */
export const queryFamilies = {
  core: { session: 'session', personas: 'personas', guide: 'guide' },
  cmdb: { dashboard: 'dashboard', applications: 'applications', environments: 'environments', cis: 'cis' },
  topology: { relations: 'relations', topology: 'topology', search: 'search' },
} as const

export function scopedQueryKey(identity: { sessionId: string; identityEpoch: number; policyVersion: number } | null,
  resourceFamily: string, scope: unknown = null, filters: unknown = null) {
  return [identity?.sessionId, identity?.identityEpoch, identity?.policyVersion, resourceFamily, scope, filters] as const
}
