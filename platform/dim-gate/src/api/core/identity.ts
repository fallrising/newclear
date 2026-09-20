import type { SessionView } from '../../domain/schemas'

export interface ClientIdentity {
  sessionId: string
  actorId: string
  identityEpoch: number
  generation: number
  policyVersion: number
}

export interface ClientConfiguration {
  session: SessionView
  baseUrl?: string
  fetch?: typeof fetch
  createKey?: () => string
}

export const identityOf = (session: SessionView): ClientIdentity => ({
  sessionId: session.sessionId, actorId: session.user.id, identityEpoch: session.identityEpoch,
  generation: session.generation, policyVersion: session.policyVersion,
})

export const sameIdentity = (left: ClientIdentity, right: ClientIdentity) => left.sessionId === right.sessionId
  && left.actorId === right.actorId && left.identityEpoch === right.identityEpoch
  && left.generation === right.generation && left.policyVersion === right.policyVersion
