import type { KeyboardEvent } from "react";
import { Link } from "react-router";
import type { PublicEntry } from "@cms/api/public";
import { Button, Dialog, DialogContent, DialogTitle, fill } from "@cms/ui";
import { copy } from "./copy";
import { altOf, imageOf, text } from "./media";
import { PublicImage } from "./parts";

export interface LightboxDialogProps {
  /** The published photos of the album, already loaded (surface-front §6.2: no extra requests). */
  photos: PublicEntry[];
  /** Index of the open photo in `photos`; -1 when closed. */
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** Restore the tile that opened this controlled dialog, including a direct-link fallback. */
  onReturnFocus?: () => void;
}

/**
 * 01 §7.1 F-S2 LightboxDialog: Radix Dialog (surface-front §3.4: no lightbox library), full screen, gallery-dark,
 * web variant (C-01). ← / → move within the list; Esc and the close button close it (Radix focus trap).
 */
export function LightboxDialog({ photos, index, onIndexChange, onClose, onReturnFocus }: LightboxDialogProps) {
  const photo = index >= 0 ? photos[index] : undefined;
  const hasPrevious = index > 0;
  const hasNext = index >= 0 && index < photos.length - 1;

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowLeft" && hasPrevious) {
      event.preventDefault();
      onIndexChange(index - 1);
    } else if (event.key === "ArrowRight" && hasNext) {
      event.preventDefault();
      onIndexChange(index + 1);
    }
  }

  const title = photo ? (photo.title ?? copy["photo.fallbackTitle"]) : "";
  const caption = photo ? text(photo.payload.caption) : "";
  const image = photo ? imageOf(photo.payload.media, "web") : null;

  return (
    <Dialog
      open={photo !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        data-scheme="gallery-dark"
        data-testid="lightbox"
        aria-describedby={undefined}
        onKeyDown={onKeyDown}
        onCloseAutoFocus={(event) => {
          if (onReturnFocus) {
            event.preventDefault();
            onReturnFocus();
          }
        }}
        className="flex h-[100dvh] w-screen max-w-none flex-col gap-4 rounded-none border-0 bg-page p-4 text-foreground sm:max-w-none"
      >
        {photo ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              {/* The span carries the Front size: through cn, DialogTitle's text-lg would win (W3 §2.3). */}
              <DialogTitle>
                <span className="font-display text-front-heading" data-testid="lightbox-title">
                  {title}
                </span>
              </DialogTitle>
              <div className="flex items-center gap-4">
                <span className="text-subdued" data-testid="lightbox-counter">
                  {fill(copy["lightbox.counter"], { index: index + 1, total: photos.length })}
                </span>
                {photo.slug ? (
                  <Link to={`/album/photos/${photo.slug}`} className="underline">
                    {copy["lightbox.openPage"]}
                  </Link>
                ) : null}
                <Button variant="outline" onClick={onClose} data-testid="lightbox-close">
                  {copy["lightbox.close"]}
                </Button>
              </div>
            </div>
            <div
              className="flex min-h-0 flex-1 items-center justify-center"
              onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
              }}
            >
              {image ? (
                <PublicImage
                  key={photo.id}
                  image={image}
                  alt={altOf(photo.payload.media, caption, photo.title)}
                  loading="eager"
                  className="max-h-full max-w-full object-contain"
                  testId="lightbox-image"
                />
              ) : (
                <p className="text-subdued">{copy["photo.noImage"]}</p>
              )}
            </div>
            <div className="flex items-center justify-between gap-4">
              <Button variant="outline" disabled={!hasPrevious} onClick={() => onIndexChange(index - 1)} data-testid="lightbox-previous">
                {copy["lightbox.previous"]}
              </Button>
              {caption ? <p className="text-center text-subdued">{caption}</p> : <span />}
              <Button variant="outline" disabled={!hasNext} onClick={() => onIndexChange(index + 1)} data-testid="lightbox-next">
                {copy["lightbox.next"]}
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
