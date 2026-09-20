import { DomainError } from '../../domain/engine'
import { personaBodySchema, resetBodySchema } from '../../api/control-dto'
import type { DemoController } from '../controller'

export function readDemoRoute(controller: DemoController, path: string, search: URLSearchParams, identity: Parameters<DemoController['read']>[2]) {
  if (path === '/personas') return controller.getPersonas()
  if (path === '/guide') return controller.read('/guide', search, identity)
  throw new DomainError(501, 'NOT_IMPLEMENTED', '這個示範功能尚未交付。')
}

export async function commandDemoRoute(controller: DemoController, method: string, path: string, body: unknown,
  key: string, identity: Parameters<DemoController['command']>[4]) {
  if (method === 'POST' && path === '/persona') {
    const parsed = personaBodySchema.safeParse(body)
    if (!parsed.success) throw new DomainError(422, 'VALIDATION_ERROR', '身分切換僅接受 personaId。')
    return controller.setPersona(parsed.data.personaId, key, identity)
  }
  if (method === 'POST' && path === '/reset') {
    if (!resetBodySchema.safeParse(body).success) throw new DomainError(422, 'VALIDATION_ERROR', '重置需要 confirm:true，且不接受其他欄位。')
    return controller.reset(key, identity)
  }
  if (method === 'POST' && path === '/clock/advance') return controller.command(method, path, body, key, identity)
  if (method === 'POST' && path === '/scenarios') return controller.command(method, path, body, key, identity)
  controller.assertCurrent(identity)
  throw new DomainError(501, 'NOT_IMPLEMENTED', '這個示範功能尚未交付。')
}
