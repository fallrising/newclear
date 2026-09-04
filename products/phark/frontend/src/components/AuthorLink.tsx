import type { MouseEvent } from "react"

interface AuthorLinkProps {
  author: string
  handle: string | null
  className?: string
  onNavigateProfile: (handle: string) => void
}

export function AuthorLink({
  author,
  handle,
  className,
  onNavigateProfile,
}: AuthorLinkProps) {
  if (handle === null) {
    return <span className={className}>{author}</span>
  }
  const profileHandle = handle

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    event.preventDefault()
    onNavigateProfile(profileHandle)
  }

  return (
    <a
      href={`/profiles/${encodeURIComponent(profileHandle)}`}
      className={className}
      onClick={handleClick}
    >
      {author}
    </a>
  )
}
