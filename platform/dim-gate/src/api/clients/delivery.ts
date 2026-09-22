import { z } from 'zod'
import {
  commandReceiptSchema, createPipelineInputSchema, deliveryLogSchema, pageSchema,
  pipelineRunSchema, releaseDetailSchema, releaseSchema, rollbackReleaseInputSchema,
  type CommandReceipt, type DeliveryLog, type Page, type PipelineRun, type Release,
} from '../../domain/schemas'
import type { ApiRequest } from '../core/request'

export type CreatePipelineInput = z.infer<typeof createPipelineInputSchema>
export type RollbackReleaseInput = z.infer<typeof rollbackReleaseInputSchema>
export type PipelineDetail = { run: PipelineRun; logs: DeliveryLog[] }
export type ReleaseDetail = z.infer<typeof releaseDetailSchema>
type ListInput = { q?: string; page?: number; pageSize?: number; sort?: 'id' | 'updatedAt'; order?: 'asc' | 'desc' }
export type PipelineListInput = ListInput & { applicationId?: string; environmentId?: string; state?: PipelineRun['state'] }
export type ReleaseListInput = ListInput & { environmentId?: string; state?: Release['state']; kind?: Release['kind'] }

function withQuery(path: string, input: Record<string, unknown>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== '') query.set(key, String(value))
  return query.size ? `${path}?${query}` : path
}

const pipelineDetailSchema = z.strictObject({ run: pipelineRunSchema, logs: z.array(deliveryLogSchema).max(500) })

export function createDeliveryClient(request: ApiRequest) {
  const action = (family: 'pipelines' | 'releases', id: string, name: string, body: unknown) =>
    request(`/${family}/${encodeURIComponent(id)}/${name}`, commandReceiptSchema, { method: 'POST', body })
  return {
    listPipelines: (input: PipelineListInput = {}): Promise<Page<PipelineRun>> =>
      request(withQuery('/pipelines', input), pageSchema(pipelineRunSchema)),
    getPipeline: (id: string): Promise<PipelineDetail> =>
      request(`/pipelines/${encodeURIComponent(id)}`, pipelineDetailSchema),
    createPipeline: (input: CreatePipelineInput): Promise<CommandReceipt> =>
      request('/pipelines', commandReceiptSchema, { method: 'POST', body: input }),
    cancelPipeline: (id: string, expectedVersion: number, reason: string): Promise<CommandReceipt> =>
      action('pipelines', id, 'cancel', { expectedVersion, reason }),
    retryPipeline: (id: string, expectedVersion: number, reason: string): Promise<CommandReceipt> =>
      action('pipelines', id, 'retry', { expectedVersion, reason }),
    listReleases: (input: ReleaseListInput = {}): Promise<Page<Release>> =>
      request(withQuery('/releases', input), pageSchema(releaseSchema)),
    getRelease: (id: string): Promise<ReleaseDetail> =>
      request(`/releases/${encodeURIComponent(id)}`, releaseDetailSchema),
    approveRelease: (id: string, expectedVersion: number, reason: string): Promise<CommandReceipt> =>
      action('releases', id, 'approve', { expectedVersion, reason }),
    rejectRelease: (id: string, expectedVersion: number, reason: string): Promise<CommandReceipt> =>
      action('releases', id, 'reject', { expectedVersion, reason }),
    rollbackRelease: (id: string, input: RollbackReleaseInput): Promise<CommandReceipt> =>
      action('releases', id, 'rollback', input),
  }
}

export type DeliveryClient = ReturnType<typeof createDeliveryClient>
