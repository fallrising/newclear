import type { RefSummary, WorkField } from "@cms/api";
import { Badge } from "@cms/ui";
import { formatValue } from "./format";
import { MediaValue, RefValue } from "./values";

/** A listable field in a Resource index row (01 §6.4 "列表顯示"). Unknown types and false booleans display no text. */
export function FieldCell({ field, value, summary }: { field: WorkField; value: unknown; summary?: RefSummary }) {
  if (value === null || value === undefined || value === "") return null;
  if (field.type === "ref" && typeof value === "string") return <RefValue id={value} summary={summary} />;
  if (field.type === "media-ref") {
    const id = value && typeof value === "object" && "mediaId" in value ? value.mediaId : value;
    if (typeof id === "string") return <MediaValue id={id} compact />;
  }
  if (field.type === "enum") return <Badge variant="secondary">{formatValue(field, value)}</Badge>;
  const text = formatValue(field, value);
  return <>{text}</>;
}
