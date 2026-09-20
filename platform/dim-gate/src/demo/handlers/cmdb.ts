import { DomainError } from '../../domain/engine'
import type { DemoController } from '../controller'

export function readDomainRoute(controller: DemoController, path: string, search: URLSearchParams,
  identity: Parameters<DemoController['read']>[2]) {
  return controller.read(path, search, identity)
}

export async function commandDomainRoute(controller: DemoController, method: string, path: string, body: unknown,
  key: string, identity: Parameters<DemoController['command']>[4]) {
  if (method === 'PATCH' || method === 'DELETE' || method === 'POST' && ['/cis', '/relations'].includes(path)) return controller.command(method, path, body, key, identity)
  controller.assertCurrent(identity)
  throw new DomainError(501, 'NOT_IMPLEMENTED', '這個操作尚未在 M1 交付，資料未變更。')
}
