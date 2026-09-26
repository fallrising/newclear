import type { MediaAsset } from "@cms/api/public";
import { api } from "./api";

function isMediaAsset(value: unknown): value is MediaAsset {
  return typeof value === "object" && value !== null && "variants" in value;
}

/** v1 behaviour kept in W0: thumbnail first, then web (C-01 is fixed in W3). Absolute URL or undefined. */
export function mediaUrl(value: unknown): string | undefined {
  if (!isMediaAsset(value)) return undefined;
  const url = value.variants.thumbnail?.url ?? value.variants.web?.url;
  return url ? api.url(url) : undefined;
}

export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
