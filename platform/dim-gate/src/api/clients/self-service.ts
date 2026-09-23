import { z } from 'zod'
import {
  observationLogSchema, catalogItemSchema, commandReceiptSchema, createRequestInputSchema, pageSchema, poolSchema,
  provisionJobSchema, requestSchema, type CatalogItem, type CommandReceipt, type Page,
  type ProvisionJob, type Provider, type Request,
} from '../../domain/schemas'
import { capacitySchema } from '../wire-views'
import type { ApiRequest } from '../core/request'

export type ResourcePool = z.infer<typeof poolSchema>
export type Capacity = z.infer<typeof capacitySchema>
export type JobLog = z.infer<typeof observationLogSchema>
export type RequestDetail = { request: Request; jobs: ProvisionJob[] }
export type JobDetail = { job: ProvisionJob; logs: JobLog[] }
export type CreateRequestInput = z.infer<typeof createRequestInputSchema>
export type RequestState = Request['state']
export type JobState = ProvisionJob['state']

export type ListInput = {
  q?: string
  page?: number
  pageSize?: number
  sort?: 'id' | 'name' | 'updatedAt'
  order?: 'asc' | 'desc'
}
export type RequestListInput = ListInput & { state?: RequestState; applicationId?: string; requesterId?: string }
export type JobListInput = ListInput & { requestId?: string; state?: JobState }
export type PoolInput = { provider?: Provider; projectId?: string }

function withQuery(path: string, input: Record<string, unknown>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== '') query.set(key, String(value))
  return query.size ? `${path}?${query}` : path
}

const requestDetailSchema = z.strictObject({ request: requestSchema, jobs: z.array(provisionJobSchema) })
const jobDetailSchema = z.strictObject({ job: provisionJobSchema, logs: z.array(observationLogSchema).max(500) })

export function createSelfServiceClient(request: ApiRequest) {
  const action = (id: string, name: 'submit' | 'approve' | 'reject' | 'cancel' | 'provision' | 'retry', body: unknown) =>
    request(`/requests/${encodeURIComponent(id)}/${name}`, commandReceiptSchema, { method: 'POST', body })
  return {
    listPools: (input: PoolInput = {}): Promise<ResourcePool[]> =>
      request(withQuery('/pools', input), z.array(poolSchema)),
    getCapacity: (input: PoolInput = {}): Promise<Capacity[]> =>
      request(withQuery('/capacity', input), z.array(capacitySchema)),
    listCatalog: (input: ListInput = {}): Promise<Page<CatalogItem>> =>
      request(withQuery('/catalog', input), pageSchema(catalogItemSchema)),
    getCatalog: (id: string): Promise<CatalogItem> =>
      request(`/catalog/${encodeURIComponent(id)}`, catalogItemSchema),
    createRequest: (input: CreateRequestInput): Promise<CommandReceipt> =>
      request('/requests', commandReceiptSchema, { method: 'POST', body: input }),
    listRequests: (input: RequestListInput = {}): Promise<Page<Request>> =>
      request(withQuery('/requests', input), pageSchema(requestSchema)),
    getRequest: (id: string): Promise<RequestDetail> =>
      request(`/requests/${encodeURIComponent(id)}`, requestDetailSchema),
    submitRequest: (id: string, expectedVersion: number): Promise<CommandReceipt> =>
      action(id, 'submit', { expectedVersion }),
    approveRequest: (id: string, expectedVersion: number, reason: string): Promise<CommandReceipt> =>
      action(id, 'approve', { expectedVersion, reason }),
    rejectRequest: (id: string, expectedVersion: number, reason: string): Promise<CommandReceipt> =>
      action(id, 'reject', { expectedVersion, reason }),
    cancelRequest: (id: string, expectedVersion: number, reason: string): Promise<CommandReceipt> =>
      action(id, 'cancel', { expectedVersion, reason }),
    provisionRequest: (id: string, expectedVersion: number): Promise<CommandReceipt> =>
      action(id, 'provision', { expectedVersion }),
    retryRequest: (id: string, expectedVersion: number, reason: string): Promise<CommandReceipt> =>
      action(id, 'retry', { expectedVersion, reason }),
    listJobs: (input: JobListInput = {}): Promise<Page<ProvisionJob>> =>
      request(withQuery('/jobs', input), pageSchema(provisionJobSchema)),
    getJob: (id: string): Promise<JobDetail> =>
      request(`/jobs/${encodeURIComponent(id)}`, jobDetailSchema),
  }
}

export type SelfServiceClient = ReturnType<typeof createSelfServiceClient>
