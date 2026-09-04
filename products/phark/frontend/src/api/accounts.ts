import {
  apiRequest,
  clearCsrfToken,
  refreshCsrfToken,
} from "@/api/client"
import type { PostPage } from "@/types/post"

export interface AccountProfile {
  readonly handle: string
  readonly displayName: string
  readonly bio: string
  readonly createdAt: string
}

export interface SessionResponse {
  readonly account: AccountProfile | null
}

export interface RegisterRequest {
  readonly handle: string
  readonly displayName: string
  readonly password: string
}

export interface LoginRequest {
  readonly handle: string
  readonly password: string
}

export interface UpdateProfileRequest {
  readonly displayName: string
  readonly bio: string
}

export interface FetchProfilePostsOptions {
  readonly before?: string
  readonly limit?: number
}

async function refreshAfterAuthTransition(): Promise<void> {
  clearCsrfToken()
  await refreshCsrfToken()
}

async function withCsrfRefresh<T>(request: () => Promise<T>): Promise<T> {
  let result: T
  try {
    result = await request()
  } catch (error) {
    try {
      await refreshAfterAuthTransition()
    } catch {
      // Preserve the mutation's actionable Problem Details.
    }
    throw error
  }

  await refreshAfterAuthTransition()
  return result
}

export { refreshCsrfToken }

export function fetchSession(): Promise<SessionResponse> {
  return apiRequest<SessionResponse>("/api/auth/session")
}

export function register(request: RegisterRequest): Promise<AccountProfile> {
  return withCsrfRefresh(() =>
    apiRequest<AccountProfile>("/api/accounts", {
      method: "POST",
      body: request,
    })
  )
}

export function login(request: LoginRequest): Promise<SessionResponse> {
  return withCsrfRefresh(() =>
    apiRequest<SessionResponse>("/api/auth/login", {
      method: "POST",
      body: request,
    })
  )
}

export function logout(): Promise<void> {
  return withCsrfRefresh(() =>
    apiRequest<void>("/api/auth/logout", {
      method: "POST",
    })
  )
}

export function fetchProfile(handle: string): Promise<AccountProfile> {
  return apiRequest<AccountProfile>(
    `/api/profiles/${encodeURIComponent(handle)}`
  )
}

export function updateProfile(
  request: UpdateProfileRequest
): Promise<AccountProfile> {
  return apiRequest<AccountProfile>("/api/profiles/me", {
    method: "PATCH",
    body: request,
  })
}

export function fetchProfilePosts(
  handle: string,
  { before, limit = 20 }: FetchProfilePostsOptions = {}
): Promise<PostPage> {
  const params = new URLSearchParams({ limit: limit.toString() })
  if (before) params.set("before", before)

  return apiRequest<PostPage>(
    `/api/profiles/${encodeURIComponent(handle)}/posts?${params.toString()}`
  )
}
