import type { ControlledLink } from './types';
const blocked: ControlledLink = { kind: 'blocked', target: '' };
function cleanTarget(target: string): string | undefined {
  if (!target || [...target].some(c => c.charCodeAt(0) <= 32 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159) || c === '\\') || target.startsWith('//')) return;
  // Decode only to inspect ambiguity; the later PathGuard owns actual path decoding.
  let decoded: string;
  try { decoded = decodeURIComponent(target); } catch { return; }
  if ([...decoded].some(c => c.charCodeAt(0) < 32 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159) || c === '\\') || /%[0-9a-f]{2}/iu.test(decoded)) return;
  if (/%(?:2f|5c|3a)/iu.test(target) || decoded.startsWith('//')) return;
  const originalScheme = /^([a-z][a-z0-9+.-]*):/iu.exec(target)?.[1]?.toLowerCase();
  const decodedScheme = /^([a-z][a-z0-9+.-]*):/iu.exec(decoded)?.[1]?.toLowerCase();
  if (originalScheme !== decodedScheme) return;
  return decoded;
}
export function classifyLink(target: string): ControlledLink {
  const decoded = cleanTarget(target);
  if (decoded === undefined) return blocked;
  if (target.startsWith('#')) return { kind: 'heading', target };
  if (/^(https?:|mailto:)/iu.test(target)) {
    try {
      const url = new URL(target);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && (!url.hostname || url.username || url.password)) return blocked;
      return { kind: 'external', target };
    } catch { return blocked; }
  }
  if (/^[a-z][a-z0-9+.-]*:/iu.test(decoded) || decoded.includes('?')) return blocked;
  if (/\.(?:md|markdown|mdx)(?:#.*)?$/iu.test(decoded)) return { kind: 'document', target };
  return blocked;
}
export function localAssetCandidate(target: string): string | undefined {
  const decoded = cleanTarget(target);
  if (decoded === undefined || /^[a-z][a-z0-9+.-]*:/iu.test(decoded) || /[?#]/u.test(decoded)) return;
  return /\.(?:png|jpe?g|gif|webp)$/iu.test(decoded) ? target : undefined;
}
