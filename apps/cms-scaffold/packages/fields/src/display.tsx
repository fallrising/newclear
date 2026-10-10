import { useQuery } from "@tanstack/react-query";
import Markdown from "react-markdown";
import { workQueries, type WorkField } from "@cms/api";
import { Skeleton } from "@cms/ui";
import { fieldsCopy } from "./copy";
import { useFieldsServices } from "./context";
import { isKnown } from "./form";
import { formatValue } from "./format";
import { MediaThumb, RefValue } from "./values";

/** A media-ref as a large image (the `web` variant, else the original) with its real size (C-01, C-14 for Back). */
export function MediaImage({ id }: { id: string }) {
  const { work, url } = useFieldsServices();
  const media = useQuery({ ...workQueries.media(work, id), retry: false });
  if (media.isPending) return <Skeleton className="aspect-[4/3] w-full max-w-xl" />;
  if (media.isError) return <p className="text-subdued">{fieldsCopy["fields.media.unavailable"]}</p>;
  const image = media.data.contentType.startsWith("image/") ? (media.data.variants.web ?? media.data.variants.original) : undefined;
  if (!image) return <MediaThumb asset={media.data} size={96} />;
  return (
    <img
      src={url(image.url)}
      alt={media.data.altText || media.data.title}
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      className="h-auto max-w-full rounded-md border"
      data-testid="preview-image"
    />
  );
}

function mediaId(value: unknown): unknown {
  return value && typeof value === "object" && "mediaId" in value ? value.mediaId : value;
}

/** True when FieldDisplay shows something: a known type with a non-empty value it can format. */
export function displayable(field: WorkField, value: unknown): boolean {
  if (value === null || value === undefined || value === "" || !isKnown(field)) return false;
  if (field.type === "ref") return typeof value === "string";
  if (field.type === "media-ref") return typeof mediaId(value) === "string";
  if (field.type === "markdown" || field.type === "boolean") return true;
  return formatValue(field, value) !== "";
}

/**
 * One field value, read-only, for the Back preview (surface-back §3.4). Markdown is rendered without raw HTML
 * (D-08); ref and media-ref show the target, never an id. Renders nothing when displayable() is false.
 */
export function FieldDisplay({ field, value }: { field: WorkField; value: unknown }) {
  if (!displayable(field, value)) return null;
  switch (field.type) {
    case "markdown":
      return (
        <div className="markdown-preview" data-testid={`preview-${field.key}`}>
          <Markdown>{String(value)}</Markdown>
        </div>
      );
    case "ref":
      return <RefValue id={String(value)} />;
    case "media-ref":
      return <MediaImage id={String(mediaId(value))} />;
    case "boolean":
      return <p>{value === true ? fieldsCopy["fields.boolean.yes"] : fieldsCopy["fields.boolean.no"]}</p>;
    default:
      return <p className="whitespace-pre-wrap">{formatValue(field, value)}</p>;
  }
}
