import type { ContractContext } from '../contracts.ts'

export function registerServiceDeliveryContracts({ d, read, command }: ContractContext) {
  read('/applications/{id}/delivery-options', 'getDeliveryOptions', d.deliveryOptionsSchema, 'W3', d.deliveryOptionsQuerySchema)
  read('/pipeline-definitions', 'listPipelineDefinitions', d.pageSchema(d.pipelineDefinitionSchema), 'W3', d.pipelineDefinitionListQuerySchema)
  read('/pipeline-definitions/{id}', 'getPipelineDefinition', d.pipelineDefinitionDetailSchema, 'W3')
  command('post', '/pipeline-definitions', 'createPipelineDefinition', d.createPipelineDefinitionInputSchema, 'W3', 201)
  command('patch', '/pipeline-definitions/{id}', 'patchPipelineDefinition', d.patchPipelineDefinitionInputSchema, 'W3')
  for (const action of ['validate', 'submit', 'approve', 'reject', 'cancel', 'activate', 'revisions']) {
    command('post', `/pipeline-definitions/{id}/${action}`, `${action}PipelineDefinition`, d.serviceActionInputSchema, 'W3', action === 'revisions' ? 201 : 200)
  }
  command('post', '/pipeline-definitions/{id}/runs', 'runPipelineDefinition', d.runPipelineDefinitionInputSchema, 'W3', 202)
  read('/service-configs', 'listServiceConfigs', d.pageSchema(d.serviceConfigSchema), 'W3', d.serviceConfigListQuerySchema)
  read('/service-configs/{id}', 'getServiceConfig', d.serviceConfigDetailSchema, 'W3')
  command('post', '/service-configs', 'createServiceConfig', d.createServiceConfigInputSchema, 'W3', 201)
  command('patch', '/service-configs/{id}', 'patchServiceConfig', d.patchServiceConfigInputSchema, 'W3')
  for (const action of ['validate', 'submit', 'approve', 'reject', 'cancel', 'apply']) {
    command('post', `/service-configs/{id}/${action}`, `${action}ServiceConfig`, d.serviceActionInputSchema, 'W3', action === 'apply' ? 202 : 200)
  }
  command('post', '/service-configs/{id}/revisions', 'reviseServiceConfig', d.serviceRevisionInputSchema, 'W3', 201)
  command('post', '/service-configs/{id}/restore', 'restoreServiceConfig', d.serviceRevisionInputSchema, 'W3', 201)
  read('/traffic-policies', 'listTrafficPolicies', d.pageSchema(d.trafficPolicySchema), 'W3', d.trafficPolicyListQuerySchema)
  read('/traffic-policies/{id}', 'getTrafficPolicy', d.trafficPolicyDetailSchema, 'W3')
  command('post', '/traffic-policies', 'createTrafficPolicy', d.createTrafficPolicyInputSchema, 'W3', 201)
  command('patch', '/traffic-policies/{id}', 'patchTrafficPolicy', d.patchTrafficPolicyInputSchema, 'W3')
  for (const action of ['validate', 'submit', 'approve', 'reject', 'cancel', 'start']) {
    command('post', `/traffic-policies/{id}/${action}`, `${action}TrafficPolicy`, d.serviceActionInputSchema, 'W3', action === 'start' ? 202 : 200)
  }
  command('post', '/traffic-policies/{id}/revisions', 'reviseTrafficPolicy', d.serviceRevisionInputSchema, 'W3', 201)
}
