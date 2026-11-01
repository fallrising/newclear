import type { MediaAsset } from "@cms/api/public";
import { api } from "./api";

export interface ImageSource {
  src: string;
  width: number | undefined;
  height: number | undefined;
}

/** A public media-ref value is a MediaAsset object, or null when the media is not public (B-13). */
export function isMediaAsset(value: unknown): value is MediaAsset {
  return typeof value === "object" && value !== null && "variants" in value && typeof value.variants === "object";
}

// C-01: detail pages and the lightbox never use the thumbnail; grids and cards never load the full image first.
const ORDER = { web: ["web", "original"], thumbnail: ["thumbnail", "web"] } as const;

/** Absolute URL and intrinsic size of the wanted variant (01 §7.1 F-S2, F-S3), or null when there is none. */
export function imageOf(value: unknown, variant: "thumbnail" | "web"): ImageSource | null {
  if (!isMediaAsset(value)) return null;
  for (const key of ORDER[variant]) {
    const link = value.variants[key];
    if (link?.url) return { src: api.url(link.url), width: link.width ?? undefined, height: link.height ?? undefined };
  }
  return null;
}

/** C-14, 01 §10.1: altText first, then the given fallbacks (caption, title); "" marks the image as decorative. */
export function altOf(value: unknown, ...fallbacks: unknown[]): string {
  const candidates = [isMediaAsset(value) ? value.altText : "", ...fallbacks];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate.trim();
  }
  return "";
}

export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const DATE = new Intl.DateTimeFormat("zh-TW", { dateStyle: "long" });

/** A datetime field as a local calendar date, for example "2026年10月1日"; null when missing or not a date. */
export function formatDate(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : DATE.format(date);
}
