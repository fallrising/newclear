/** Shared, side-effect-free validation for the private reading artifact. */
export type ReadingArticle = { id: string; title: string; body: string };
export type ReadingBundle = { version: 1; commit: string; articles: ReadingArticle[] };
export const COMMIT = /^[a-f0-9]{40}$/;
export const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();

export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
}
export function validText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value) && encoder.encode(value).byteLength <= max;
}
export function safePath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 1024 && value.length > 0 && !/[\\:\0\r\n]/u.test(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}
export function validArticleLinks(body: string, ids: Set<string>): boolean {
  // Validate all reading references, including reference-style and HTML-looking text.
  // Rendering remains the browser's safe Markdown responsibility.
  for (const match of body.matchAll(/\/reading\/([^\s)<>\]"'?#]+)/gu)) {
    const id = match[1];
    if (!id || !SAFE_ID.test(id) || !ids.has(id)) return false;
  }
  return true;
}
export function parseBundle(value: unknown): ReadingBundle | null {
  if (!object(value) || !exactKeys(value, ['version', 'commit', 'articles']) || value.version !== 1 || typeof value.commit !== 'string' || !COMMIT.test(value.commit) || !Array.isArray(value.articles) || value.articles.length > 200) return null;
  const ids = new Set<string>(); const articles: ReadingArticle[] = [];
  for (const article of value.articles) {
    if (!object(article) || !exactKeys(article, ['id', 'title', 'body']) || typeof article.id !== 'string' || !SAFE_ID.test(article.id) || ids.has(article.id) || !validText(article.title, 200) || !validText(article.body, 65536)) return null;
    ids.add(article.id); articles.push({ id: article.id, title: article.title, body: article.body });
  }
  if (articles.some(article => !validArticleLinks(article.body, ids))) return null;
  const result: ReadingBundle = { version: 1, commit: value.commit, articles };
  return encoder.encode(JSON.stringify(result)).byteLength <= MAX_BUNDLE_BYTES ? result : null;
}
