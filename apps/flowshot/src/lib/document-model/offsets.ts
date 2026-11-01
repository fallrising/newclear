import type { TextSegment } from './types';
const encoder = new TextEncoder();
/** Convert a DOM UTF16 offset using the final leaf, never an original source hint. */
export function segmentDomOffset(segment: TextSegment, text: string, offset: number): number {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) throw new RangeError('Invalid DOM offset');
  if (offset > 0 && offset < text.length && /[\ud800-\udbff]/u.test(text[offset - 1]!) && /[\udc00-\udfff]/u.test(text[offset]!)) throw new RangeError('DOM offset splits a Unicode scalar');
  if (encoder.encode(text).length !== segment.canonicalEnd - segment.canonicalStart) throw new RangeError('Leaf does not match segment byte length');
  return segment.canonicalStart + encoder.encode(text.slice(0,offset)).length;
}
