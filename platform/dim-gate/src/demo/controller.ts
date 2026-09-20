import { z } from 'zod'
import { createEngine, DomainError } from '../domain/engine'
import { snapshotSchema, sessionViewSchema } from '../domain/schemas'
import type { CommandReceipt, SessionView, Snapshot } from '../domain/schemas'
import { createSeed, personas } from './seed'

export const SNAPSHOT_KEY = 'dim-gate.demo.v1'
const MAX_BYTES = 3 * 1024 * 1024
const MAX_COMMANDS = 1_000

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export class DemoStorageError extends Error {
  readonly recoveryAvailable = true
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'DemoStorageError'
  }
}

const controlRecordSchema = z.object({
  sessionId: z.string(), actorId: z.string(), key: z.string(), body: z.string(),
  session: sessionViewSchema,
}).strict()
const savedSchema = z.object({
  formatVersion: z.literal(1), snapshot: snapshotSchema, tabOwnershipId: z.string().min(1),
  personaId: z.string(), identityEpoch: z.number().int().nonnegative(),
  generation: z.number().int().nonnegative(),
  personaCommands: z.array(controlRecordSchema).max(MAX_COMMANDS),
  resetTombstone: controlRecordSchema.nullable(),
}).strict()
type Saved = z.infer<typeof savedSchema>
export interface RequestIdentity {
  sessionId: string
  actorId: string
  identityEpoch: number
  generation: number
  policyVersion: number
}

export interface ControllerOptions {
  storage: StorageLike | null
  createSessionId: () => string
  mode?: 'session' | 'memory'
  recovery?: 'reset'
  forked?: boolean
  maxBytes?: number
  timers?: {
    setTimeout(callback: () => void, milliseconds: number): unknown
    clearTimeout(handle: unknown): void
  }
}

/** Synchronous storage writes are the transaction boundary for both identity and domain. */
export function createController(options: ControllerOptions) {
  const mode = options.mode ?? 'session'
  const listeners = new Set<() => void>()
  const activeTimers = new Set<unknown>()
  const timers = options.timers ?? {
    setTimeout: (callback: () => void, ms: number) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
  const fresh = (): Saved => {
    const sessionId = options.createSessionId()
    return { formatVersion: 1, snapshot: createSeed(sessionId), tabOwnershipId: sessionId,
      personaId: 'user-rd-commerce', identityEpoch: 0, generation: 0,
      personaCommands: [], resetTombstone: null }
  }
  const write = (next: Saved) => {
    let serialized: string
    try {
      serialized = JSON.stringify(next)
      if (new TextEncoder().encode(serialized).byteLength > (options.maxBytes ?? MAX_BYTES)) {
        throw new Error('Snapshot exceeds persistence budget')
      }
      if (mode === 'session') {
        if (!options.storage) throw new Error('sessionStorage unavailable')
        options.storage.setItem(SNAPSHOT_KEY, serialized)
      }
    } catch {
      throw new DomainError(507, 'DEMO_STORAGE_FULL', '示範資料尚未儲存。請重置資料，或明確選擇暫存記憶體模式。')
    }
  }
  let saved: Saved
  if (mode === 'memory' || options.recovery === 'reset') {
    saved = fresh()
  } else {
    let raw: string | null
    try {
      if (!options.storage) throw new Error('sessionStorage unavailable')
      raw = options.storage.getItem(SNAPSHOT_KEY)
    } catch {
      throw new DemoStorageError('DEMO_STORAGE_UNAVAILABLE', '無法讀取分頁儲存空間。你可以明確選擇暫存記憶體模式。')
    }
    if (raw === null) saved = fresh()
    else {
      if (new TextEncoder().encode(raw).byteLength > (options.maxBytes ?? MAX_BYTES)) {
        throw new DemoStorageError('DEMO_SNAPSHOT_INCOMPATIBLE', '示範存檔超過容量上限，請選擇重置或暫存記憶體模式。原存檔尚未修改。')
      }
      let decoded: unknown
      try { decoded = JSON.parse(raw) } catch {
        throw new DemoStorageError('DEMO_SNAPSHOT_CORRUPT', '示範資料已損壞，請選擇重置或暫存記憶體模式。原存檔尚未修改。')
      }
      const parsed = savedSchema.safeParse(decoded)
      if (!parsed.success) {
        throw new DemoStorageError('DEMO_SNAPSHOT_INCOMPATIBLE', '示範存檔版本或內容不相容，請選擇重置或暫存記憶體模式。原存檔尚未修改。')
      }
      saved = parsed.data
    }
  }
  if (options.forked) {
    const sessionId = options.createSessionId()
    saved = { ...saved, snapshot: { ...saved.snapshot, sessionId }, tabOwnershipId: sessionId,
      identityEpoch: saved.identityEpoch + 1, generation: saved.generation + 1,
      personaCommands: [], resetTombstone: null }
  }
  const makeEngine = () => {
    const generation = saved.generation
    const sessionId = saved.snapshot.sessionId
    return createEngine(saved.snapshot, (next) => {
      if (saved.generation !== generation || saved.snapshot.sessionId !== sessionId) {
        throw new DomainError(409, 'STALE_IDENTITY', '這項操作屬於已結束的示範 session。')
      }
      if (next.commandCount + saved.personaCommands.length > MAX_COMMANDS) {
        throw new DomainError(429, 'DEMO_COMMAND_LIMIT', '示範操作已達上限，請重置後繼續。')
      }
      const nextSaved = { ...saved, snapshot: next,
        identityEpoch: saved.identityEpoch + Number(next.policyVersion !== saved.snapshot.policyVersion) }
      write(nextSaved)
      saved = nextSaved
    })
  }
  let engine: ReturnType<typeof createEngine>
  try { engine = makeEngine() } catch {
    throw new DemoStorageError('DEMO_SNAPSHOT_INCOMPATIBLE', '示範存檔的資料關係不相容，請選擇重置或暫存記憶體模式。原存檔尚未修改。')
  }
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(operation: () => T | Promise<T>): Promise<T> => {
    const pending = queue.then(operation)
    queue = pending.catch(() => undefined)
    return pending
  }
  const notify = () => {
    for (const listener of listeners) {
      try { listener() } catch { /* Observers cannot roll back a committed command. */ }
    }
  }
  const getSession = (): SessionView => sessionViewSchema.parse({
    ...(engine.read('/session', new URLSearchParams(), saved.personaId) as object),
    identityEpoch: saved.identityEpoch, generation: saved.generation, storageMode: mode,
  })
  // Validate persisted persona through the domain evaluator, never trust stored grants.
  try { getSession() } catch {
    throw new DemoStorageError('DEMO_SNAPSHOT_INCOMPATIBLE', '存檔的示範身分無效，請重置資料。')
  }
  try { write(saved) } catch {
    throw new DemoStorageError('DEMO_STORAGE_UNAVAILABLE', '無法儲存此示範 session。你可以明確選擇暫存記憶體模式。')
  }
  const assertCurrent = (identity: RequestIdentity) => {
    if (identity.sessionId !== saved.snapshot.sessionId || identity.actorId !== saved.personaId
      || identity.identityEpoch !== saved.identityEpoch || identity.generation !== saved.generation
      || identity.policyVersion !== saved.snapshot.policyVersion) {
      throw new DomainError(409, 'STALE_IDENTITY', '身分或權限已變更，請重新讀取資料。')
    }
  }
  const authenticate = (sessionId: string | null, actorId: string | null, allowResetReplay = false): RequestIdentity => {
    const resetReplay = allowResetReplay && saved.resetTombstone?.sessionId === sessionId
      && saved.resetTombstone.actorId === actorId
    if (!sessionId || !actorId || (sessionId !== saved.snapshot.sessionId && !resetReplay)) {
      throw new DomainError(401, 'UNAUTHENTICATED', '示範 session 或身分無效。')
    }
    engine.read('/session', new URLSearchParams(), actorId)
    return { sessionId, actorId, identityEpoch: saved.identityEpoch,
      generation: saved.generation, policyVersion: saved.snapshot.policyVersion }
  }
  const clearTimers = () => {
    for (const timer of activeTimers) timers.clearTimeout(timer)
    activeTimers.clear()
  }
  const checkKey = (key: string) => {
    if (!/^[\x21-\x7e]{1,128}$/.test(key)) {
      throw new DomainError(422, 'VALIDATION_ERROR', '需要 1–128 個可見 ASCII 字元的 Idempotency-Key。')
    }
  }
  return {
    getSession,
    getTabOwnershipId: () => saved.tabOwnershipId,
    getSnapshot: (): Snapshot => engine.getSnapshot(),
    getPersonas: () => structuredClone(personas),
    authenticate, assertCurrent,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    read(path: string, query: URLSearchParams, identity: RequestIdentity): unknown {
      assertCurrent(identity)
      if (path === '/session') {
        engine.read(path, query, identity.actorId) // Preserve strict query validation.
        return getSession()
      }
      return engine.read(path, query, identity.actorId)
    },
    command(method: string, path: string, body: unknown, key: string, identity: RequestIdentity): Promise<CommandReceipt> {
      return serial(async () => {
        assertCurrent(identity)
        checkKey(key)
        const receipt = await engine.command({ sessionId: identity.sessionId, actorId: identity.actorId, method, path, key, body })
        notify()
        return receipt
      })
    },
    setPersona(personaId: string, key: string, identity: RequestIdentity): Promise<{ session: SessionView }> {
      return serial(() => {
        checkKey(key)
        engine.read('/session', new URLSearchParams(), identity.actorId)
        const body = JSON.stringify({ personaId })
        const replay = saved.personaCommands.find((item) => item.sessionId === identity.sessionId
          && item.actorId === identity.actorId && item.key === key)
        if (replay) {
          if (replay.body !== body) throw new DomainError(409, 'IDEMPOTENCY_CONFLICT', '同一操作 key 不能改用另一組內容。')
          if (replay.session.policyVersion !== saved.snapshot.policyVersion) {
            throw new DomainError(409, 'STALE_IDENTITY', '角色權限已改變，請重新讀取目前身分。')
          }
          return { session: structuredClone(replay.session) }
        }
        assertCurrent(identity)
        engine.read('/session', new URLSearchParams(), personaId)
        if (saved.snapshot.commandCount + saved.personaCommands.length >= MAX_COMMANDS) {
          throw new DomainError(429, 'DEMO_COMMAND_LIMIT', '示範操作已達上限，請重置後繼續。')
        }
        const domain = engine.read('/session', new URLSearchParams(), personaId) as object
        const session = sessionViewSchema.parse({ ...domain, identityEpoch: saved.identityEpoch + 1,
          generation: saved.generation, storageMode: mode })
        const next: Saved = { ...saved, personaId, identityEpoch: session.identityEpoch,
          personaCommands: [...saved.personaCommands, { sessionId: identity.sessionId, actorId: identity.actorId, key, body, session }] }
        write(next)
        saved = next
        notify()
        return { session: structuredClone(session) }
      })
    },
    reset(key: string, identity: RequestIdentity): Promise<{ session: SessionView }> {
      return serial(() => {
        checkKey(key)
        engine.read('/session', new URLSearchParams(), identity.actorId)
        const old = saved.resetTombstone
        if (old?.sessionId === identity.sessionId && old.actorId === identity.actorId && old.key === key) {
          if (old.session.policyVersion !== saved.snapshot.policyVersion) {
            throw new DomainError(409, 'STALE_IDENTITY', '角色權限已改變，請重新讀取目前身分。')
          }
          return { session: structuredClone(old.session) }
        }
        assertCurrent(identity)
        const snapshot = createSeed(options.createSessionId())
        const generation = saved.generation + 1
        const identityEpoch = saved.identityEpoch + 1
        const freshEngine = createEngine(snapshot, () => { throw new Error('Reset preview is read-only') })
        const session = sessionViewSchema.parse({
          ...(freshEngine.read('/session', new URLSearchParams(), saved.personaId) as object),
          generation, identityEpoch, storageMode: mode,
        })
        const next: Saved = { ...saved, snapshot, generation, identityEpoch, personaCommands: [],
          resetTombstone: { sessionId: identity.sessionId, actorId: identity.actorId, key, body: '{"confirm":true}', session } }
        write(next)
        clearTimers()
        saved = next
        engine = makeEngine()
        notify()
        return { session: structuredClone(session) }
      })
    },
    /** Used once after a copied sessionStorage is detected by browser tab ownership. */
    forkSession() {
      const sessionId = options.createSessionId()
      const next: Saved = { ...saved, snapshot: { ...saved.snapshot, sessionId }, tabOwnershipId: sessionId,
        identityEpoch: saved.identityEpoch + 1, generation: saved.generation + 1,
        personaCommands: [], resetTombstone: null }
      write(next)
      clearTimers()
      saved = next
      engine = makeEngine()
      notify()
    },
    schedule(callback: () => void, milliseconds: number) {
      const generation = saved.generation
      const handle = timers.setTimeout(() => {
        activeTimers.delete(handle)
        if (generation === saved.generation) callback()
      }, milliseconds)
      activeTimers.add(handle)
      return () => { timers.clearTimeout(handle); activeTimers.delete(handle) }
    },
    dispose() { clearTimers(); listeners.clear() },
  }
}

export type DemoController = ReturnType<typeof createController>
let browserController: DemoController | undefined
export function getController(): DemoController {
  if (!browserController) throw new Error('Demo controller has not started')
  return browserController
}
export function registerController(controller: DemoController) {
  browserController = controller
}
