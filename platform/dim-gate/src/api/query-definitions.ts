/** Stable cache families. Feature clients may add members without changing identity isolation. */
export const queryFamilies = {
  core: { session: 'session', personas: 'personas', guide: 'guide' },
  cmdb: { dashboard: 'dashboard', applications: 'applications', environments: 'environments', cis: 'cis' },
  topology: { relations: 'relations', topology: 'topology', search: 'search' },
  selfService: { pools: 'pools', capacity: 'capacity', catalog: 'catalog', requests: 'requests', jobs: 'jobs' },
  admin: { access: 'access', adminNavigation: 'admin-navigation', models: 'models', audit: 'audit' },
} as const

export function scopedQueryKey(identity: { sessionId: string; identityEpoch: number; policyVersion: number } | null,
  resourceFamily: string, scope: unknown = null, filters: unknown = null) {
  return [identity?.sessionId, identity?.identityEpoch, identity?.policyVersion, resourceFamily, scope, filters] as const
}
