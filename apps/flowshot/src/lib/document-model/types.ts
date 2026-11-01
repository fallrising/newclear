/** Frozen N03 v1 public contract. Offsets are UTF-8 half-open byte ranges. */
export type ByteOffset = number;
export interface TocItem { id: string; depth: number; text: string }
export interface TextSegment {
  id: string;
  kind: "prose" | "code";
  canonicalStart: ByteOffset;
  canonicalEnd: ByteOffset;
  sourceStart?: ByteOffset;
  sourceEnd?: ByteOffset;
  sourceStartLine?: number;
  sourceEndLine?: number;
}
export interface DocumentModel {
  schemaVersion: 1;
  sourceHash: string;
  canonicalText: string;
  canonicalHash: string;
  html: string;
  toc: TocItem[];
  segments: TextSegment[];
}
export type ControlledLink =
  | { kind: "heading" | "document" | "external"; target: string }
  | { kind: "blocked"; target: "" };
