import type { z } from 'zod'
import {
  commandReceiptSchema, pageSchema, deliveryOptionsSchema,
  pipelineDefinitionSchema, pipelineDefinitionDetailSchema, serviceConfigSchema, serviceConfigDetailSchema,
  trafficPolicySchema, trafficPolicyDetailSchema,
  type PipelineDefinition, type PipelineDefinitionDetail, type ServiceConfig, type ServiceConfigDetail,
  type TrafficPolicy, type TrafficPolicyDetail, type DeliveryOptions, type CommandReceipt, type Page,
  type CreatePipelineDefinitionInput, type CreateServiceConfigInput, type CreateTrafficPolicyInput,
  type patchPipelineDefinitionInputSchema, type patchServiceConfigInputSchema, type patchTrafficPolicyInputSchema,
  type pipelineDefinitionListQuerySchema, type serviceConfigListQuerySchema, type trafficPolicyListQuerySchema,
  type serviceActionInputSchema, type serviceRevisionInputSchema, type runPipelineDefinitionInputSchema,
} from '../../domain/schemas'
import type { ApiRequest } from '../core/request'

export type PipelineDefinitionQuery = z.input<typeof pipelineDefinitionListQuerySchema>
export type ServiceConfigQuery = z.input<typeof serviceConfigListQuerySchema>
export type TrafficPolicyQuery = z.input<typeof trafficPolicyListQuerySchema>
export type PatchPipelineDefinitionInput = z.infer<typeof patchPipelineDefinitionInputSchema>
export type PatchServiceConfigInput = z.infer<typeof patchServiceConfigInputSchema>
export type PatchTrafficPolicyInput = z.infer<typeof patchTrafficPolicyInputSchema>
export type ServiceActionInput = z.infer<typeof serviceActionInputSchema>
export type ServiceRevisionInput = z.infer<typeof serviceRevisionInputSchema>
export type RunPipelineDefinitionInput = z.infer<typeof runPipelineDefinitionInputSchema>
export type PipelineDefinitionAction = 'validate' | 'submit' | 'approve' | 'reject' | 'cancel' | 'activate' | 'revisions'
export type ServiceConfigAction = 'validate' | 'submit' | 'approve' | 'reject' | 'cancel' | 'apply'
export type TrafficPolicyAction = 'validate' | 'submit' | 'approve' | 'reject' | 'cancel' | 'start'
const idPath = (collection: string, id: string) => `/${collection}/${encodeURIComponent(id)}`
const queryPath = (path: string, input: Record<string, unknown>) => {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== '') query.set(key, String(value))
  return query.size ? `${path}?${query}` : path
}

export function createServiceDeliveryClient(request: ApiRequest) {
  const action = (collection: string, id: string, name: string, body: ServiceActionInput | ServiceRevisionInput) =>
    request(`${idPath(collection, id)}/${name}`, commandReceiptSchema, { method: 'POST', body })
  return {
    getDeliveryOptions: (applicationId: string, environmentId: string): Promise<DeliveryOptions> =>
      request(queryPath(`/applications/${encodeURIComponent(applicationId)}/delivery-options`, { environmentId }), deliveryOptionsSchema),
    listPipelineDefinitions: (query: PipelineDefinitionQuery = {}): Promise<Page<PipelineDefinition>> => request(queryPath('/pipeline-definitions', query), pageSchema(pipelineDefinitionSchema)),
    getPipelineDefinition: (id: string): Promise<PipelineDefinitionDetail> => request(idPath('pipeline-definitions', id), pipelineDefinitionDetailSchema),
    createPipelineDefinition: (body: CreatePipelineDefinitionInput): Promise<CommandReceipt> => request('/pipeline-definitions', commandReceiptSchema, { method: 'POST', body }),
    patchPipelineDefinition: (id: string, body: PatchPipelineDefinitionInput): Promise<CommandReceipt> => request(idPath('pipeline-definitions', id), commandReceiptSchema, { method: 'PATCH', body }),
    pipelineDefinitionAction: (id: string, name: PipelineDefinitionAction, body: ServiceActionInput): Promise<CommandReceipt> => action('pipeline-definitions', id, name, body),
    runPipelineDefinition: (id: string, body: RunPipelineDefinitionInput): Promise<CommandReceipt> => request(`${idPath('pipeline-definitions', id)}/runs`, commandReceiptSchema, { method: 'POST', body }),
    listServiceConfigs: (query: ServiceConfigQuery = {}): Promise<Page<ServiceConfig>> => request(queryPath('/service-configs', query), pageSchema(serviceConfigSchema)),
    getServiceConfig: (id: string): Promise<ServiceConfigDetail> => request(idPath('service-configs', id), serviceConfigDetailSchema),
    createServiceConfig: (body: CreateServiceConfigInput): Promise<CommandReceipt> => request('/service-configs', commandReceiptSchema, { method: 'POST', body }),
    patchServiceConfig: (id: string, body: PatchServiceConfigInput): Promise<CommandReceipt> => request(idPath('service-configs', id), commandReceiptSchema, { method: 'PATCH', body }),
    serviceConfigAction: (id: string, name: ServiceConfigAction, body: ServiceActionInput): Promise<CommandReceipt> => action('service-configs', id, name, body),
    reviseServiceConfig: (id: string, body: ServiceRevisionInput): Promise<CommandReceipt> => action('service-configs', id, 'revisions', body),
    restoreServiceConfig: (id: string, body: ServiceRevisionInput): Promise<CommandReceipt> => action('service-configs', id, 'restore', body),
    listTrafficPolicies: (query: TrafficPolicyQuery = {}): Promise<Page<TrafficPolicy>> => request(queryPath('/traffic-policies', query), pageSchema(trafficPolicySchema)),
    getTrafficPolicy: (id: string): Promise<TrafficPolicyDetail> => request(idPath('traffic-policies', id), trafficPolicyDetailSchema),
    createTrafficPolicy: (body: CreateTrafficPolicyInput): Promise<CommandReceipt> => request('/traffic-policies', commandReceiptSchema, { method: 'POST', body }),
    patchTrafficPolicy: (id: string, body: PatchTrafficPolicyInput): Promise<CommandReceipt> => request(idPath('traffic-policies', id), commandReceiptSchema, { method: 'PATCH', body }),
    trafficPolicyAction: (id: string, name: TrafficPolicyAction, body: ServiceActionInput): Promise<CommandReceipt> => action('traffic-policies', id, name, body),
    reviseTrafficPolicy: (id: string, body: ServiceRevisionInput): Promise<CommandReceipt> => action('traffic-policies', id, 'revisions', body),
  }
}
