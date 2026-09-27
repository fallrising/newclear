import { matchPath } from "react-router";

const PROBE_ORIGIN = "https://return-to.invalid";

/**
 * S-01 / surface-front AC-13: returns a same-app path that is safe to navigate to after login,
 * or `fallback`. Accepted only when all of these hold:
 *  1. `raw` is a string that starts with exactly one "/" (not "//", not "/\").
 *  2. It contains no backslash, no whitespace and no control character (browsers strip tabs and
 *     newlines, which would turn "/\t/evil.example" into "//evil.example").
 *  3. Resolving it against a probe origin keeps that origin (no scheme, no host).
 *  4. Its normalised pathname matches one of `routes` (react-router patterns, whole path).
 * The returned value is the normalised pathname + search + hash.
 */
export function safeReturnTo(raw: string | null | undefined, routes: readonly string[], fallback: string): string {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\\\s\u0000-\u001f\u007f]/.test(raw)) return fallback;
  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PROBE_ORIGIN) return fallback;
  if (!routes.some((pattern) => matchPath({ path: pattern, end: true }, url.pathname))) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
