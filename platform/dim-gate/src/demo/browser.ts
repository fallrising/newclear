import { setupWorker } from 'msw/browser'
import { configureClient, updateClientSession } from '../api/client'
import { createController, DemoStorageError, registerController } from './controller'
import type { DemoController, StorageLike } from './controller'
import { createHandlers } from './handlers'

export class DemoStartupError extends Error {
  constructor(public readonly code: string, message: string, public readonly recoveryAvailable = false) {
    super(message)
    this.name = 'DemoStartupError'
  }
}

export interface TabClaim { release(): void }
/** Web Locks end with the owning document, unlike sessionStorage copied into a new tab. */
export async function claimTabSession(sessionId: string, locks: LockManager = navigator.locks): Promise<TabClaim | null> {
  if (!locks) throw new DemoStartupError('TAB_COORDINATION_UNAVAILABLE', '此瀏覽器無法隔離示範分頁。請使用支援 Web Locks 的瀏覽器與 HTTPS 或 localhost。')
  return new Promise((resolve, reject) => {
    void locks.request(`dim-gate.demo.session.${sessionId}`, { ifAvailable: true }, async (lock) => {
      if (!lock) { resolve(null); return }
      await new Promise<void>((release) => resolve({ release }))
    }).catch(reject)
  })
}

let worker: ReturnType<typeof setupWorker> | undefined
let controller: DemoController | undefined
let claim: TabClaim | null = null
let unsubscribe: (() => void) | undefined
let starting: Promise<void> | undefined
let started = false
let recoveryAvailable = false

async function boot(recovery?: 'reset' | 'memory') {
  recoveryAvailable = false
  let storage: StorageLike | null = null
  try { storage = window.sessionStorage } catch { /* Expose a recoverable startup failure below. */ }
  try {
    controller = createController({ storage, createSessionId: () => crypto.randomUUID(),
      ...(recovery === 'memory' ? { mode: 'memory' } : {}),
      ...(recovery === 'reset' ? { recovery: 'reset' } : {}) })
    claim = await claimTabSession(controller.getTabOwnershipId())
    if (!claim) {
      controller.forkSession()
      claim = await claimTabSession(controller.getTabOwnershipId())
      if (!claim) throw new DemoStartupError('TAB_COORDINATION_FAILED', '無法建立獨立示範 session，請重新開啟此頁。')
    }
    const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href
    worker ??= setupWorker()
    worker.resetHandlers(...createHandlers(controller, { baseUrl }))
    await worker.start({
      serviceWorker: { url: new URL('mockServiceWorker.js', baseUrl).href,
        options: { scope: new URL(baseUrl).pathname } },
      onUnhandledRequest(request, print) {
        if (request.url.startsWith(new URL('api/', baseUrl).href)
          || request.url.startsWith(new URL('__demo/', baseUrl).href)) print.error()
      },
      quiet: true,
    })
    configureClient({ session: controller.getSession(), baseUrl })
    registerController(controller)
    unsubscribe = controller.subscribe(() => { if (controller) updateClientSession(controller.getSession()) })
    // The browser releases Web Locks when this document ends. Do not release on
    // pagehide: a document restored from the back/forward cache still owns its tab.
    started = true
  } catch (error) {
    unsubscribe?.()
    controller?.dispose()
    claim?.release()
    claim = null
    if (error instanceof DemoStorageError) {
      recoveryAvailable = true
      throw new DemoStartupError(error.code, error.message, true)
    }
    if (error instanceof DemoStartupError) throw error
    throw new DemoStartupError('DEMO_STARTUP_FAILED', '示範服務無法啟動。請確認 Service Worker、HTTPS／localhost 與瀏覽器設定。')
  }
}

export async function startDemo(mode: string | undefined): Promise<void> {
  if (!mode) throw new DemoStartupError('DATA_MODE_REQUIRED', '請明確設定 VITE_DATA_MODE=demo，再啟動應用。')
  if (mode !== 'demo') throw new DemoStartupError('LIVE_MODE_UNAVAILABLE', '此版本尚未提供 live API；請使用明確的 demo 模式。')
  if (started) return
  starting ??= boot().finally(() => { starting = undefined })
  return starting
}

/** Called only by an explicit recovery action; memory never overwrites the damaged saved data. */
export async function recoverDemoStorage(choice: 'reset' | 'memory'): Promise<void> {
  if (started) return
  if (!recoveryAvailable) throw new DemoStartupError('RECOVERY_NOT_AVAILABLE', '目前沒有可復原的儲存錯誤。請先啟動明確的 demo 模式。')
  starting ??= boot(choice).finally(() => { starting = undefined })
  return starting
}
