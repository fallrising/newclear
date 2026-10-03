import { useQuery } from "@tanstack/react-query";
import { isApiError, workQueries, type MediaAsset, type RefSummary } from "@cms/api";
import { Skeleton, StatusBadge } from "@cms/ui";
import { fieldsCopy } from "./copy";
import { useFieldsServices } from "./context";

function statusOf(error: unknown) {
  return isApiError(error) ? error.status : 0;
}

function RefText({ title, state }: { title: string | null | undefined; state?: RefSummary["publicationState"] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid="ref-value">
      <span>{title || fieldsCopy["fields.ref.untitled"]}</span>
      {state ? <StatusBadge state={state} /> : null}
    </span>
  );
}

function RefNote({ text }: { text: string }) {
  return (
    <span className="text-subdued" data-testid="ref-value">
      {text}
    </span>
  );
}

/**
 * A ref value as the target's title and status, never its id (C-05, V2-AC-05). With `summary` (BW2 `include=refs`,
 * G-10) nothing is fetched; without it the target is read by id (the editor: one request per ref field).
 * `plain` leaves out the status badge (dense lines such as the schedule).
 */
export function RefValue({ id, summary, plain = false }: { id: string; summary?: RefSummary; plain?: boolean }) {
  const { work } = useFieldsServices();
  const entry = useQuery({ ...workQueries.entry(work, id), retry: false, enabled: summary === undefined });
  if (summary) {
    if (summary.missing) return <RefNote text={fieldsCopy["fields.ref.missing"]} />;
    if (summary.restricted) return <RefNote text={fieldsCopy["fields.ref.restricted"]} />;
    return <RefText title={summary.title} state={plain ? undefined : summary.publicationState} />;
  }
  if (entry.isPending) return <Skeleton className="h-4 w-32" />;
  if (entry.isError) {
    return <RefNote text={statusOf(entry.error) === 404 ? fieldsCopy["fields.ref.missing"] : fieldsCopy["fields.ref.restricted"]} />;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid="ref-value">
      <span>{entry.data.title ?? fieldsCopy["fields.ref.untitled"]}</span>
      {plain ? null : <StatusBadge state={entry.data.publicationState} dirty={entry.data.dirty} />}
    </span>
  );
}

/** A square preview of a media asset: its thumbnail (else original) image, or the file format (for example "PDF"). */
export function MediaThumb({ asset, size }: { asset: MediaAsset; size: number }) {
  const { url } = useFieldsServices();
  const image = asset.contentType.startsWith("image/") ? (asset.variants.thumbnail ?? asset.variants.original) : undefined;
  if (!image) {
    return (
      <span
        role="img"
        aria-label={asset.title}
        className="inline-flex items-center justify-center rounded-md border bg-surface-subdued text-table font-semibold text-subdued"
        style={{ width: size, height: size }}
      >
        {(asset.contentType.split("/")[1] ?? "").toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={url(image.url)}
      alt={asset.altText || asset.title}
      width={size}
      height={size}
      loading="lazy"
      className="rounded-md border object-cover"
      style={{ width: size, height: size }}
    />
  );
}

/** A media-ref value as a thumbnail and title (C-05). */
export function MediaValue({ id, compact = false }: { id: string; compact?: boolean }) {
  const { work } = useFieldsServices();
  const media = useQuery({ ...workQueries.media(work, id), retry: false });
  if (media.isPending) return <Skeleton className={compact ? "size-8" : "size-16"} />;
  if (media.isError) return <span className="text-subdued" data-testid="media-value">{fieldsCopy["fields.media.unavailable"]}</span>;
  return (
    <span className="inline-flex items-center gap-2" data-testid="media-value">
      <MediaThumb asset={media.data} size={compact ? 32 : 64} />
      {compact ? null : <span>{media.data.title}</span>}
    </span>
  );
}
