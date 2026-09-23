import { ApiRequestError } from './errors'
import { sameIdentity, type ClientIdentity } from './identity'

/** Defer feature transport code, while binding each call to its original identity. */
export function deferredClient<T extends object>(load: () => Promise<T>,
  methods: { [K in keyof T]: true }, identity: () => ClientIdentity | null): T {
  let loading: Promise<T> | undefined
  return Object.fromEntries(Object.keys(methods).map(name => [name, async (...args: unknown[]) => {
    const original = identity()
    if (!original) throw new ApiRequestError('NOT_INITIALIZED', '示範 session 尚未初始化。', 'client-startup', false, 401)
    const input = structuredClone(args)
    loading ??= load().catch(error => { loading = undefined; throw error })
    const client = await loading
    const current = identity()
    if (!current || !sameIdentity(original, current)) {
      throw new ApiRequestError('STALE_RESPONSE', '身分或權限已變更，已忽略舊操作。', 'client-stale', false, 409)
    }
    return (client[name as keyof T] as (...input: unknown[]) => unknown)(...input)
  }])) as T
}
