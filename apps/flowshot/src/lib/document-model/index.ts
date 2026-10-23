import { buildModel } from "./model";
import type { ControlledLink, DocumentModel, TextSegment } from "./types";
import { classifyLink as classify, localAssetCandidate as asset } from "./targets";
import { segmentDomOffset as domOffset } from "./offsets";
export type { ByteOffset, ControlledLink, DocumentModel, TextSegment, TocItem } from "./types";
export function classifyLink(target: string): ControlledLink { return classify(target); }
export function localAssetCandidate(target: string): string | undefined { return asset(target); }
export function segmentDomOffset(segment: TextSegment, text: string, offset: number): number { return domOffset(segment, text, offset); }
/** Pure, synchronous, deterministic; rejects malformed Unicode. */
export function buildDocumentModel(source: string): DocumentModel { return buildModel(source); }
