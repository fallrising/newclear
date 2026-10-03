import type { ChangeInput } from './schemas'

export function resourceConflictKey(input: ChangeInput) {
  if (input.kind === 'kafka.topic.create') return JSON.stringify([input.targetCiId, 'kafka_topic', input.namespace ?? '', input.topicName.toLowerCase()])
  if (input.kind === 'resource.resize') return `object:${input.resourceObjectId}`
  return input.mode === 'existing' ? JSON.stringify([input.environmentId, input.resourceObjectId, input.purpose]) : undefined
}
