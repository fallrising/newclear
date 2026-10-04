import { useEffect } from "react";
import { useLocation } from "react-router";

export interface PageMeta {
  /** og:title. document.title is set by FrontTitle (F-05), not here. */
  title?: string | null;
  /** meta description and og:description (surface-front §4.6: from the public summary; omitted when absent). */
  description?: string | null;
  /** og:image: absolute URL of a public web or thumbnail variant. */
  image?: string | null;
  /** true: "index,follow" and a canonical link; false: "noindex,nofollow" and no canonical link. */
  index: boolean;
}

function setMeta(attribute: "name" | "property", key: string, content: string | null | undefined) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!content) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function setCanonical(href: string | null) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!href) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", "canonical");
    document.head.appendChild(element);
  }
  element.setAttribute("href", href);
}

/**
 * Document-level SEO tags (surface-front §4.6, AC-17). Every page calls it exactly once, from one component,
 * with every field, so tags left by the previous page are replaced or removed. The canonical URL is the Front
 * origin plus the path: the query string (for example ?preview= or ?photo=) is never part of it.
 */
export function usePageMeta({ title, description, image, index }: PageMeta) {
  const { pathname } = useLocation();
  useEffect(() => {
    setMeta("name", "robots", index ? "index,follow" : "noindex,nofollow");
    setMeta("name", "description", description);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:image", image);
    setCanonical(index ? `${window.location.origin}${pathname}` : null);
  }, [title, description, image, index, pathname]);
}

/** Plain text of a Markdown value for meta tags and card excerpts: syntax removed, spaces collapsed, at most `max` characters. */
export function summarize(value: unknown, max = 160): string | null {
  if (typeof value !== "string") return null;
  const plain = value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~>#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return null;
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}
