export type Channel = "home" | "tech" | "ops"

export interface PostImage {
  readonly id: number
  readonly url: string
  readonly contentType: string
  readonly width: number
  readonly height: number
  readonly byteSize: number
}

export interface Post {
  id: number
  timelineEntryId: string
  author: string
  authorHandle: string | null
  content: string
  channel: Channel
  createdAt: string
  replyCount: number
  likeCount: number
  likedByViewer: boolean
  repostCount: number
  repostedByViewer: boolean
  repostedBy: string | null
  repostedByHandle: string | null
  repostedAt: string | null
  image: PostImage | null
}

export interface LikeState {
  postId: number
  likeCount: number
  likedByViewer: boolean
}

export interface RepostState {
  postId: number
  repostCount: number
  repostedByViewer: boolean
}

export interface Reply {
  id: number
  postId: number
  author: string
  authorHandle: string | null
  content: string
  createdAt: string
}

export interface CreateReplyRequest {
  content: string
}

export interface ReplyPage {
  items: Reply[]
  nextCursor: string | null
}

export interface CreatePostRequest {
  content: string
  channel: Channel
}

export interface PostPage {
  items: Post[]
  nextCursor: string | null
}
