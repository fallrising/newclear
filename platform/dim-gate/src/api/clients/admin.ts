import { z } from 'zod'
import {
  auditEventSchema, ciKindSchema, commandReceiptSchema,
  modelFieldSchema, monitoringNavigationItemSchema, organizationSchema, pageSchema, roleAssignmentSchema, userSchema,
  type AuditEvent, type CatalogItem, type Center, type CommandReceipt, type ModelField, type NavigationItem,
} from '../../domain/schema-models'
import type { ApiRequest } from '../core/request'

export type User = z.infer<typeof userSchema>
export type AccessView = { organizations: z.infer<typeof organizationSchema>[]; users: User[]; assignments: z.infer<typeof roleAssignmentSchema>[]; policyVersion: number }
export type ModelsView = { kinds: z.infer<typeof ciKindSchema>[]; fields: ModelField[] }
export type AuditListInput = { entityType?: string; entityId?: string; correlationId?: string; actorId?: string; page?: number; pageSize?: number; sort?: 'id' | 'occurredAt'; order?: 'asc' | 'desc' }

function withQuery(path: string, input: Record<string, unknown>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== '') query.set(key, String(value))
  return query.size ? `${path}?${query}` : path
}

const accessSchema = z.strictObject({ organizations: z.array(organizationSchema), users: z.array(userSchema), assignments: z.array(roleAssignmentSchema), policyVersion: z.number().int().min(1) })
const modelsSchema = z.strictObject({ kinds: z.array(ciKindSchema), fields: z.array(modelFieldSchema) })

export function createAdminClient(request: ApiRequest) {
  return {
    getNavigation: (center: Center): Promise<NavigationItem[]> => request(withQuery('/navigation', { center }), z.array(monitoringNavigationItemSchema)),
    getAccess: (): Promise<AccessView> => request('/admin/access', accessSchema),
    createAssignment: (body: { userId: string; role: Center; scopeType: 'org' | 'project' | 'pool'; scopeId: string; stages?: ('dev' | 'staging' | 'prod')[]; reason: string }): Promise<CommandReceipt> =>
      request('/admin/assignments', commandReceiptSchema, { method: 'POST', body }),
    revokeAssignment: (id: string, expectedVersion: number, reason: string): Promise<CommandReceipt> =>
      request(`/admin/assignments/${encodeURIComponent(id)}`, commandReceiptSchema, { method: 'DELETE', body: { expectedVersion, reason } }),
    patchUser: (id: string, expectedVersion: number, enabled: boolean, reason: string): Promise<CommandReceipt> =>
      request(`/admin/users/${encodeURIComponent(id)}`, commandReceiptSchema, { method: 'PATCH', body: { expectedVersion, enabled, reason } }),
    getAdminNavigation: (center?: Center): Promise<NavigationItem[]> => request(withQuery('/admin/navigation', { center }), z.array(monitoringNavigationItemSchema)),
    patchNavigation: (id: string, body: { expectedVersion: number; label?: string; group?: string; order?: number; enabled?: boolean }): Promise<CommandReceipt> =>
      request(`/admin/navigation/${encodeURIComponent(id)}`, commandReceiptSchema, { method: 'PATCH', body }),
    createCatalogRevision: (item: CatalogItem, reason: string): Promise<CommandReceipt> => request(`/admin/catalog/${encodeURIComponent(item.id)}/revisions`, commandReceiptSchema, { method: 'POST', body: {
      expectedVersion: item.version, baseRevision: item.revision, reason, name: item.name, description: item.description,
      allowedProjectIds: item.allowedProjectIds, template: item.template,
    } }),
    patchCatalog: (item: CatalogItem, body: { name?: string; description?: string; allowedProjectIds?: string[]; template?: CatalogItem['template'] }): Promise<CommandReceipt> =>
      request(`/admin/catalog/${encodeURIComponent(item.id)}`, commandReceiptSchema, { method: 'PATCH', body: { expectedVersion: item.version, revision: item.revision, ...body } }),
    publishCatalog: (item: CatalogItem, reason: string): Promise<CommandReceipt> => request(`/admin/catalog/${encodeURIComponent(item.id)}/publish`, commandReceiptSchema, { method: 'POST', body: { expectedVersion: item.version, revision: item.revision, reason } }),
    disableCatalog: (item: CatalogItem, reason: string): Promise<CommandReceipt> => request(`/admin/catalog/${encodeURIComponent(item.id)}/disable`, commandReceiptSchema, { method: 'POST', body: { expectedVersion: item.version, reason } }),
    getModels: (): Promise<ModelsView> => request('/admin/cmdb-models', modelsSchema),
    createModelField: (body: { kind: z.infer<typeof ciKindSchema>; key: string; label: string; valueType: 'string' | 'number' | 'boolean'; constraints: { maxLength?: number; enum?: string[]; min?: number; max?: number } }): Promise<CommandReceipt> =>
      request('/admin/cmdb-fields', commandReceiptSchema, { method: 'POST', body }),
    patchModelField: (id: string, expectedVersion: number, body: { label?: string; hidden?: boolean }): Promise<CommandReceipt> =>
      request(`/admin/cmdb-fields/${encodeURIComponent(id)}`, commandReceiptSchema, { method: 'PATCH', body: { expectedVersion, ...body } }),
    listAudit: (input: AuditListInput = {}) => request(withQuery('/audit', input), pageSchema(auditEventSchema)) as Promise<{ items: AuditEvent[]; total: number; page: number; pageSize: number }>,
  }
}

export type AdminClient = ReturnType<typeof createAdminClient>
