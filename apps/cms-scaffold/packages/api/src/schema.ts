// Named aliases for the generated OpenAPI types. Never hand-write API shapes (01 D-04, E-02).
import type { components, operations, paths } from "./generated/schema";

export type { components, operations, paths };

type S = components["schemas"];

export type ErrorCode = S["ErrorCode"];
export type ErrorEnvelope = S["ErrorEnvelope"];
export type Surface = S["Surface"];
export type CmsAction = S["CmsAction"];
export type PublicationState = S["PublicationState"];
export type Me = S["Me"];
export type LoginResponse = S["LoginResponse"];
export type CsrfToken = S["CsrfToken"];
export type Principal = S["Principal"];
export type PrincipalList = S["PrincipalList"];
export type EntryPayload = S["EntryPayload"];
export type PublicContentType = S["PublicContentType"];
export type PublicContentTypeList = S["PublicContentTypeList"];
export type PublicEntry = S["PublicEntry"];
export type PublicEntryPage = S["PublicEntryPage"];
export type WorkField = S["WorkField"];
export type WorkContentType = S["WorkContentType"];
export type WorkContentTypeList = S["WorkContentTypeList"];
export type WorkEntry = S["WorkEntry"];
export type WorkEntryPage = S["WorkEntryPage"];
export type EntryWriteRequest = S["EntryWriteRequest"];
export type AdminContentType = S["AdminContentType"];
export type AdminContentTypeList = S["AdminContentTypeList"];
export type MediaAsset = S["MediaAsset"];
export type MediaAssetList = S["MediaAssetList"];
export type MediaQuota = S["MediaQuota"];
