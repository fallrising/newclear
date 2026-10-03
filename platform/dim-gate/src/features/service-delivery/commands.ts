import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiRequestError, getClientIdentity } from '../../api/client'
import { serviceDeliveryMutationKey } from '../../api/query-definitions'
import { sameIdentity, type ClientIdentity } from '../../api/core/identity'
import type { CommandReceipt } from '../../domain/schemas'

const affectedFamilies = new Set(['session', 'pipeline-definitions', 'pipeline-definition', 'service-configs', 'service-config', 'traffic-policies', 'traffic-policy', 'delivery-options', 'pipelines', 'pipeline', 'releases', 'release', 'application', 'applications', 'environment', 'environments', 'audit', 'work-items', 'workspace-home', 'dashboard', 'notifications', 'guide', 'monitor-policies', 'monitor-policy', 'alert-rules', 'alert-rule', 'slo-policies', 'slo-policy', 'silences', 'alert-evaluations', 'notification-deliveries', 'incidents', 'incident', 'metrics'])

/** Keep the canonical receipt if readback fails: retry only reads, never a second command. */
export function useServiceCommand(readBack: (receipt: CommandReceipt) => Promise<unknown>, mutationKey: readonly string[] = serviceDeliveryMutationKey) {
  const cache = useQueryClient()
  const completed = useRef<{ receipt: CommandReceipt; identity: ClientIdentity } | null>(null)
  const [committed, setCommitted] = useState(false)
  const mutation = useMutation({ mutationKey, mutationFn: async (command: () => Promise<CommandReceipt>) => {
    const identity = completed.current?.identity ?? getClientIdentity()
    if (!identity) throw new Error('示範身分尚未初始化。')
    const ensureIdentity = () => {
      const current = getClientIdentity()
      if (!current || !sameIdentity(identity, current)) throw new ApiRequestError('STALE_RESPONSE', '身分或授權已改變，請由目前工作區重新讀取。', 'service-readback', false, 409)
    }
    ensureIdentity()
    const receipt = completed.current?.receipt ?? await command()
    completed.current = { receipt, identity }
    setCommitted(true)
    ensureIdentity()
    await readBack(receipt)
    await cache.invalidateQueries({ predicate: query => affectedFamilies.has(String(query.queryKey[3])) }, { throwOnError: true })
    ensureIdentity()
    return receipt
  } })
  return { ...mutation, committed, reset: () => { completed.current = null; setCommitted(false); mutation.reset() } }
}
