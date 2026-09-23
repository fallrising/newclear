import type { ContractContext } from '../contracts.ts'

export function registerResourceContracts({ d, s, read, command }: ContractContext) {
  read('/resource-objects', 'listResourceObjects', d.pageSchema(s.ResourceObject), 'W2', d.resourceObjectListQuerySchema)
  read('/resource-objects/{id}', 'getResourceObject', s.ResourceObject, 'W2')
  read('/bindings', 'listBindings', d.pageSchema(s.ResourceBinding), 'W2', d.resourceBindingListQuerySchema)
  read('/bindings/{id}', 'getBinding', s.ResourceBinding, 'W2')
  read('/resource-inventory', 'listResourceInventory', d.pageSchema(s.ResourceInventory), 'W2', d.resourceInventoryQuerySchema)
  read('/resource-inventory/{ciId}', 'getResourceInventory', s.ResourceInventory, 'W2')
  read('/applications/{id}/resources', 'getServiceResources', s.ServiceResources, 'W2', d.serviceResourcesQuerySchema)
  read('/work-items', 'listWorkItems', d.pageSchema(s.WorkItem), 'W2', d.workItemListQuerySchema)
  read('/changes', 'listChanges', d.pageSchema(s.ChangeRequest), 'W2', d.changeListQuerySchema)
  read('/changes/{id}', 'getChange', s.ChangeDetail, 'W2')
  command('post', '/changes', 'createChange', s.CreateChange, 'W2', 201)
  command('patch', '/changes/{id}', 'patchChange', s.PatchChange, 'W2')
  for (const action of ['submit', 'approve', 'reject', 'cancel', 'execute', 'retry']) {
    command('post', `/changes/{id}/${action}`, `${action}Change`, ['submit', 'execute'].includes(action) ? s.VersionCommand : s.ReasonCommand, 'W2', action === 'execute' ? 202 : 200)
  }
}
