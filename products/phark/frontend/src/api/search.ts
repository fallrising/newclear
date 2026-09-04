import { apiRequest } from "@/api/client"
import type { PostPage } from "@/types/post"

export type FetchSearchOptions = {
  readonly before?: string
  readonly limit?: number
}

export async function fetchSearch(
  query: string,
  { before, limit = 20 }: FetchSearchOptions = {}
): Promise<PostPage> {
  const params = new URLSearchParams({ q: query, limit: limit.toString() })
  if (before) params.set("before", before)

  return apiRequest<PostPage>(`/api/search?${params.toString()}`)
}
