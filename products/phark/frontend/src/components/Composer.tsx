import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react"
import { LayoutGrid, Send, X } from "lucide-react"

import {
  createPost,
  createPostWithImage,
  getApiErrorMessage,
} from "@/api/posts"
import type { AccountProfile } from "@/api/accounts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { Channel } from "@/types/post"

const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png"])
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

interface ComposerProps {
  account: AccountProfile | null
  onAuthRequest: () => void
  onPostCreated: () => Promise<void>
}

export function Composer({
  account,
  onAuthRequest,
  onPostCreated,
}: ComposerProps) {
  const [content, setContent] = useState("")
  const [channel, setChannel] = useState<Channel>("home")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      if (previewUrl !== null) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  function clearFileInput() {
    if (fileInputRef.current !== null) {
      fileInputRef.current.value = ""
    }
  }

  function resetImage() {
    setImageFile(null)
    setImageError(null)
    setPreviewUrl(null)
    clearFileInput()
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    if (file === null) {
      resetImage()
      return
    }

    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      resetImage()
      setImageError("Images must be JPEG or PNG.")
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      resetImage()
      setImageError("Images must be 5 MiB or smaller.")
      return
    }

    setImageError(null)
    setImageFile(file)
    setPreviewUrl(URL.createObjectURL(file))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current) {
      return
    }

    setError(null)

    const trimmedContent = content.trim()

    if (account === null) {
      setError("Sign in before publishing a post.")
      return
    }
    if (!trimmedContent) {
      setError("Content is required.")
      return
    }

    if (trimmedContent.length > 500) {
      setError("Content must be 500 characters or fewer.")
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    try {
      const request = { content: trimmedContent, channel }
      if (imageFile === null) {
        await createPost(request)
      } else {
        await createPostWithImage(request, imageFile)
      }
      setContent("")
      resetImage()
      await onPostCreated()
    } catch (error) {
      setError(
        getApiErrorMessage(error, "Unable to publish post. Please try again.")
      )
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <section className="border-b border-border/70 bg-card/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <LayoutGrid className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Stream Deck</h1>
            <p className="text-sm text-muted-foreground">
              Three columns. One composer. No bird logos.
            </p>
          </div>
        </div>

        {account === null ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background p-4 shadow-sm">
            <div>
              <p className="text-sm font-medium">Sign in to join the conversation</p>
              <p className="text-xs text-muted-foreground">
                Your verified profile supplies the author identity.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={onAuthRequest}>
              Sign in or register
            </Button>
          </div>
        ) : (
          <form
            className="grid gap-4 rounded-2xl border border-border/70 bg-background p-4 shadow-sm md:grid-cols-[1fr_auto] md:items-end"
            onSubmit={handleSubmit}
          >
            <div className="space-y-2">
              <Label htmlFor="channel">Channel</Label>
              <Select
                value={channel}
                disabled={submitting}
                onValueChange={(value) => setChannel(value as Channel)}
              >
                <SelectTrigger id="channel">
                  <SelectValue placeholder="Select channel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="home">Home</SelectItem>
                  <SelectItem value="tech">Tech</SelectItem>
                  <SelectItem value="ops">Ops</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button type="submit" disabled={submitting} className="md:mb-0.5">
              <Send className="size-4" />
              {submitting ? "Posting..." : "Post"}
            </Button>

            <div className="space-y-2 md:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="content">Content</Label>
                <span className="text-xs text-muted-foreground">
                  Posting as {account.displayName} (@{account.handle})
                </span>
              </div>
              <Textarea
                id="content"
                placeholder="What is happening?"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                maxLength={500}
                rows={3}
                disabled={submitting}
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{error ?? "Posts refresh all columns after publishing."}</span>
                <span>{content.length}/500</span>
              </div>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="image">Image</Label>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  id="image"
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  disabled={submitting}
                  onChange={handleImageChange}
                />
                {previewUrl !== null ? (
                  <>
                    <img
                      src={previewUrl}
                      alt="Selected image preview"
                      className="size-20 rounded-lg border border-border/60 object-cover"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={submitting}
                      onClick={resetImage}
                    >
                      Remove
                    </Button>
                  </>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Optional JPEG or PNG, up to 5 MiB.
              </p>
              {imageError ? (
                <div
                  role="alert"
                  className="flex items-center justify-between gap-2"
                >
                  <p className="text-xs text-destructive">{imageError}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={submitting}
                    aria-label="Dismiss image error"
                    onClick={resetImage}
                  >
                    <X className="size-3.5" />
                    Dismiss
                  </Button>
                </div>
              ) : null}
            </div>
          </form>
        )}
      </div>
    </section>
  )
}
