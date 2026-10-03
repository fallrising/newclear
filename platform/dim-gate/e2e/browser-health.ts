import { expect, type Page, type Request, type TestInfo } from '@playwright/test'
import { controlResultSchema } from '../src/api/control-dto'
import { apiErrorSchema } from '../src/domain/schemas'

type Identity = { sessionId: string; actorId: string }
type ResponseEvidence = { method: string; status: number; url: string; identity: Identity; startedAt: number; respondedAt: number }
type HttpError = ResponseEvidence & { payload?: unknown; staleIdentityWithoutData?: boolean }
type IdentityTransition = ResponseEvidence & { next: Identity }
export type BrowserHealth = {
  console: { type: string; text: string }[]; network: ResponseEvidence[]
  consoleErrors: string[]; pageErrors: string[]; failedRequests: string[]
  httpErrors: HttpError[]; identityTransitions: IdentityTransition[]
  expectedStatuses: Set<number>; pendingDetails: Promise<void>[]
}

export function captureBrowserHealth(page: Page): BrowserHealth {
  const evidence: BrowserHealth = { console: [], network: [], consoleErrors: [], pageErrors: [], failedRequests: [], httpErrors: [], identityTransitions: [], expectedStatuses: new Set(), pendingDetails: [] }
  const starts = new WeakMap<Request, number>()
  page.on('request', request => starts.set(request, Date.now()))
  page.on('console', message => { evidence.console.push({ type: message.type(), text: message.text() }); if (message.type() === 'error') evidence.consoleErrors.push(message.text()) })
  page.on('pageerror', error => evidence.pageErrors.push(error.message))
  page.on('requestfailed', request => evidence.failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`))
  page.on('response', response => {
    const request = response.request(), headers = request.headers()
    const entry: ResponseEvidence = { method: request.method(), status: response.status(), url: response.url(), identity: { sessionId: headers['x-demo-session'] ?? '', actorId: headers['x-demo-persona'] ?? '' }, startedAt: starts.get(request) ?? Number.POSITIVE_INFINITY, respondedAt: Date.now() }
    evidence.network.push(entry)
    const error: HttpError | undefined = entry.status >= 400 ? { ...entry } : undefined
    if (error) evidence.httpErrors.push(error)
    const control = entry.method === 'POST' && entry.status === 200 && /\/dim-gate\/__demo\/v1\/(reset|persona)$/.test(new URL(entry.url).pathname)
    if (!error && !control) return
    evidence.pendingDetails.push((async () => {
      try {
        const payload: unknown = await response.json()
        if (error) {
          error.payload = payload
          // Strict error schema rejects envelopes containing domain data.
          const parsed = apiErrorSchema.safeParse(payload)
          error.staleIdentityWithoutData = parsed.success && parsed.data.error.code === 'STALE_IDENTITY'
        } else {
          const parsed = controlResultSchema.safeParse((payload as { data?: unknown })?.data)
          if (parsed.success) evidence.identityTransitions.push({ ...entry, next: { sessionId: parsed.data.session.sessionId, actorId: parsed.data.session.user.id } })
        }
      } catch { /* Unreadable responses stay unclassified and fail the health gate. */ }
    })())
  })
  return evidence
}

function isRetiredApplicationRead(evidence: BrowserHealth, error: HttpError) {
  if (error.status !== 409 || error.method !== 'GET' || !error.staleIdentityWithoutData
    || !/^\/dim-gate\/api\/v1\/applications(?:\/[^/]+)?$/.test(new URL(error.url).pathname)
    || !error.identity.sessionId || !error.identity.actorId) return false
  return evidence.identityTransitions.some(transition =>
    transition.identity.sessionId === error.identity.sessionId && transition.identity.actorId === error.identity.actorId
    && (transition.next.sessionId !== error.identity.sessionId || transition.next.actorId !== error.identity.actorId)
    && error.startedAt <= transition.respondedAt && error.respondedAt >= transition.startedAt)
}

export async function verifyBrowserHealth(page: Page, info: TestInfo, evidence: BrowserHealth) {
  await Promise.all(evidence.pendingDetails)
  const retiredReads = evidence.httpErrors.filter(error => isRetiredApplicationRead(evidence, error))
  const { expectedStatuses } = evidence
  const serializable = { ...evidence, pendingDetails: undefined }
  await info.attach('browser-health', { body: JSON.stringify({ ...serializable, expectedStatuses: [...expectedStatuses], retiredReads }, null, 2), contentType: 'application/json' })
  if (!page.isClosed()) {
    await info.attach('visible-dom', { body: await page.locator('body').innerText(), contentType: 'text/plain' })
    await info.attach('final-screen', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  }
  if (info.status !== info.expectedStatus) return
  expect(evidence.pageErrors).toEqual([])
  expect(evidence.failedRequests).toEqual([])
  expect(evidence.httpErrors.filter(error => !expectedStatuses.has(error.status) && !retiredReads.includes(error))).toEqual([])
  let remainingRetiredConsole = retiredReads.length
  expect(evidence.consoleErrors.filter(message => {
    if ([...expectedStatuses].some(status => message.includes(`status of ${status}`))) return false
    if (remainingRetiredConsole > 0 && /^Failed to load resource: the server responded with a status of 409 \(Conflict\)$/.test(message)) { remainingRetiredConsole--; return false }
    return true
  })).toEqual([])
}
