const PROBLEM_MEDIA_TYPE = "application/problem+json"
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

export type Violation = {
  readonly field: string
  readonly message: string
}

export type ApiProblem = {
  readonly type: string
  readonly title: string
  readonly status: number
  readonly detail: string
  readonly instance: string
  readonly code: string
  readonly requestId: string
  readonly violations?: readonly Violation[]
}

type CsrfState = {
  readonly headerName: string
  readonly token: string
}

type ApiRequestOptions = Omit<RequestInit, "body" | "credentials"> & {
  readonly body?: unknown
}

let csrfState: CsrfState | null = null

export class ApiError extends Error {
  readonly type: string
  readonly title: string
  readonly status: number
  readonly detail: string
  readonly instance: string
  readonly code: string
  readonly requestId: string
  readonly violations: readonly Violation[]

  constructor(problem: ApiProblem) {
    super(problem.detail)
    this.name = "ApiError"
    this.type = problem.type
    this.title = problem.title
    this.status = problem.status
    this.detail = problem.detail
    this.instance = problem.instance
    this.code = problem.code
    this.requestId = problem.requestId
    this.violations = problem.violations ?? []
  }
}

export class CsrfUnavailableError extends Error {
  constructor() {
    super("A security token is not available. Refresh the page and try again.")
    this.name = "CsrfUnavailableError"
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== ""
}

function isViolationArray(value: unknown): value is readonly Violation[] {
  return (
    Array.isArray(value) &&
    value.every(
      (violation): violation is Violation =>
        isRecord(violation) &&
        isNonEmptyString(violation.field) &&
        isNonEmptyString(violation.message)
    )
  )
}

function parseProblem(response: Response, body: unknown): ApiProblem | null {
  if (!isRecord(body)) return null
  if (!isNonEmptyString(body.type)) return null
  if (!isNonEmptyString(body.title)) return null
  if (typeof body.status !== "number" || !Number.isInteger(body.status)) return null
  if (!isNonEmptyString(body.detail)) return null
  if (!isNonEmptyString(body.instance)) return null
  if (!isNonEmptyString(body.code)) return null
  if (!isNonEmptyString(body.requestId) || !SAFE_REQUEST_ID.test(body.requestId)) {
    return null
  }
  if (body.status !== response.status) return null
  if (body.violations !== undefined && !isViolationArray(body.violations)) {
    return null
  }

  return {
    type: body.type,
    title: body.title,
    status: body.status,
    detail: body.detail,
    instance: body.instance,
    code: body.code,
    requestId: body.requestId,
    violations: body.violations,
  }
}

function resolveSameOriginPath(path: string): string {
  const resolved = new URL(path, window.location.origin)
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    resolved.origin !== window.location.origin
  ) {
    throw new Error("API requests must use a same-origin absolute path.")
  }
  return `${resolved.pathname}${resolved.search}${resolved.hash}`
}

async function throwForNonOk(response: Response, fallback: string): Promise<never> {
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase()

  if (contentType === PROBLEM_MEDIA_TYPE) {
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new Error(fallback)
    }

    const problem = parseProblem(response, body)
    if (problem !== null) {
      if (problem.code === "CSRF_TOKEN_INVALID") {
        csrfState = null
      }
      throw new ApiError(problem)
    }
  }

  throw new Error(fallback)
}

export async function apiRequest<T>(
  path: string,
  { body, headers: providedHeaders, method = "GET", ...init }: ApiRequestOptions = {}
): Promise<T> {
  const sameOriginPath = resolveSameOriginPath(path)

  const normalizedMethod = method.toUpperCase()
  const headers = new Headers(providedHeaders)
  const unsafe = !SAFE_METHODS.has(normalizedMethod)

  if (unsafe) {
    if (csrfState === null) {
      throw new CsrfUnavailableError()
    }
    headers.set(csrfState.headerName, csrfState.token)
  }

  let encodedBody: BodyInit | undefined
  if (body !== undefined) {
    if (body instanceof FormData) {
      encodedBody = body
    } else {
      headers.set("Content-Type", "application/json")
      encodedBody = JSON.stringify(body)
    }
  }

  const response = await fetch(sameOriginPath, {
    ...init,
    method: normalizedMethod,
    credentials: "same-origin",
    headers,
    body: encodedBody,
  })

  if (!response.ok) {
    await throwForNonOk(response, `Request failed with status ${response.status}.`)
  }
  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export async function refreshCsrfToken(): Promise<void> {
  const response = await apiRequest<unknown>("/api/auth/csrf")
  if (
    !isRecord(response) ||
    !isNonEmptyString(response.headerName) ||
    !HEADER_NAME.test(response.headerName) ||
    !isNonEmptyString(response.token)
  ) {
    csrfState = null
    throw new Error("The server returned an invalid security token.")
  }

  csrfState = {
    headerName: response.headerName,
    token: response.token,
  }
}

export function clearCsrfToken(): void {
  csrfState = null
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const detail =
      error.status >= 400 && error.status < 500 ? error.detail : fallback
    return `${detail} (Request ID: ${error.requestId})`
  }
  if (error instanceof CsrfUnavailableError) {
    return error.message
  }
  return fallback
}
