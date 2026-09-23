import { delay, http, HttpResponse } from 'msw'
import { z } from 'zod'
import { runtimeOperations } from '../api/runtime-operations'
import { DomainError } from '../domain/engine'
import type { DemoController } from './controller'
import { commandDomainRoute, readDomainRoute } from './handlers/cmdb'
import { commandDemoRoute, readDemoRoute } from './handlers/core-session'

const keySchema = z.string().regex(/^[\x21-\x7e]{1,128}$/)
const operationPattern = (path: string) => new RegExp(`^${path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^/]+\}/g, '[^/]+')}$`)

export interface HandlerOptions {
  /** Absolute application base, including its trailing slash. */
  baseUrl?: string
  delayMs?: number
}

export function createHandlers(controller: DemoController, options: HandlerOptions = {}) {
  const baseUrl = (options.baseUrl ?? 'http://localhost/dim-gate/').replace(/\/?$/, '/')
  const apiRoot = new URL('api/v1', baseUrl).href
  const demoRoot = new URL('__demo/v1', baseUrl).href
  let requestSequence = 0
  const escape = (input: string) => input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matcher = new RegExp(`^(?:${escape(apiRoot)}|${escape(demoRoot)})(?:/[^?]*)?(?:\\?.*)?$`)
  return [http.all(matcher, async ({ request }) => {
    const requestId = `http-${String(++requestSequence).padStart(6, '0')}`
    try {
      const url = new URL(request.url)
      const isDemo = request.url.startsWith(demoRoot)
      const rootPath = new URL(isDemo ? demoRoot : apiRoot).pathname
      const path = url.pathname.slice(rootPath.length) || '/'
      if (!/^\/[A-Za-z0-9_/-]*$/.test(path) || path.includes('//')) {
        throw new DomainError(404, 'NOT_FOUND', '找不到此 API 路徑。')
      }
      const resetReplay = isDemo && path === '/reset' && request.method === 'POST'
      const identity = controller.authenticate(request.headers.get('X-Demo-Session'),
        request.headers.get('X-Demo-Persona'), resetReplay)
      for (const key of new Set(url.searchParams.keys())) {
        if (url.searchParams.getAll(key).length > 1 || isDemo) {
          throw new DomainError(422, 'VALIDATION_ERROR', '不支援重複或未知的 query 參數。', { [key]: ['不支援此 query 參數'] })
        }
      }
      await delay(options.delayMs ?? 150)
      let data: unknown
      if (request.method === 'GET') {
        controller.assertCurrent(identity)
        data = isDemo ? readDemoRoute(controller, path, url.searchParams, identity)
          : readDomainRoute(controller, path, url.searchParams, identity)
      } else {
        const key = request.headers.get('Idempotency-Key')
        if (!keySchema.safeParse(key).success) {
          throw new DomainError(422, 'VALIDATION_ERROR', '需要有效的 Idempotency-Key。', { 'Idempotency-Key': ['必填，1–128 個可見 ASCII 字元'] })
        }
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') ?? '')) {
          throw new DomainError(415, 'UNSUPPORTED_MEDIA_TYPE', 'API 僅接受 application/json。')
        }
        let body: unknown
        try {
          const text = await request.text()
          if (new TextEncoder().encode(text).byteLength > 64 * 1024) throw new Error('Body too large')
          body = JSON.parse(text)
        } catch {
          throw new DomainError(422, 'VALIDATION_ERROR', '請提供 64 KiB 以內的有效 JSON 內容。')
        }
        data = isDemo
          ? await commandDemoRoute(controller, request.method, path, body, key!, identity)
          : await commandDomainRoute(controller, request.method, path, body, key!, identity)
      }
      const current = controller.getSession()
      const operation = runtimeOperations.find((entry) => entry.demo === isDemo && entry.method === request.method.toLowerCase()
        && operationPattern(entry.path).test(path))
      return HttpResponse.json({ data, meta: { requestId, storeRevision: current.storeRevision, policyVersion: current.policyVersion } },
        { status: operation?.status ?? 200, headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      const known = error instanceof DomainError
      const status = known ? error.status : 500
      return HttpResponse.json({
        error: { code: known ? error.code : 'INTERNAL_ERROR',
          message: known ? error.message : '示範 API 發生未預期的錯誤。',
          ...(known && error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
          retryable: status === 503 },
        meta: { requestId },
      }, { status, headers: { 'Cache-Control': 'no-store' } })
    }
  })]
}
