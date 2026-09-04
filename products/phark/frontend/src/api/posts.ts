import { apiRequest, getApiErrorMessage } from "@/api/client"
import type {
  Channel,
  CreatePostRequest,
  CreateReplyRequest,
  LikeState,
  Post,
  PostPage,
  Reply,
  ReplyPage,
  RepostState,
} from "@/types/post"

export { getApiErrorMessage }

export type FetchPostsOptions = {
  channel?: Channel
  before?: string
  limit?: number
}

export type FetchRepliesOptions = {
  limit?: number
  after?: string
}

export async function fetchReplies(
  postId: number,
  { after, limit = 20 }: FetchRepliesOptions = {}
): Promise<ReplyPage> {
  const params = new URLSearchParams({ limit: limit.toString() })
  if (after) params.set("after", after)

  return apiRequest<ReplyPage>(
    `/api/posts/${postId}/replies?${params.toString()}`
  )
}

export function createReply(
  postId: number,
  request: CreateReplyRequest
): Promise<Reply> {
  return apiRequest<Reply>(`/api/posts/${postId}/replies`, {
    method: "POST",
    body: request,
  })
}

export async function fetchPosts({
  channel,
  before,
  limit = 20,
}: FetchPostsOptions = {}): Promise<PostPage> {
  const params = new URLSearchParams({ limit: limit.toString() })
  if (channel) params.set("channel", channel)
  if (before) params.set("before", before)

  return apiRequest<PostPage>(`/api/posts?${params.toString()}`)
}

export function createPost(request: CreatePostRequest): Promise<Post> {
  return apiRequest<Post>("/api/posts", {
    method: "POST",
    body: request,
  })
}

export function createPostWithImage(
  request: CreatePostRequest,
  image: File
): Promise<Post> {
  const form = new FormData()
  form.append(
    "post",
    new Blob([JSON.stringify(request)], { type: "application/json" })
  )
  form.append("image", image)
  return apiRequest<Post>("/api/posts", {
    method: "POST",
    body: form,
  })
}

export function likePost(postId: number): Promise<LikeState> {
  return apiRequest<LikeState>(`/api/posts/${postId}/like`, {
    method: "PUT",
  })
}

export function unlikePost(postId: number): Promise<LikeState> {
  return apiRequest<LikeState>(`/api/posts/${postId}/like`, {
    method: "DELETE",
  })
}

export function repostPost(postId: number): Promise<RepostState> {
  return apiRequest<RepostState>(`/api/posts/${postId}/repost`, {
    method: "PUT",
  })
}

export function unrepostPost(postId: number): Promise<RepostState> {
  return apiRequest<RepostState>(`/api/posts/${postId}/repost`, {
    method: "DELETE",
  })
}
