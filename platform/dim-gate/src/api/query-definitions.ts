/** Stable cache families. Feature clients may add members without changing identity isolation. */
export const queryFamilies = {
  core: { session: 'session', personas: 'personas', guide: 'guide' },
  cmdb: { dashboard: 'dashboard', applications: 'applications', environments: 'environments', cis: 'cis' },
  topology: { relations: 'relations', topology: 'topology', search: 'search' },
  selfService: { pools: 'pools', capacity: 'capacity', catalog: 'catalog', requests: 'requests', jobs: 'jobs' },
  admin: { access: 'access', adminNavigation: 'admin-navigation', models: 'models', audit: 'audit' },
  observation: { metrics: 'metrics', traces: 'traces', trace: 'trace', logs: 'logs', incidents: 'incidents', incident: 'incident', integrations: 'integrations', notifications: 'notifications' },
  resources: { objects: 'resource-objects', bindings: 'bindings', inventory: 'resource-inventory', service: 'service-resources', work: 'work-items', changes: 'changes', change: 'change' },
  serviceDelivery: { options: 'delivery-options', definitions: 'pipeline-definitions', definition: 'pipeline-definition', configs: 'service-configs', config: 'service-config', traffic: 'traffic-policies', policy: 'traffic-policy' },
  delivery: { pipelines: 'pipelines', pipeline: 'pipeline', releases: 'releases', release: 'release' },
} as const

export function scopedQueryKey(identity: { sessionId: string; identityEpoch: number; policyVersion: number } | null,
  resourceFamily: string, scope: unknown = null, filters: unknown = null) {
  return [identity?.sessionId, identity?.identityEpoch, identity?.policyVersion, resourceFamily, scope, filters] as const
}

/** All UI clock mutations retain pending ownership through response and refresh. */
export const demoClockMutationKey = ['demo-clock'] as const

/** W3 command ownership covers its committed receipt and required detail/audit readback. */
export const serviceDeliveryMutationKey = ['service-delivery-command'] as const
