import { useQuery } from "@tanstack/react-query";
import { isApiError, workQueries } from "@cms/api";
import { Skeleton, StatusBadge } from "@cms/ui";
import { fieldsCopy } from "./copy";
import { useFieldsServices } from "./context";

function statusOf(error: unknown) {
  return isApiError(error) ? error.status : 0;
}

/** A ref value as the target's title and status, never its id (C-05, V2-AC-05). G-10: one request per value until BW2. */
export function RefValue({ id }: { id: string }) {
  const { work } = useFieldsServices();
  const entry = useQuery({ ...workQueries.entry(work, id), retry: false });
  if (entry.isPending) return <Skeleton className="h-4 w-32" />;
  if (entry.isError) {
    return (
      <span className="text-subdued" data-testid="ref-value">
        {statusOf(entry.error) === 404 ? fieldsCopy["fields.ref.missing"] : fieldsCopy["fields.ref.restricted"]}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid="ref-value">
      <span>{entry.data.title ?? fieldsCopy["fields.ref.untitled"]}</span>
      <StatusBadge state={entry.data.publicationState} dirty={entry.data.dirty} />
    </span>
  );
}

/** A media-ref value as a thumbnail and title (C-05). */
export function MediaValue({ id, compact = false }: { id: string; compact?: boolean }) {
  const { work, url } = useFieldsServices();
  const media = useQuery({ ...workQueries.media(work, id), retry: false });
  if (media.isPending) return <Skeleton className={compact ? "size-8" : "size-16"} />;
  if (media.isError) return <span className="text-subdued" data-testid="media-value">{fieldsCopy["fields.media.unavailable"]}</span>;
  const thumb = media.data.variants.thumbnail ?? media.data.variants.original;
  const size = compact ? 32 : 64;
  return (
    <span className="inline-flex items-center gap-2" data-testid="media-value">
      {thumb ? (
        <img src={url(thumb.url)} alt={media.data.altText || media.data.title} width={size} height={size} loading="lazy" className="rounded-md border object-cover" style={{ width: size, height: size }} />
      ) : null}
      {compact ? null : <span>{media.data.title}</span>}
    </span>
  );
}
