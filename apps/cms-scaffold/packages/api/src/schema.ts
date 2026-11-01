// Named aliases for the generated OpenAPI types. Never hand-write API shapes (01 D-04, E-02).
import type { components, operations, paths } from "./generated/schema";

export type { components, operations, paths };

type S = components["schemas"];

export type FieldError = S["FieldError"];
export type FieldErrorCode = S["FieldErrorCode"];
export type EntryPatchRequest = S["EntryPatchRequest"];
export type ErrorCode = S["ErrorCode"];
export type ErrorEnvelope = S["ErrorEnvelope"];
export type Surface = S["Surface"];
export type CmsAction = S["CmsAction"];
export type PublicationState = S["PublicationState"];
export type Me = S["Me"];
export type Capabilities = S["Capabilities"];
export type TypeCapability = S["TypeCapability"];
export type LoginResponse = S["LoginResponse"];
export type CsrfToken = S["CsrfToken"];
export type Principal = S["Principal"];
export type PrincipalList = S["PrincipalList"];
export type PrincipalStatus = S["PrincipalStatus"];
export type CreatePrincipalRequest = S["CreatePrincipalRequest"];
export type CreatedPrincipal = S["CreatedPrincipal"];
export type PatchPrincipalRequest = S["PatchPrincipalRequest"];
export type RoleAssignment = S["RoleAssignment"];
export type RoleAssignmentInput = S["RoleAssignmentInput"];
export type TemporaryPassword = S["TemporaryPassword"];
export type EffectivePermission = S["EffectivePermission"];
export type EffectivePermissionList = S["EffectivePermissionList"];
export type Role = S["Role"];
export type RoleList = S["RoleList"];
export type Permission = S["Permission"];
export type PermissionList = S["PermissionList"];
export type PermissionInput = S["PermissionInput"];
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

export type WorkEntryList = S["WorkEntryList"];
export type RefSummary = S["RefSummary"];
export type BatchPatchRequest = S["BatchPatchRequest"];
export type Revision = S["Revision"];
export type RevisionList = S["RevisionList"];

export type AdminField = S["AdminField"];
export type AuditActor = S["AuditActor"];
export type AuditEventSummary = S["AuditEventSummary"];
export type AuditEventDetail = S["AuditEventDetail"];
export type AuditEventPage = S["AuditEventPage"];
export type AuditSettings = S["AuditSettings"];
