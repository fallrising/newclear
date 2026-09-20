import { delay, http, HttpResponse } from 'msw'
import { z } from 'zod'
import { DomainError } from '../domain/engine'
import type { DemoController } from './controller'
import { personaBodySchema, resetBodySchema } from '../api/control-dto'

const keySchema = z.string().regex(/^[\x21-\x7e]{1,128}$/)

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
        if (isDemo && path === '/personas') data = controller.getPersonas()
        else if (isDemo && path === '/guide') data = controller.read('/guide', url.searchParams, identity)
        else if (!isDemo) data = controller.read(path, url.searchParams, identity)
        else throw new DomainError(501, 'NOT_IMPLEMENTED', '這個示範功能尚未交付。')
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
        if (isDemo && request.method === 'POST' && path === '/persona') {
          const parsed = personaBodySchema.safeParse(body)
          if (!parsed.success) throw new DomainError(422, 'VALIDATION_ERROR', '身分切換僅接受 personaId。')
          data = await controller.setPersona(parsed.data.personaId, key!, identity)
        } else if (isDemo && request.method === 'POST' && path === '/reset') {
          if (!resetBodySchema.safeParse(body).success) throw new DomainError(422, 'VALIDATION_ERROR', '重置需要 confirm:true，且不接受其他欄位。')
          data = await controller.reset(key!, identity)
        } else if ((isDemo && request.method === 'POST' && path === '/clock/advance')
          || (!isDemo && (request.method === 'PATCH' || request.method === 'DELETE'))) {
          if (url.searchParams.size) throw new DomainError(422, 'VALIDATION_ERROR', 'Command 不接受 query 參數。')
          data = await controller.command(request.method, path, body, key!, identity)
        } else {
          controller.assertCurrent(identity)
          throw new DomainError(501, 'NOT_IMPLEMENTED', '這個操作尚未在 M0 交付，資料未變更。')
        }
      }
      const current = controller.getSession()
      return HttpResponse.json({ data, meta: { requestId, storeRevision: current.storeRevision, policyVersion: current.policyVersion } },
        { headers: { 'Cache-Control': 'no-store' } })
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
