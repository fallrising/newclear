import { z } from 'zod'
import { commandReceiptSchema, guideViewSchema, personaSchema, scenarioInputSchema, sessionViewSchema } from '../../domain/schemas'
import type { CommandReceipt, GuideView, Persona, SessionView } from '../../domain/schemas'
import { controlResultSchema } from '../control-dto'
import type { ApiRequest } from '../core/request'

export function createSessionClient(request: ApiRequest) {
  return {
    getSession: (): Promise<SessionView> => request('/session', sessionViewSchema),
    getPersonas: (): Promise<Persona[]> => request('/personas', z.array(personaSchema), { demo: true }),
    getGuide: (): Promise<GuideView> => request('/guide', guideViewSchema, { demo: true }),
    setPersona: async (personaId: string): Promise<SessionView> => (await request('/persona', controlResultSchema,
      { method: 'POST', demo: true, body: { personaId }, identityControl: true })).session,
    reset: async (): Promise<SessionView> => (await request('/reset', controlResultSchema,
      { method: 'POST', demo: true, body: { confirm: true }, identityControl: true })).session,
    advanceClock: (ticks: number): Promise<CommandReceipt> => request('/clock/advance', commandReceiptSchema,
      { method: 'POST', demo: true, body: { ticks } }),
    setScenario: (scenarioKey: z.infer<typeof scenarioInputSchema>['scenarioKey'],
      target: { jobId?: string; poolId?: string; runId?: string; releaseId?: string }): Promise<CommandReceipt> => request('/scenarios', commandReceiptSchema,
      { method: 'POST', demo: true, body: scenarioInputSchema.parse({ scenarioKey, ...target }) }),
  }
}
