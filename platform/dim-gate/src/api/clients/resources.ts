import type { z } from 'zod'
import {
  changeDetailSchema, changeRequestSchema, commandReceiptSchema, pageSchema, resourceBindingSchema,
  resourceInventorySchema, resourceObjectSchema, serviceResourcesSchema, workItemSchema,
  type ChangeInput, type ChangeDetail, type ChangeRequest, type CommandReceipt, type Page,
  type ResourceBinding, type ResourceInventory, type ResourceObject, type ServiceResources, type WorkItem,
  type patchChangeInputSchema, type resourceObjectListQuerySchema, type resourceBindingListQuerySchema,
  type resourceInventoryQuerySchema, type changeListQuerySchema, type workItemListQuerySchema,
} from '../../domain/schemas'
import type { ApiRequest } from '../core/request'

export type ResourceObjectQuery = z.input<typeof resourceObjectListQuerySchema>
export type ResourceBindingQuery = z.input<typeof resourceBindingListQuerySchema>
export type ResourceInventoryQuery = z.input<typeof resourceInventoryQuerySchema>
export type ChangeListQuery = z.input<typeof changeListQuerySchema>
export type WorkItemQuery = z.input<typeof workItemListQuerySchema>
export type PatchChangeInput = z.infer<typeof patchChangeInputSchema>
export type ChangeAction = 'submit' | 'approve' | 'reject' | 'cancel' | 'execute' | 'retry'
const pathWithQuery = (path: string, input: Record<string, unknown>) => {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== '') query.set(key, String(value))
  return query.size ? `${path}?${query}` : path
}

export function createResourcesClient(request: ApiRequest) {
  return {
    listResourceObjects: (query: ResourceObjectQuery = {}): Promise<Page<ResourceObject>> => request(pathWithQuery('/resource-objects', query), pageSchema(resourceObjectSchema)),
    getResourceObject: (id: string): Promise<ResourceObject> => request(`/resource-objects/${encodeURIComponent(id)}`, resourceObjectSchema),
    listBindings: (query: ResourceBindingQuery = {}): Promise<Page<ResourceBinding>> => request(pathWithQuery('/bindings', query), pageSchema(resourceBindingSchema)),
    getBinding: (id: string): Promise<ResourceBinding> => request(`/bindings/${encodeURIComponent(id)}`, resourceBindingSchema),
    listResourceInventory: (query: ResourceInventoryQuery = {}): Promise<Page<ResourceInventory>> => request(pathWithQuery('/resource-inventory', query), pageSchema(resourceInventorySchema)),
    getResourceInventory: (ciId: string): Promise<ResourceInventory> => request(`/resource-inventory/${encodeURIComponent(ciId)}`, resourceInventorySchema),
    getServiceResources: (applicationId: string, environmentId: string): Promise<ServiceResources> => request(pathWithQuery(`/applications/${encodeURIComponent(applicationId)}/resources`, { environmentId }), serviceResourcesSchema),
    listWorkItems: (query: WorkItemQuery): Promise<Page<WorkItem>> => request(pathWithQuery('/work-items', query), pageSchema(workItemSchema)),
    listChanges: (query: ChangeListQuery = {}): Promise<Page<ChangeRequest>> => request(pathWithQuery('/changes', query), pageSchema(changeRequestSchema)),
    getChange: (id: string): Promise<ChangeDetail> => request(`/changes/${encodeURIComponent(id)}`, changeDetailSchema),
    createChange: (body: ChangeInput): Promise<CommandReceipt> => request('/changes', commandReceiptSchema, { method: 'POST', body }),
    patchChange: (id: string, body: PatchChangeInput): Promise<CommandReceipt> => request(`/changes/${encodeURIComponent(id)}`, commandReceiptSchema, { method: 'PATCH', body }),
    changeAction: (id: string, action: ChangeAction, expectedVersion: number, reason?: string): Promise<CommandReceipt> => request(`/changes/${encodeURIComponent(id)}/${action}`, commandReceiptSchema,
      { method: 'POST', body: ['submit', 'execute'].includes(action) ? { expectedVersion } : { expectedVersion, reason } }),
  }
}
